import { sourceTurnOutcomeSchema, type SourceTurnOutcome } from "@interview/schemas";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" ? value as RecordValue : {};
}

// Persist diagnostic categories and provider IDs, never rejected drafts or
// arbitrary provider error messages (which can contain respondent content).
function failureCode(value: unknown): string {
  const error = record(value);
  const message = typeof error.message === "string" ? error.message : typeof value === "string" ? value : "";
  if (message.includes("unsupported claims")) return "unsupported_claims";
  if (message.includes("individual citations")) return "citation_mismatch";
  if (message.includes("contextual source")) return "missing_contextual_citation";
  if (message.includes("append a question")) return "unexpected_question";
  if (message.includes("exact draft excerpts")) return "invalid_grounding_verdict";
  if (message.includes("returned no parsed output")) return "missing_structured_output";
  if (error.name === "ZodError") return "invalid_schema";
  if (error.status === 429) return "rate_limited";
  if (error.status === 401 || error.status === 403) return "authentication_failed";
  if (error.name === "APIConnectionTimeoutError") return "provider_timeout";
  return "composition_unavailable";
}

function traceAttempt(trace: unknown, stage: "composition" | "grounding", code: string) {
  const parsed = record(trace);
  const response = record(parsed.response);
  const request = record(parsed.request);
  return { stage, code,
    responseId: typeof response.id === "string" ? response.id.slice(0, 200) : null,
    model: typeof response.model === "string" ? response.model.slice(0, 120) : typeof request.model === "string" ? request.model.slice(0, 120) : null,
  };
}

export function sourceTurnOutcome(status: SourceTurnOutcome["status"], value?: unknown): SourceTurnOutcome {
  const input = record(value);
  const entries = Array.isArray(input.contextualCompositionAttempts) ? input.contextualCompositionAttempts.slice(-2) : [];
  const attempts = entries.flatMap((entry: unknown) => {
    const attempt = record(entry);
    const code = attempt.error ? failureCode(attempt.error) : "supported";
    return [
      ...(attempt.trace ? [traceAttempt(attempt.trace, "composition", attempt.groundingTrace ? "composed" : code)] : []),
      ...(attempt.groundingTrace ? [traceAttempt(attempt.groundingTrace, "grounding", code)] : []),
      ...(!attempt.trace && !attempt.groundingTrace ? [traceAttempt(null, "composition", code)] : []),
    ];
  });
  if (!attempts.length && value) attempts.push(traceAttempt(input.trace, "composition", status === "success" ? "composed" : failureCode(value)));
  const rejected = status !== "success" && attempts.some((attempt) => attempt.code === "unsupported_claims");
  return sourceTurnOutcomeSchema.parse({ version: 1, status: rejected ? "grounding_rejected" : status, attempts });
}
