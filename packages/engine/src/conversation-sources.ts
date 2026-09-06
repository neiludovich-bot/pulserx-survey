import { websiteAnswerModelResultSchema, type WebsiteAnswerModelResult } from "@interview/schemas";

/** Multiple same-role passages from one page share one citation. No claims or roles change. */
export function coalesceConversationSources(output: WebsiteAnswerModelResult) {
  const result = websiteAnswerModelResultSchema.parse(output);
  const sources = new Map<string, WebsiteAnswerModelResult["selections"][number]>();
  for (const selection of result.selections) {
    const prior = sources.get(selection.sourceId);
    if (!prior) sources.set(selection.sourceId, structuredClone(selection));
    else {
      if (prior.evidenceRole !== selection.evidenceRole || prior.contribution !== selection.contribution) throw new Error("Conflicting roles for one evidence source.");
      prior.supportSpanRange = { startSpan: Math.min(prior.supportSpanRange.startSpan, selection.supportSpanRange.startSpan), endSpan: Math.max(prior.supportSpanRange.endSpan, selection.supportSpanRange.endSpan) };
      prior.assetIds = [...new Set([...prior.assetIds, ...selection.assetIds])];
    }
  }
  return websiteAnswerModelResultSchema.parse({ ...result, selections: [...sources.values()] });
}
