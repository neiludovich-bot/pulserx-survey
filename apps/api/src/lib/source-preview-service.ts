import {
  type MvpCustomGptSourcePreviewRequest,
  type MvpCustomGptSourcePreviewResponse,
  mvpCustomGptSourcePreviewResponseSchema,
} from "@interview/schemas";

const SOURCE_PREVIEW_TIMEOUT_MS = 8_000;
const SOURCE_PREVIEW_MAX_HTML_CHARS = 600_000;
const sourcePreviewCache = new Map<string, MvpCustomGptSourcePreviewResponse>();

type ImageCandidate = {
  url: string;
  alt: string | null;
  width: number | null;
  height: number | null;
  source: "open_graph" | "twitter" | "html_image";
  context: string;
  score: number;
};

type DocumentCandidate = {
  url: string;
  title: string;
  description: string | null;
  isPdf: boolean;
  source: "pdf_link" | "html_link";
  context: string;
  score: number;
};

type CuratedSourceAsset = NonNullable<
  MvpCustomGptSourcePreviewRequest["assets"]
>[number];

function isPrivateIpv4(hostname: string) {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) {
    return false;
  }

  const octets = match.slice(1).map(Number);
  const [first, second] = octets;

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    first === 0
  );
}

function assertPreviewUrlAllowed(url: URL) {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS source URLs can be previewed.");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname.endsWith(".local") ||
    isPrivateIpv4(hostname)
  ) {
    throw new Error("Local or private network source URLs cannot be previewed.");
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function getAttribute(tag: string, name: string) {
  const pattern = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = tag.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3] ?? null;

  return value ? decodeHtmlEntities(value) : null;
}

function absoluteUrl(value: string | null, baseUrl: string) {
  if (!value || value.startsWith("data:") || value.startsWith("blob:")) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function parseNumberAttribute(value: string | null) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function extractMetaContent(html: string, key: string) {
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html)) !== null) {
    const tag = match[0];
    const property = getAttribute(tag, "property") ?? getAttribute(tag, "name");
    if (property?.toLowerCase() === key.toLowerCase()) {
      return getAttribute(tag, "content");
    }
  }

  return null;
}

function parseSrcSet(value: string | null) {
  if (!value) {
    return null;
  }

  const candidates = value
    .split(",")
    .map((item, index) => {
      const [url, descriptor] = item.trim().split(/\s+/);
      const width = descriptor?.match(/^(\d+)w$/i)?.[1];
      const density = descriptor?.match(/^(\d+(?:\.\d+)?)x$/i)?.[1];

      return {
        url,
        index,
        score: width
          ? Number.parseInt(width, 10)
          : density
            ? Number.parseFloat(density) * 1_000
            : index,
      };
    })
    .filter(
      (candidate): candidate is { url: string; index: number; score: number } =>
        Boolean(candidate.url) && Number.isFinite(candidate.score),
    );

  return (
    candidates.sort(
      (left, right) => right.score - left.score || right.index - left.index,
    )[0]?.url ?? null
  );
}

