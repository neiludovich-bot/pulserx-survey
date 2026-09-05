import { sourceQuestionPlanSchema, type SourceQuestionPlan, type SourceQuestionPlanInput } from "@interview/schemas";
import { getOptionalOpenAIGateway } from "./model-gateway";

/** Interpret the information need; this step neither supplies facts nor advances research. */
export async function planSourceQuestion(input: SourceQuestionPlanInput): Promise<SourceQuestionPlan | null> {
  const gateway = getOptionalOpenAIGateway();
  if (!gateway?.planSourceQuestion) return null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return sourceQuestionPlanSchema.parse((await gateway.planSourceQuestion(input)).result);
    } catch {
      console.warn({ event: "source_question_planning_failed", attempt });
    }
  }
  // An unavailable interpretation does not authorize an invented medical answer.
  return null;
}
