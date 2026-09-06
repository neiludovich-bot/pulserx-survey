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
  version: z.literal(1), surveySlug: z.enum(["nubeqa", "brukinsa", "padcev"]),
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
export function allowedWebsiteIndexUrl(slug: WebsiteIndexSnapshot["surveySlug"], value: string, document = false) {
  try {
    const url = new URL(value); const profile = WEBSITE_PROFILES[slug];
    return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search &&
      ((profile.hosts as readonly string[]).includes(url.hostname) ||
       (document && /\.pdf$/i.test(url.pathname) && (profile.documentHosts as readonly string[]).includes(url.hostname)));
  } catch { return false; }
}
