import { sourceGroundingReviewInputSchema, sourceGroundingReviewResultSchema } from "@interview/schemas";

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

// Detailed rejected-claim diagnostics are reserved for explicitly labeled synthetic QA.
// Never log the enclosing request, draft, participant context, or provider response.
export function logSyntheticGroundingDiagnostics(surveyContext: string, error: unknown): void {
  if (!surveyContext.startsWith("Study: SYNTHETIC QA ")) return;
  try {
    const entries = record(error).contextualCompositionAttempts;
    if (!Array.isArray(entries)) return;
    const attempts = entries.slice(-2).flatMap((entry: unknown) => {
      const trace = record(record(entry).groundingTrace);
      const response = record(trace.response);
      const reviewed = sourceGroundingReviewResultSchema.safeParse(record(response.raw).output_parsed);
      const request = sourceGroundingReviewInputSchema.safeParse(record(trace.request).input);
      if (!reviewed.success || !request.success || reviewed.data.supported || !reviewed.data.unsupportedClaims.length) return [];
      // Only include a review of actual draft text, matching the runtime's grounding check.
      if (reviewed.data.unsupportedClaims.some(({ excerpt }) =>
        !request.data.draft.practicalAnswer.includes(excerpt) && !request.data.draft.qualification?.includes(excerpt))) return [];
      return [{
        responseId: typeof response.id === "string" ? response.id.slice(0, 200) : null,
        unsupportedClaims: reviewed.data.unsupportedClaims.slice(0, 6).map(({ excerpt, reason }) => ({
          excerpt: excerpt.slice(0, 500), reason: reason.slice(0, 400),
        })),
        sources: request.data.sources.map(({ index, text }) => ({ index, text: text.slice(0, 1500) })),
      }];
    });
    if (attempts.length) console.warn(JSON.stringify({ event: "source_qa_grounding_diagnostics", attempts }));
  } catch {
    // Diagnostics must never change source delivery or recovery behavior.
  }
}
