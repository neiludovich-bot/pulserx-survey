import { load } from "cheerio";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { websiteIndexSnapshotSchema, WEBSITE_PROFILES, allowedWebsiteIndexUrl, type WebsiteIndexSnapshot } from "../packages/schemas/src/website-index";
import { CONTROLLED_RAG_CHUNKS } from "../apps/api/src/lib/controlled-rag-source-packs";
import { extractWebsiteTables } from "./extract-website-tables";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const clean = (text: string) => text.replace(/[\t \u00a0]+/g, " ").replace(/\n\s*\n/g, "\n\n").trim();
export function canonicalUrl(value: string, base: string) {
  try { const url = new URL(value, base); url.hash = ""; return url.href; } catch { return null; }
}
export function extractWebsiteHtml(html: string, url: string) {
  const $ = load(html);
  const title = (clean($("h1").first().text()) || clean($("title").text()) || url).slice(0, 240);
  const links = [...new Set($("a[href]").toArray().map(el => canonicalUrl($(el).attr("href")!, url)).filter((s): s is string => Boolean(s)))];
  $("script,style,noscript,nav,header,form,[role=dialog],.cookie-banner").remove();
  const root = $("main").length ? $("main").first() : $("body");
  const assets = root.find("img").toArray().flatMap(el => {
    const alt = clean($(el).attr("alt") ?? "");
    const src = $(el).attr("data-src") ?? $(el).attr("src");
    const assetUrl = src ? canonicalUrl(src, url) : null;
    if (!assetUrl || !assetUrl.startsWith("https:") || alt.length < 9 || /logo|icon|cookie|avatar/i.test(alt)) return [];
    const caption = clean($(el).closest("figure").find("figcaption").text());
    return [{ title: alt.slice(0, 240), description: (caption || alt).slice(0, 1000), url: assetUrl, assetKind: "IMAGE" as const }];
  }).filter((asset, i, all) => all.findIndex(other => other.url === asset.url) === i).slice(0, 24);
  const blocks: string[] = [];
  root.find("h1,h2,h3,h4,h5,p,li,tr").each((_i, el) => {
    const node = $(el);
    if (node.parents("tr").length || (node.is("li") && node.find("p,li").length)) return;
    const text = node.is("tr") ? node.find("th,td").toArray().map(cell => clean($(cell).text())).join(" | ") : clean(node.text());
    if (text) blocks.push(text);
  });
  return { title, links, assets, tables: extractWebsiteTables(html), content: blocks.length ? blocks.join("\n\n") : clean(root.text()) };
}

export async function download(slug: WebsiteIndexSnapshot["surveySlug"], value: string) {
  let url = value;
  for (let redirects = 0; redirects < 6; redirects++) {
    if (!allowedWebsiteIndexUrl(slug, url, true)) throw new Error("Redirect or URL outside approved website/document hosts");
    const response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "User-Agent": "PulseRX-Website-Indexer/1.0" } });
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) { url = canonicalUrl(response.headers.get("location")!, url)!; continue; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body!.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > 24 * 1024 * 1024) throw new Error("Document exceeds 24 MB bound"); parts.push(next.value); }
    } finally { await reader.cancel(); }
    return { url, bytes: Buffer.concat(parts), type: response.headers.get("content-type") ?? "" };
  }
  throw new Error("Too many redirects");
}

