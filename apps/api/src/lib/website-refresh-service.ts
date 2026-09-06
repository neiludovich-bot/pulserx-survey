import { randomUUID } from "node:crypto";
import { websiteRefreshSettingsSchema, websiteRefreshStateSchema, type WebsiteRefreshState } from "@interview/schemas";
import { prisma } from "./prisma";
import { indexMedicalWebsite } from "./website-crawler";
import { applyWebsiteIndex } from "./website-index-service";

const TAG = "website-refresh-config:v1";
const configId = (slug: string) => `website-refresh:${slug}`;
export function refreshDue(state: WebsiteRefreshState, now: number) {
  if (state.status === "running") return Math.min(Date.parse(state.leaseUntil ?? ""), (state.heartbeatAt || state.lastStartedAt ? Date.parse((state.heartbeatAt ?? state.lastStartedAt)!) + 180000 : Infinity)) <= now;
  return (state.enabled || state.status === "queued") && Date.parse(state.nextRunAt) <= now;
}
export function initialRefreshState(input: unknown, now = new Date()): WebsiteRefreshState {
  return { ...websiteRefreshSettingsSchema.parse(input), version: 1, nextRunAt: now.toISOString(), status: "queued", runId: null, leaseUntil: null, heartbeatAt: null, lastStartedAt: null, lastFinishedAt: null, lastError: null, lastReportId: null, summary: null };
}
export async function listWebsiteRefreshes() {
  const rows = await prisma.sourceDocument.findMany({ where: { tags: { has: TAG }, status: "DRAFT" }, orderBy: { surveySlug: "asc" } });
  return { websites: rows.map(row => websiteRefreshStateSchema.parse(JSON.parse(row.content!))) };
}
export async function websiteRefreshProfile(slug: string) {
  const row = await prisma.sourceDocument.findUnique({ where: { id: configId(slug) } });
  return row ? websiteRefreshStateSchema.parse(JSON.parse(row.content!)).profile : undefined;
}
export async function saveWebsiteRefresh(input: unknown) {
  const settings = websiteRefreshSettingsSchema.parse(input);
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${configId(settings.surveySlug)}))`;
    const row = await tx.sourceDocument.findUnique({ where: { id: configId(settings.surveySlug) } });
    const prior = row ? websiteRefreshStateSchema.parse(JSON.parse(row.content!)) : null;
    if (prior?.status === "running") throw new Error("Wait for the current refresh to finish before changing its settings.");
    const state = prior ? { ...prior, ...settings, status: "queued" as const, nextRunAt: new Date().toISOString() } : initialRefreshState(settings);
    if (row) {
      const changed = await tx.sourceDocument.updateMany({ where: { id: row.id, content: row.content }, data: { content: JSON.stringify(state) } });
      if (!changed.count) throw new Error("Refresh started while saving; try again after it finishes.");
    } else await tx.sourceDocument.create({ data: { id: configId(settings.surveySlug), surveySlug: settings.surveySlug, sourceBrand: settings.surveySlug.toUpperCase(), title: "Website refresh configuration", sourceType: "MANUAL_NOTE", status: "DRAFT", tags: [TAG], content: JSON.stringify(state) } });
    return state;
  });
}
export async function queueWebsiteRefresh(slug: string) {
  const row = await prisma.sourceDocument.findUnique({ where: { id: configId(slug) } });
  if (!row) throw new Error("Save the website settings first.");
  const state = websiteRefreshStateSchema.parse(JSON.parse(row.content!));
  if (state.status === "running") return state;
  const queued = { ...state, status: "queued" as const, nextRunAt: new Date().toISOString() };
  const result = await prisma.sourceDocument.updateMany({ where: { id: row.id, content: row.content }, data: { content: JSON.stringify(queued) } });
  if (!result.count) throw new Error("Refresh state changed; reload its status.");
  return queued;
}

/** Durable CAS claim prevents duplicate work across API instances. Interrupted jobs resume after lease expiry. */
export async function runWebsiteRefreshTick() {
  const rows = await prisma.sourceDocument.findMany({ where: { tags: { has: TAG }, status: "DRAFT" }, orderBy: { updatedAt: "asc" } });
  for (const row of rows) {
    const state = websiteRefreshStateSchema.parse(JSON.parse(row.content!));
    if (!refreshDue(state, Date.now())) continue;
    const started = new Date();
    let running: WebsiteRefreshState = { ...state, status: "running", runId: randomUUID(), lastStartedAt: started.toISOString(), heartbeatAt: started.toISOString(), leaseUntil: new Date(started.getTime() + 180000).toISOString(), lastError: null };
    const claim = await prisma.sourceDocument.updateMany({ where: { id: row.id, content: row.content }, data: { content: JSON.stringify(running) } });
    if (!claim.count) continue;
    let leaseLost = false;
    let heartbeatWork = Promise.resolve();
    const heartbeat = setInterval(() => {
      heartbeatWork = heartbeatWork.then(async () => {
        const now = new Date();
        const renewed = { ...running, heartbeatAt: now.toISOString(), leaseUntil: new Date(now.getTime() + 180000).toISOString() };
        const updated = await prisma.sourceDocument.updateMany({ where: { id: row.id, content: JSON.stringify(running) }, data: { content: JSON.stringify(renewed) } });
        if (updated.count) running = renewed; else leaseLost = true;
      }).catch(() => { leaseLost = true; });
    }, 30000);
    heartbeat.unref();
    let finished: WebsiteRefreshState;
    try {
      const snapshot = await indexMedicalWebsite(state.surveySlug, state.profile);
      // A failed root must not replace a previously healthy index with error-page content.
      if (!snapshot.pages.some(p => p.sourceType === "URL" && new URL(p.url).pathname === new URL(state.profile.rootUrl).pathname)) throw new Error("Root page was not indexed; existing evidence retained.");
      clearInterval(heartbeat); await heartbeatWork;
      if (leaseLost) continue;
      const current = await prisma.sourceDocument.findUnique({ where: { id: row.id } });
      if (current?.content !== JSON.stringify(running)) continue;
      const report = await applyWebsiteIndex(snapshot, state.profile);
      finished = { ...running, status: "completed", summary: { pages: snapshot.pages.length, images: snapshot.pages.reduce((n,p)=>n+p.assets.length,0), tables: snapshot.pages.reduce((n,p)=>n+p.tables.length,0), issueCount: report.issues.length, truncated: snapshot.truncated, issues: report.issues.slice(0,20) }, lastReportId: report.reportId, lastError: report.issues.length ? `${report.issues.length} crawl issues; review the coverage report.` : null };
    } catch (error) {
      finished = { ...running, status: "failed", lastError: (error instanceof Error ? error.message : "Website refresh failed").slice(0, 1000) };
    }
    clearInterval(heartbeat); await heartbeatWork;
    if (leaseLost) return;
    const now = new Date();
    finished = { ...finished, lastFinishedAt: now.toISOString(), leaseUntil: null, nextRunAt: new Date(now.getTime() + (finished.status === "failed" ? 24 : state.intervalHours) * 3600000).toISOString() };
    await prisma.sourceDocument.updateMany({ where: { id: row.id, content: JSON.stringify(running) }, data: { content: JSON.stringify(finished) } });
    return; // One crawl at a time; do not monopolize the API process.
  }
}

export function startWebsiteRefreshWorker(onError: (error: unknown) => void) {
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await runWebsiteRefreshTick(); } catch (error) { onError(error); } finally { busy = false; } };
  const timer = setInterval(() => { void tick(); }, 30000);
  timer.unref();
  void tick();
  return () => clearInterval(timer);
}