function stripHtml(value: string) {
  return decodeHtmlEntities(
    value
      .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}

function getContextAround(html: string, start: number, end: number) {
  const contextStart = Math.max(0, start - 1_200);
  const contextEnd = Math.min(html.length, end + 1_200);

  return stripHtml(html.slice(contextStart, contextEnd));
}

function cleanDocumentTitle(value: string | null | undefined) {
  return decodeHtmlEntities(value ?? "")
    .replace(/\b(?:download|pdf|opens in new tab)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function documentTitleLooksGeneric(value: string | null | undefined) {
  const normalized = cleanDocumentTitle(value).toLowerCase();

  return (
    !normalized ||
    /^(?:preview|open|view|learn more|read more|resource|resources|download|click here)$/i.test(
      normalized,
    )
  );
}

function titleFromUrl(value: string) {
  try {
    const url = new URL(value);
    const filename = decodeURIComponent(
      url.pathname.split("/").filter(Boolean).at(-1) ?? "",
    )
      .replace(/\.(?:pdf|html?|aspx?)$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (documentTitleLooksGeneric(filename)) {
      return null;
    }

    return filename.replace(/\b\w/g, (letter) => letter.toUpperCase());
  } catch {
    return null;
  }
}

function nearestHeadingBefore(html: string, start: number) {
  const previousHtml = html.slice(Math.max(0, start - 2_000), start);
  const headings = Array.from(
    previousHtml.matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi),
  )
    .map((match) => cleanDocumentTitle(stripHtml(match[1] ?? "")))
    .filter((heading) => !documentTitleLooksGeneric(heading));

  return headings.at(-1) ?? null;
}

function resolveDocumentTitle(input: {
  tag: string;
  html: string;
  start: number;
  url: string;
}) {
  const visibleLabel = cleanDocumentTitle(stripHtml(input.tag));
  const ariaLabel = cleanDocumentTitle(getAttribute(input.tag, "aria-label"));
  const titleAttribute = cleanDocumentTitle(getAttribute(input.tag, "title"));
  const heading = nearestHeadingBefore(input.html, input.start);
  const urlTitle = titleFromUrl(input.url);

  return (
    [visibleLabel, ariaLabel, titleAttribute, heading, urlTitle].find(
      (candidate) => !documentTitleLooksGeneric(candidate),
    ) ?? null
  );
}

function imageLooksUseful(candidate: ImageCandidate) {
  const directHaystack = `${candidate.url} ${candidate.alt ?? ""}`.toLowerCase();
  const haystack = `${directHaystack} ${candidate.context}`.toLowerCase();
  const clinicalOrDocumentPattern =
    /\b(?:sequoia|alpine|aspen|ev-302|ev 302|keynote-a39|keynote a39|ev-301|ev 301|ev-201|ev 201|pfs|progression-free|progression free|os|overall survival|orr|km curve|kaplan|curve|chart|graph|table|forest plot|hazard ratio|95% ci|cohort|study design|trial design|patient management guide|dosing and administration guide|dosing guide|administration guide|dose modification|dose modifications|peripheral neuropathy informational resource|informational resource|prescribing information|brochure|form|enrollment|specialty pharmacies|distributors)\b/;
  const marketingPattern =
    /\b(?:hero|lifestyle|brand|campaign|atmosphere|airplane|aircraft|plane|jet|flight|travel|runway|jumping|splash|water|boy|girl|family|street|building|portrait|person|people|caregiver)\b/;
  const directClinicalOrDocumentSignal =
    clinicalOrDocumentPattern.test(directHaystack);
  const contextualClinicalOrDocumentSignal =
    clinicalOrDocumentPattern.test(haystack) ||
    /\b(?:figure|cohort\s+\d)\b/.test(haystack);
  const marketingOnlySignal =
    marketingPattern.test(directHaystack);
  const productShotSignal =
    /\b(?:tablet1|tablet|tablets|pill|pills|capsule|capsules|bottle|packshot|product shot|dosing options)\b/.test(
      directHaystack,
    );
  const genericMarketingUrlSignal =
    /(?:^|[\/_-])(?:hero|home|homepage|banner|brand|campaign|lifestyle|airplane|aircraft|plane|jet|flight|travel|runway|splash|background|bg|key-visual|kv)(?:[\/_.-]|$)/i.test(
      candidate.url,
    );
  const promotionalGraphicSignal =
    /\b(?:stays on|stays off|btk stays|up to 100|100%|potency|inhibition|selective|selectivity|off-target|off target|on-target|on target)\b/.test(
      directHaystack,
    );

  if (
    /\b(?:favicon|sprite|icon|logo|pixel|tracking|loader|spinner|swipe-to-scroll|subtab|popup|footer-logo)\b/.test(
      haystack,
    )
  ) {
    return false;
  }

  if (/\.(?:svg)(?:[?#].*)?$/i.test(candidate.url)) {
    return false;
  }

  if (productShotSignal) {
    return false;
  }

  if (promotionalGraphicSignal && !directClinicalOrDocumentSignal) {
    return false;
  }

  if (marketingOnlySignal && !directClinicalOrDocumentSignal) {
    return false;
  }

  if (genericMarketingUrlSignal && !directClinicalOrDocumentSignal) {
    return false;
  }

  return directClinicalOrDocumentSignal || contextualClinicalOrDocumentSignal;
}

function scoreImage(
  candidate: ImageCandidate,
  pageTitle: string | null,
  sourceUrl: string,
) {
  const parsedUrl = new URL(sourceUrl);
  const hash = parsedUrl.hash.toLowerCase();
  const directHaystack = `${candidate.url} ${candidate.alt ?? ""}`.toLowerCase();
  const haystack =
    `${directHaystack} ${candidate.context} ${pageTitle ?? ""}`.toLowerCase();
  let score = candidate.score;

  if (/\b(?:sequoia|alpine|aspen)\b/.test(haystack)) {
    score += 70;
  }

  if (/\b(?:pfs|progression-free|progression free|km curve|kaplan|curve|chart|graph)\b/.test(haystack)) {
    score += 55;
  }

  if (/\b(?:efficacy|study|trial|data|cohort|relative risk|hazard ratio|hr=|95% ci)\b/.test(haystack)) {
    score += 35;
  }

  if (/\b(?:1l|first line|cll|sll)\b/.test(haystack)) {
    score += 25;
  }

  if (/\b(?:guide|brochure|form|enrollment|specialty pharmacies|distributors|dose modification|dose modifications|peripheral neuropathy informational resource|informational resource|prescribing information)\b/.test(haystack)) {
    score += 18;
  }

  if (/\b(?:brukinsa|zanubrutinib)\b/.test(haystack)) {
    score += 12;
  }

  if (hash === "#first" && /\b(?:sequoia|1l|first line|cohort 1|cohort 2)\b/.test(haystack)) {
    score += 30;
  }

  if (/\/wp-content\/uploads\//i.test(candidate.url)) {
    score += 12;
  }

  if (/\b(?:tablet|support|dosing|video|resource|patient|footer|header)\b/.test(haystack)) {
    score -= 35;
  }

  if (/\b(?:hero|lifestyle|brand|campaign|airplane|aircraft|plane|jet|flight|travel|runway|jumping|splash|water|boy|girl|family|street|building|portrait|person|people|caregiver)\b/.test(haystack)) {
    score -= 90;
  }

  if (/\b(?:hero|lifestyle|brand|campaign|airplane|aircraft|plane|jet|flight|travel|runway|jumping|splash|water|boy|girl|family|street|building|portrait|person|people|caregiver)\b/.test(directHaystack)) {
    score -= 90;
  }

  if (/\b(?:tablet1|pill|pills|capsule|capsules|bottle|packshot|product shot|dosing options)\b/.test(directHaystack)) {
    score -= 85;
  }

  if (candidate.width && candidate.height) {
    if (candidate.width >= 240 && candidate.height >= 120) {
      score += 8;
    }
    if (candidate.width < 80 || candidate.height < 80) {
      score -= 40;
    }
  }

  return score;
}

function uniqueTopImages(
  candidates: ImageCandidate[],
  title: string | null,
  sourceUrl: string,
) {
  const seen = new Set<string>();

  return candidates
    .filter((candidate) => imageLooksUseful(candidate))
    .map((candidate) => ({
      ...candidate,
      score: scoreImage(candidate, title, sourceUrl),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }
      seen.add(candidate.url);
      return true;
    })
    .slice(0, 6)
    .map(({ score: _score, context: _context, ...candidate }) => candidate);
}

function documentLooksUseful(candidate: DocumentCandidate) {
  if (documentTitleLooksGeneric(candidate.title)) {
    return false;
  }

  const directHaystack = `${candidate.url} ${candidate.title}`.toLowerCase();
  const haystack =
    `${directHaystack} ${candidate.description ?? ""} ${candidate.context}`.toLowerCase();
  const clinicalDocumentPattern =
    /\b(?:guide|checklist|monitoring|adverse reaction|adverse reactions|patient management|dosing and administration|dosing administration|dosing guide|administration guide|dose modification|dose modifications|peripheral neuropathy|informational resource|prescribing information|full prescribing information|important safety information|isi|brochure|support solutions|patient education|patient materials)\b/;
  const lowValuePattern =
    /\b(?:overview|contact|representative|rep|cookie|privacy|terms|sitemap|site map|accessibility|unsubscribe|footer|header|logo|video library|social)\b/;
  const directClinicalSignal = clinicalDocumentPattern.test(directHaystack);
  const directLowValueSignal = lowValuePattern.test(directHaystack);

  if (!candidate.isPdf && !directClinicalSignal) {
    return false;
  }

  if (!candidate.isPdf && directLowValueSignal) {
    return false;
  }

  if (lowValuePattern.test(haystack) && !clinicalDocumentPattern.test(haystack)) {
    return false;
  }

  return candidate.isPdf || clinicalDocumentPattern.test(haystack);
}

function scoreDocument(candidate: DocumentCandidate, sourceUrl: string) {
  const parsedUrl = new URL(sourceUrl);
  const sourcePath = parsedUrl.pathname.toLowerCase();
  const haystack =
    `${candidate.url} ${candidate.title} ${candidate.description ?? ""} ${candidate.context}`.toLowerCase();
  let score = candidate.score;

  if (candidate.isPdf) {
    score += 40;
  }

  if (/\b(?:adverse reaction|adverse reactions|monitoring checklist|checklist|peripheral neuropathy|dose modification|dose modifications|dosing and administration|patient management)\b/.test(haystack)) {
    score += 70;
  }

  if (/\b(?:guide|informational resource|prescribing information|important safety information|isi|support solutions|patient education|brochure)\b/.test(haystack)) {
    score += 35;
  }

  if (/\b(?:neuropathy|rash|skin|hyperglycemia|pneumonitis|ocular|side effect|side effects|safety)\b/.test(haystack)) {
    score += 30;
  }

  if (/\b(?:dosing|administration|dose|infusion|schedule)\b/.test(haystack)) {
    score += 18;
  }

  if (/\b(?:resource|resources|support|patient)\b/.test(sourcePath)) {
    score += 10;
  }

  if (/\b(?:contact|representative|rep|cookie|privacy|terms|sitemap|accessibility|video library)\b/.test(haystack)) {
    score -= 60;
  }

  return score;
}

function uniqueTopDocuments(candidates: DocumentCandidate[], sourceUrl: string) {
  const seen = new Set<string>();

  return candidates
    .filter((candidate) => documentLooksUseful(candidate))
    .map((candidate) => ({
      ...candidate,
      score: scoreDocument(candidate, sourceUrl),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => {
      if (seen.has(candidate.url)) {
        return false;
      }
      seen.add(candidate.url);
      return true;
    })
    .slice(0, 8)
    .map(({ score: _score, context: _context, ...candidate }) => candidate);
}

function urlLooksLikePdf(url: string) {
  try {
    return /\.pdf(?:$|[?#])/i.test(new URL(url).pathname);
  } catch {
    return /\.pdf(?:$|[?#])/i.test(url);
  }
}

function urlLooksLikeImage(url: string) {
  try {
    return /\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i.test(new URL(url).pathname);
  } catch {
    return /\.(?:png|jpe?g|webp|gif)(?:$|[?#])/i.test(url);
  }
}

function curatedAssetLooksLikeImage(asset: CuratedSourceAsset) {
  const kind = asset.assetKind.toUpperCase();

  return (
    !urlLooksLikePdf(asset.url) &&
    ["CHART", "TABLE", "IMAGE"].includes(kind) &&
    urlLooksLikeImage(asset.url)
  );
}

function curatedAssetLooksLikeDocument(asset: CuratedSourceAsset) {
  return !curatedAssetLooksLikeImage(asset) || urlLooksLikePdf(asset.url);
}

function scoreCuratedAsset(asset: CuratedSourceAsset) {
  const haystack =
    `${asset.title} ${asset.description ?? ""} ${asset.url} ${asset.tags.join(" ")}`.toLowerCase();
  const kind = asset.assetKind.toUpperCase();
  let score = asset.priority;

  if (["CHART", "TABLE", "IMAGE"].includes(kind)) {
    score += 120;
  }

  if (kind === "PDF" || urlLooksLikePdf(asset.url)) {
    score += 90;
  }

  if (/\b(?:graph|chart|curve|kaplan|km|table|forest plot|pfs|overall survival|os|orr|hazard ratio|confidence interval|95% ci|ev-302|keynote|ev-301|ev-201|sequoia|alpine|aspen)\b/.test(haystack)) {
    score += 90;
  }

  if (/\b(?:guide|checklist|monitoring|dose modification|dosing and administration|peripheral neuropathy|adverse reaction|management resource)\b/.test(haystack)) {
    score += 80;
  }

  if (/\b(?:hero|lifestyle|campaign|airplane|aircraft|plane|jet|flight|travel|splash|product shot|pill|tablet|capsule)\b/.test(haystack)) {
    score -= 220;
  }

  return score;
}

function uniqueCuratedAssets(assets: CuratedSourceAsset[]) {
  const seen = new Set<string>();

  return [...assets]
    .map((asset) => ({ asset, score: scoreCuratedAsset(asset) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .filter(({ asset }) => {
      if (seen.has(asset.url)) {
        return false;
      }
      seen.add(asset.url);
      return true;
    })
    .map(({ asset }) => asset);
}

function curatedImages(assets: CuratedSourceAsset[]) {
  return uniqueCuratedAssets(assets)
    .filter(curatedAssetLooksLikeImage)
    .slice(0, 6)
    .map((asset) => ({
      url: asset.url,
      alt: asset.description ?? asset.title,
      width: null,
      height: null,
      source: "source_library" as const,
    }));
}

function curatedDocuments(assets: CuratedSourceAsset[]) {
  return uniqueCuratedAssets(assets)
    .filter(curatedAssetLooksLikeDocument)
    .slice(0, 8)
    .map((asset) => ({
      url: asset.url,
      title: asset.title,
      description: asset.description,
      isPdf: asset.assetKind.toUpperCase() === "PDF" || urlLooksLikePdf(asset.url),
      source: "source_library" as const,
    }));
}

function mergeByUrl<T extends { url: string }>(primary: T[], secondary: T[]) {
  const seen = new Set(primary.map((item) => item.url));

  return [
    ...primary,
    ...secondary.filter((item) => {
      if (seen.has(item.url)) {
        return false;
      }
      seen.add(item.url);
      return true;
    }),
  ];
}

function extractDocumentCandidates(html: string, sourceUrl: string) {
  const candidates: DocumentCandidate[] = [];

  for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const tag = match[0];
    const start = match.index ?? 0;
    const href = getAttribute(tag, "href");
    const url = absoluteUrl(href, sourceUrl);

    if (!url) {
      continue;
    }

    const context = getContextAround(html, start, start + tag.length);
    const label = resolveDocumentTitle({
      tag,
      html,
      start,
      url,
    });

    if (!label) {
      continue;
    }

    const isPdf = /\.pdf(?:$|[?#])/i.test(url);

    candidates.push({
      url,
      title: label,
      description: context,
      isPdf,
      source: isPdf ? "pdf_link" : "html_link",
      context,
      score: isPdf ? 42 : 22,
    });
  }

  return uniqueTopDocuments(candidates, sourceUrl);
}

function extractImageCandidates(html: string, sourceUrl: string, title: string | null) {
  const candidates: ImageCandidate[] = [];
  const ogImage = absoluteUrl(extractMetaContent(html, "og:image"), sourceUrl);
  const twitterImage = absoluteUrl(
    extractMetaContent(html, "twitter:image"),
    sourceUrl,
  );

  if (ogImage) {
    candidates.push({
      url: ogImage,
      alt: title,
      width: null,
      height: null,
      source: "open_graph",
      context: title ?? "",
      score: 18,
    });
  }

  if (twitterImage) {
    candidates.push({
      url: twitterImage,
      alt: title,
      width: null,
      height: null,
      source: "twitter",
      context: title ?? "",
      score: 16,
    });
  }

  for (const match of html.matchAll(/<picture\b[\s\S]*?<\/picture>/gi)) {
    const block = match[0];
    const start = match.index ?? 0;
    const context = getContextAround(html, start, start + block.length);
    const imgTag = block.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const fallbackAlt = getAttribute(imgTag, "alt");
    const fallbackWidth = parseNumberAttribute(getAttribute(imgTag, "width"));
    const fallbackHeight = parseNumberAttribute(getAttribute(imgTag, "height"));

    for (const sourceMatch of block.matchAll(/<source\b[^>]*>/gi)) {
      const tag = sourceMatch[0];
      const src = parseSrcSet(
        getAttribute(tag, "srcset") ?? getAttribute(tag, "data-srcset"),
      );
      const url = absoluteUrl(src, sourceUrl);

      if (!url) {
        continue;
      }

      candidates.push({
        url,
        alt: fallbackAlt,
        width: fallbackWidth,
        height: fallbackHeight,
        source: "html_image",
        context,
        score: 42,
      });
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const start = match.index ?? 0;
    const src =
      parseSrcSet(getAttribute(tag, "srcset") ?? getAttribute(tag, "data-srcset")) ??
      getAttribute(tag, "src") ??
      getAttribute(tag, "data-src") ??
      getAttribute(tag, "data-original");
    const url = absoluteUrl(src, sourceUrl);

    if (!url) {
      continue;
    }

    candidates.push({
      url,
      alt: getAttribute(tag, "alt"),
      width: parseNumberAttribute(getAttribute(tag, "width")),
      height: parseNumberAttribute(getAttribute(tag, "height")),
      source: "html_image",
      context: getContextAround(html, start, start + tag.length),
      score: 35,
    });
  }

  for (const match of html.matchAll(/url\((['"]?)([^'")]+)\1\)/gi)) {
    const start = match.index ?? 0;
    const url = absoluteUrl(match[2] ?? null, sourceUrl);

    if (!url) {
      continue;
    }

    candidates.push({
      url,
      alt: null,
      width: null,
      height: null,
      source: "html_image",
      context: getContextAround(html, start, start + match[0].length),
      score: 8,
    });
  }

  return uniqueTopImages(candidates, title, sourceUrl);
}

function extractTitle(html: string, fallbackTitle?: string) {
  const ogTitle = extractMetaContent(html, "og:title");
  if (ogTitle) {
    return ogTitle;
  }

  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    return decodeHtmlEntities(titleMatch[1].replace(/\s+/g, " "));
  }

  return fallbackTitle ?? null;
}

export async function previewSourceImages(
  input: MvpCustomGptSourcePreviewRequest,
) {
  const curatedAssetSignature = (input.assets ?? [])
    .map(
      (asset) =>
        `${asset.url}::${asset.assetKind}::${asset.priority}::${asset.title}`,
    )
    .join("|");
  const cacheKey = `${input.url}::${curatedAssetSignature}`;
  const cached = sourcePreviewCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const url = new URL(input.url);
  assertPreviewUrlAllowed(url);
  const inputImages = curatedImages(input.assets ?? []);
  const inputDocuments = curatedDocuments(input.assets ?? []);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SOURCE_PREVIEW_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Mozilla/5.0 source-preview-bot",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw new Error(`Source page returned ${response.status}.`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("Source page did not return HTML.");
    }

    const html = (await response.text()).slice(0, SOURCE_PREVIEW_MAX_HTML_CHARS);
    const title = extractTitle(html, input.title);
    const images = mergeByUrl(
      inputImages,
      extractImageCandidates(html, url.toString(), title),
    ).slice(0, 6);
    const documents = mergeByUrl(
      inputDocuments,
      extractDocumentCandidates(html, url.toString()),
    ).slice(0, 8);
    const result = mvpCustomGptSourcePreviewResponseSchema.parse({
      sourceUrl: url.toString(),
      title,
      images,
      documents,
      reason:
        images.length || documents.length
          ? null
          : "No useful image or document assets were found on this source page.",
    });

    sourcePreviewCache.set(cacheKey, result);
    return result;
  } catch (error) {
    const result = mvpCustomGptSourcePreviewResponseSchema.parse({
      sourceUrl: url.toString(),
      title: input.title ?? null,
      images: inputImages,
      documents: inputDocuments,
      reason:
        inputImages.length || inputDocuments.length
          ? null
          : error instanceof Error
            ? error.message
            : "Unable to preview source images.",
    });

    sourcePreviewCache.set(cacheKey, result);
    return result;
  }
}

export function resetSourcePreviewCache() {
  sourcePreviewCache.clear();
}
