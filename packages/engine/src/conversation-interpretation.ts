import {
  conversationInterpretationSchemaForSurvey, mvpTurnRouteAnalysisResultSchema,
  moderatorPlanTokenModelResultSchema, type ConversationInterpretationInput,
  type ConversationInterpretationResult, type ModeratorPlanInput,
} from "@interview/schemas";
import { evidenceFromTokenRange } from "./evidence-ranges";
import { normalizeModeratorPlanTokenResult } from "./moderator-evidence-ranges";

export function conversationRouteResult(message: string, result: ConversationInterpretationResult) {
  const request = result.sourceRequest;
  return mvpTurnRouteAnalysisResultSchema.parse({
    schemaVersion: 5, answerStatus: result.answerStatus,
    answerEvidence: result.answerEvidenceRanges.map(range => evidenceFromTokenRange(message, range)),
    sourceRequest: request ? { kind: request.kind, resolvedQuestion: request.resolvedQuestion,
      participantEvidence: evidenceFromTokenRange(message, request.participantEvidenceRange) } : null,
    understandingUpdate: result.understandingUpdate ? {
      version: 1, productFamiliarity: result.understandingUpdate.productFamiliarity,
      preferredDepth: result.understandingUpdate.preferredDepth,
      participantEvidence: result.understandingUpdate.participantEvidenceRanges.map(range => evidenceFromTokenRange(message, range)),
    } : null,
    asksSourceQuestion: Boolean(request), needsSource: Boolean(request) && !result.isOutOfScope,
    kind: result.isOutOfScope ? "out_of_scope" : request ? "source_question" : "planned_answer",
    topic: result.topic, isOutOfScope: result.isOutOfScope, isUnanticipated: Boolean(request),
    suggestedQuestionIds: result.suggestedQuestionIds,
    sourceDirective: request && !result.isOutOfScope ? request.resolvedQuestion : null,
    rationale: result.rationale,
  });
}

export function conversationModeratorPlan(input: ModeratorPlanInput, result: ConversationInterpretationResult) {
  // Only the interpreter's speech acts are reused. Action selection is rebuilt
  // from the validated, current application state after authored-answer updates.
  return normalizeModeratorPlanTokenResult(input, moderatorPlanTokenModelResultSchema.parse({
    schemaVersion: 5, sourceRequest: result.sourceRequest,
    reactionStatus: result.reactionStatus, reactionTargetPriorityId: result.reactionTargetPriorityId,
    reactionEvidenceRanges: result.reactionEvidenceRanges, priorityMentions: result.priorityMentions,
    action: "resume_guide", selectedPriorityId: null, rationale: result.rationale,
  }));
}

export function validateConversationInterpretation(input: ConversationInterpretationInput, output: unknown) {
  const result = conversationInterpretationSchemaForSurvey(input.surveySlug).parse(output);
  if (Boolean(result.sourceRequest) !== Boolean(result.sourceQuestionPlan)) {
    throw Object.assign(new Error("A source request requires its question plan, and no other turn may supply one."), { code: "invalid_schema" });
  }
  const route = conversationRouteResult(input.participantMessage, result);
  conversationModeratorPlan({ brand: input.sourceBrand, currentQuestion: input.currentQuestion,
    participantMessage: input.participantMessage, recentTurns: [], state: input.state,
    isPriorityQuestion: input.isPriorityQuestion, isResumeCue: input.isResumeCue,
    sourceRequest: route.sourceRequest, asksSourceQuestion: route.asksSourceQuestion, answerStatus: route.answerStatus }, result);
  return result;
}
