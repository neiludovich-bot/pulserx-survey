import { sourceQuestionPlanSchema, type SourceQuestionPlan, type SourceQuestionPlanInput } from "@interview/schemas";
import { getOptionalOpenAIGateway } from "./model-gateway";

/** Interpret the information need; this step neither supplies facts nor advances research. */
export async function planSourceQuestion(input: SourceQuestionPlanInput): Promise<SourceQuestionPlan | null> {
  const gateway = getOptionalOpenAIGateway();
  if (!gateway?.planSourceQuestion) return null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return sourceQuestionPlanSchema.parse((await gateway.planSourceQuestion(input)).result);
    } catch (error) {
      const record = error && typeof error === "object" ? error as { name?: unknown; status?: unknown } : {};
      const known = new Set(["Error", "ZodError", "APIError", "AuthenticationError", "PermissionDeniedError", "RateLimitError", "APIConnectionError", "APIConnectionTimeoutError", "BadRequestError", "InternalServerError"]);
      console.warn({ event: "source_question_planning_failed", attempt,
        category: typeof record.name === "string" && known.has(record.name) ? record.name : "Error",
        status: typeof record.status === "number" ? record.status : null });
    }
  }
  // An unavailable interpretation does not authorize an invented medical answer.
  return null;
}
