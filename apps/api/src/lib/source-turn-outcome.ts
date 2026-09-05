import { sourceTurnOutcomeSchema, type SourceTurnOutcome } from "@interview/schemas";
import { sanitizeSourceFailure } from "@interview/engine";

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return value !== null && typeof value === "object" ? value as RecordValue : {};
}

// Persist diagnostic categories and provider IDs, never rejected drafts or
// arbitrary provider error messages (which can contain respondent content).
function failureCode(value: unknown): string {
  return sanitizeSourceFailure(value, "composition").code;
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
    const failure = attempt.failure ? sanitizeSourceFailure(attempt.failure, record(attempt.failure).stage === "grounding" ? "grounding" : "composition") : null;
    const code = failure?.code ?? (attempt.error ? failureCode(attempt.error) : "supported");
    const failedGrounding = failure?.stage === "grounding";
    return [
      ...(attempt.trace ? [traceAttempt(attempt.trace, "composition", attempt.groundingTrace || failedGrounding ? "composed" : code)] : []),
      ...(attempt.groundingTrace ? [traceAttempt(attempt.groundingTrace, "grounding", code)] : []),
      ...(!attempt.groundingTrace && failedGrounding ? [traceAttempt(null, "grounding", code)] : []),
      ...(!attempt.trace && !attempt.groundingTrace && !failedGrounding ? [traceAttempt(null, "composition", code)] : []),
    ];
  });
  if (!attempts.length && value) attempts.push(traceAttempt(input.trace, "composition", status === "success" ? "composed" : failureCode(value)));
  const rejected = status !== "success" && attempts.some((attempt) => attempt.code === "unsupported_claims");
  return sourceTurnOutcomeSchema.parse({ version: 1, status: rejected ? "grounding_rejected" : status, attempts });
}
