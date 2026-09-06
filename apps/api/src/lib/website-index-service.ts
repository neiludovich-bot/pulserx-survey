import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { websiteIndexSnapshotSchema, WEBSITE_PROFILES, allowedWebsiteIndexUrl } from "@interview/schemas";
import { prisma } from "./prisma";
import { chunkSourceText } from "./source-text-chunks";

const INDEX_TAG = "website-index:v1";
export function prepareWebsiteIndex(input: unknown) {
  const snapshot = websiteIndexSnapshotSchema.parse(input);
  if (snapshot.rootUrl !== WEBSITE_PROFILES[snapshot.surveySlug].rootUrl) throw new Error("Snapshot root does not match the bot's approved website.");
  const pages = snapshot.pages.map(page => {
    if (!allowedWebsiteIndexUrl(snapshot.surveySlug, page.url, page.sourceType === "PDF") || !allowedWebsiteIndexUrl(snapshot.surveySlug, page.discoveredFrom)) throw new Error("Indexed page or discovery link is outside the bot's approved website.");
    const digest = createHash("sha256").update(page.content).digest("hex");
    if (digest !== page.hash) throw new Error("Indexed page hash does not match its content.");
    // Asset changes also require a version, without mutating earlier citations.
    const versionHash = createHash("sha256").update(JSON.stringify([page.hash, page.title, page.assets])).digest("hex");
    return { ...page, versionHash, chunks: chunkSourceText(page.content).map(text => `${page.title}\n\n${text}`) };
  });
  return { snapshot, pages };
}

/** Append versions and archive only superseded crawler-owned versions. Never
 * delete evidence or remove pages merely because a crawl failed to find them. */
export async function applyWebsiteIndex(input: unknown) {
  const { snapshot, pages } = prepareWebsiteIndex(input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`website-index:${snapshot.surveySlug}`}))`;
    const prior = await tx.sourceDocument.findMany({ where: { surveySlug: snapshot.surveySlug, tags: { has: INDEX_TAG }, status: "ACTIVE" } });
    let created = 0; let unchanged = 0; let archived = 0;
    const createdIds: string[] = []; const archivedIds: string[] = [];
    for (const page of pages) {
      const current = prior.filter(doc => doc.url === page.url);
      const versionTag = `version:${page.versionHash}`;
      if (current.some(doc => doc.tags.includes(versionTag))) { unchanged++; continue; }
      const doc = await tx.sourceDocument.create({ data: {
        surveySlug: snapshot.surveySlug, sourceBrand: snapshot.surveySlug.toUpperCase(), title: page.title,
        description: `Website index captured ${snapshot.fetchedAt}. Discovered on ${page.discoveredFrom}`,
        sourceType: page.sourceType, url: page.url, content: page.content, tags: [INDEX_TAG, versionTag], priority: 50, status: "ACTIVE",
      } });
      createdIds.push(doc.id);
      await tx.sourceChunk.createMany({ data: page.chunks.map((content, position) => ({ sourceDocumentId: doc.id, surveySlug: snapshot.surveySlug, content, position, tags: [INDEX_TAG], tokenEstimate: Math.ceil(content.length / 4), metadata: { version: 1, sourceUrl: page.url, sourceHash: page.hash, fetchedAt: snapshot.fetchedAt, discoveredFrom: page.discoveredFrom } })) });
      if (page.assets.length) await tx.sourceAsset.createMany({ data: page.assets.map(asset => ({ ...asset, sourceDocumentId: doc.id, surveySlug: snapshot.surveySlug, tags: [INDEX_TAG], priority: 10, metadata: { sourceUrl: page.url, sourceHash: page.hash } })) });
      if (current.length) { const result = await tx.sourceDocument.updateMany({ where: { id: { in: current.map(doc => doc.id) }, surveySlug: snapshot.surveySlug, tags: { has: INDEX_TAG } }, data: { status: "ARCHIVED" } }); archived += result.count; archivedIds.push(...current.map(doc => doc.id)); }
      created++;
    }
    const report = { version: 1, rootUrl: snapshot.rootUrl, fetchedAt: snapshot.fetchedAt, created, unchanged, archived,
      indexedPages: pages.length, createdIds, archivedIds, discoveredUrls: snapshot.discoveredUrls, issues: snapshot.issues, truncated: snapshot.truncated,
      pageVersions: pages.map(page => ({ url: page.url, hash: page.hash, chunks: page.chunks.length, assets: page.assets.length })) };
    const manifest = await tx.sourceDocument.create({ data: { surveySlug: snapshot.surveySlug, sourceBrand: snapshot.surveySlug.toUpperCase(), title: `Website index report ${snapshot.fetchedAt}`, sourceType: "MANUAL_NOTE", content: JSON.stringify(report), tags: ["website-index-report:v1"], status: "DRAFT" } });
    return { reportId: manifest.id, created, unchanged, archived, indexedPages: pages.length, issues: snapshot.issues, truncated: snapshot.truncated };
  }, { timeout: 120000, maxWait: 15000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function websiteIndexReports(surveySlug: string) {
  const reports = await prisma.sourceDocument.findMany({ where: { surveySlug, tags: { has: "website-index-report:v1" } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, content: true, createdAt: true } });
  return { reports: reports.map(report => ({ id: report.id, createdAt: report.createdAt.toISOString(), report: JSON.parse(report.content ?? "{}") })) };
}
