import { z } from "zod";

export const websiteTableSchema = z.object({
  title: z.string().min(1).max(500),
  rows: z.array(z.array(z.object({ text: z.string().max(2000), header: z.boolean(), rowSpan: z.number().int().min(1).max(100), colSpan: z.number().int().min(1).max(20) }).strict()).min(1).max(20)).min(2).max(100),
  notes: z.array(z.string().max(10000)).max(30),
}).strict();
export type WebsiteTable = z.infer<typeof websiteTableSchema>;

export const websiteIndexPageSchema = z.object({
  url: z.string().url(), discoveredFrom: z.string().url(), title: z.string().min(1).max(240),
  content: z.string().min(1).max(300000), sourceType: z.enum(["URL", "PDF"]),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
  assets: z.array(z.object({ title: z.string().min(1).max(240), description: z.string().max(1000), url: z.string().url(), assetKind: z.literal("IMAGE") }).strict()).max(24),
  tables: z.array(websiteTableSchema).max(24).default([]),
}).strict();
export const websiteIndexSnapshotSchema = z.object({
  version: z.literal(1), surveySlug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  rootUrl: z.string().url(), fetchedAt: z.string().datetime(),
  pages: z.array(websiteIndexPageSchema).min(1).max(1000),
  issues: z.array(z.object({ url: z.string().url(), reason: z.string().max(1000) }).strict()).max(2000),
  discoveredUrls: z.array(z.string().url()).max(2000),
  truncated: z.boolean(),
}).strict().superRefine((snapshot, ctx) => {
  if (new Set(snapshot.pages.map(p => p.url)).size !== snapshot.pages.length) ctx.addIssue({ code: "custom", message: "Duplicate indexed page URLs" });
});
export type WebsiteIndexSnapshot = z.infer<typeof websiteIndexSnapshotSchema>;

export const WEBSITE_PROFILES = {
  nubeqa: { rootUrl: "https://www.nubeqahcp.com/", hosts: ["www.nubeqahcp.com", "nubeqahcp.com"], documentHosts: ["labeling.bayerhealthcare.com"] },
  brukinsa: { rootUrl: "https://www.brukinsahcp.com/", hosts: ["www.brukinsahcp.com", "brukinsahcp.com"], documentHosts: ["www.brukinsa.com", "brukinsa.com"] },
  padcev: { rootUrl: "https://www.padcevhcp.com/", hosts: ["www.padcevhcp.com", "padcevhcp.com"], documentHosts: ["astellas.us", "www.astellas.us"] },
} as const;

/** Exact approved domains, no credentials, query crawling or alternate ports. */
export function allowedWebsiteIndexUrl(slug: WebsiteIndexSnapshot["surveySlug"], value: string, document = false, configuredProfile?: WebsiteProfile) {
  try {
    const url = new URL(value); const profile = configuredProfile ?? WEBSITE_PROFILES[slug as keyof typeof WEBSITE_PROFILES];
    if (!profile) return false;
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search &&
      ((profile.hosts as readonly string[]).includes(url.hostname) ||
       (document && /\.pdf$/i.test(url.pathname) && (profile.documentHosts as readonly string[]).includes(url.hostname)));
  } catch { return false; }
}

export const websiteProfileSchema = z.object({
  rootUrl: z.string().url().refine(value => { const u = new URL(value); return u.protocol === "https:" && !u.port && !u.username && !u.password && !u.search && !u.hash; }, "Use a public HTTPS website URL"),
  hosts: z.array(z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)).min(1).max(10),
  documentHosts: z.array(z.string().regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/)).max(10),
}).strict().refine(p => p.hosts.includes(new URL(p.rootUrl).hostname), "Root hostname must be approved");
export type WebsiteProfile = z.infer<typeof websiteProfileSchema>;
export const websiteRefreshSettingsSchema = z.object({
  surveySlug: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  profile: websiteProfileSchema,
  intervalHours: z.number().int().min(24).max(720).default(168),
  enabled: z.boolean().default(true),
}).strict();
export const websiteRefreshStateSchema = websiteRefreshSettingsSchema.extend({
  version: z.literal(1), nextRunAt: z.string().datetime(),
  status: z.enum(["queued", "running", "completed", "failed"]),
  runId: z.string().nullable(), leaseUntil: z.string().datetime().nullable(), heartbeatAt: z.string().datetime().nullable().default(null),
  lastStartedAt: z.string().datetime().nullable(), lastFinishedAt: z.string().datetime().nullable(),
  lastError: z.string().nullable(), lastReportId: z.string().nullable(),
  summary: z.object({ pages: z.number().int(), images: z.number().int(), tables: z.number().int(), issueCount: z.number().int(), truncated: z.boolean(), issues: z.array(z.object({ url: z.string(), reason: z.string() }).strict()).max(20) }).strict().nullable().default(null),
});
export type WebsiteRefreshSettings = z.infer<typeof websiteRefreshSettingsSchema>;
export type WebsiteRefreshState = z.infer<typeof websiteRefreshStateSchema>;