/** Offline crawl: no model calls. Failed/empty/scanned pages remain explicit. */
export async function indexMedicalWebsite(slug: WebsiteIndexSnapshot["surveySlug"]) {
  const profile = WEBSITE_PROFILES[slug];
  const snapshot: WebsiteIndexSnapshot = { version: 1, surveySlug: slug, rootUrl: profile.rootUrl, fetchedAt: new Date().toISOString(), pages: [], issues: [], discoveredUrls: [], truncated: false };
  const queue: Array<{ url: string; from: string }> = [{ url: profile.rootUrl, from: profile.rootUrl }];
  const seen = new Set<string>(); const pageUrls = new Set<string>();
  const enqueue = (url: string, from: string) => {
    if (!allowedWebsiteIndexUrl(slug, url, true) || /\.(?:svg|png|jpg|jpeg|gif|webp|zip|mp4|css|js|xml)$/i.test(new URL(url).pathname)) return;
    if (!seen.has(url) && !queue.some(item => item.url === url)) queue.push({ url, from });
  };
  // Only first-party existing source URLs seed the crawl. External PDFs must
  // actually be linked by the approved website, not merely exist in old cards.
  for (const source of CONTROLLED_RAG_CHUNKS.filter(s => s.surveySlug === slug)) {
    const url = canonicalUrl(source.url, profile.rootUrl);
    if (url && allowedWebsiteIndexUrl(slug, url)) enqueue(url, profile.rootUrl);
  }
  const addPage = (page: WebsiteIndexSnapshot["pages"][number]) => {
    if (pageUrls.has(page.url)) return;
    if (page.content.length < 80) { snapshot.issues.push({ url: page.url, reason: "Insufficient text; image-only or gated content requires review" }); return; }
    if (page.content.length > 300000) { snapshot.issues.push({ url: page.url, reason: "Page exceeds content bound; not silently truncated" }); return; }
    snapshot.pages.push(page); pageUrls.add(page.url);
  };
  // Include sitemap-only pages, not just links reachable from the homepage.
  const sitemapQueue = [new URL("sitemap.xml", profile.rootUrl).href];
  const sitemapSeen = new Set<string>();
  while (sitemapQueue.length && sitemapSeen.size < 12) {
    const url = sitemapQueue.shift()!;
    if (sitemapSeen.has(url) || !allowedWebsiteIndexUrl(slug, url)) continue;
    sitemapSeen.add(url);
    try {
      const map = await download(slug, url); const xml = load(map.bytes.toString("utf8"), { xmlMode: true });
      xml("loc").each((_i, el) => { const found = canonicalUrl(xml(el).text().trim(), url); if (!found) return;
        if (/\.xml$/i.test(new URL(found).pathname)) sitemapQueue.push(found); else enqueue(found, profile.rootUrl);
      });
    } catch (error) { snapshot.issues.push({ url, reason: `Sitemap unavailable: ${error instanceof Error ? error.message : "unknown error"}` }); }
  }
  if (sitemapQueue.length) { snapshot.truncated = true; snapshot.issues.push({ url: profile.rootUrl, reason: "Sitemap discovery limit reached" }); }
  let processed = 0;
  while (queue.length && processed < 180) {
    const item = queue.shift()!; if (seen.has(item.url)) continue;
    seen.add(item.url); processed++;
    try {
      const resource = await download(slug, item.url); seen.add(resource.url);
      if (/pdf/i.test(resource.type) || /\.pdf$/i.test(new URL(resource.url).pathname)) {
        const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const pdf = await getDocument({ data: new Uint8Array(resource.bytes), useSystemFonts: true, isEvalSupported: false }).promise;
        try {
          if (pdf.numPages > 150) throw new Error("PDF exceeds 150-page bound; requires separate review");
          for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
            const page = await pdf.getPage(pageNumber); const data = await page.getTextContent();
            const content = clean(data.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join(""));
            addPage({ url: `${resource.url}#page=${pageNumber}`, discoveredFrom: item.from, title: `${slug.toUpperCase()} — ${decodeURIComponent(new URL(resource.url).pathname.split("/").at(-1)!)} — page ${pageNumber}`.slice(0, 240), content, sourceType: "PDF", hash: hash(content), assets: [], tables: [] });
          }
        } finally { await pdf.destroy(); }
      } else if (/html/i.test(resource.type)) {
        const extracted = extractWebsiteHtml(resource.bytes.toString("utf8"), resource.url);
        addPage({ url: resource.url, discoveredFrom: item.from, title: extracted.title, content: extracted.content, sourceType: "URL", hash: hash(extracted.content), assets: extracted.assets, tables: extracted.tables });
        for (const link of extracted.links) enqueue(link, resource.url);
      } else snapshot.issues.push({ url: resource.url, reason: `Unsupported content type: ${resource.type}` });
    } catch (error) { snapshot.issues.push({ url: item.url, reason: error instanceof Error ? error.message.slice(0, 1000) : "Download/extraction failed" }); }
    console.log(`${slug}: ${processed} resources, ${snapshot.pages.length} indexed pages, ${snapshot.issues.length} issues, ${queue.length} queued`);
  }
  snapshot.discoveredUrls = [...new Set([...seen, ...queue.map(item => item.url)])];
  snapshot.truncated ||= queue.length > 0;
  return websiteIndexSnapshotSchema.parse(snapshot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const slug = process.argv[2] as WebsiteIndexSnapshot["surveySlug"];
  if (!(slug in WEBSITE_PROFILES) || !process.argv[3]) throw new Error("Usage: tsx scripts/index-medical-website.ts <nubeqa|brukinsa|padcev> <snapshot.json>");
  const snapshot = await indexMedicalWebsite(slug);
  await writeFile(process.argv[3], JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ bot: slug, pages: snapshot.pages.length, issues: snapshot.issues.length, truncated: snapshot.truncated }));
}
