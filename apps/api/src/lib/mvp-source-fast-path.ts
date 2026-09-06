import { moderatorPlanResultSchema, participantUnderstandingUpdateSchema, type ModeratorState } from "@interview/schemas";
import { isReferentialClarification } from "./controlled-rag-service";
import { isSourceRetryCue } from "./mvp-source-discussion";
import { requestsSimplerPresentation } from "./source-presentation";

/** Only an existing source discussion and a whole-message cue qualify. */
export function sourceDiscussionFastPath(state: ModeratorState, message: string, isResumeCue: boolean) {
  const discussion = state.sourceDiscussion;
  if (!discussion) return null;
  const retry = isSourceRetryCue(message);
  const clarification = isReferentialClarification(message);
  if (!isResumeCue && !retry && !clarification) return null;
  const kind = isResumeCue ? "resume" : retry ? "retry" : "clarification";
  const active = state.priorities.find((priority) => priority.id === state.activePriorityId && priority.status === "presented");
  const pending = state.priorities.find((priority) => priority.status === "pending");
  const rationale = `Deterministic source-discussion ${kind}: the whole-message cue supplies no research answer or new priority.`;
  const sourceRequest = kind === "resume" ? null : { kind: "clarification_request" as const, participantEvidence: message, resolvedQuestion: discussion.pendingQuestion ?? discussion.query };
  const plan = moderatorPlanResultSchema.parse({ newPriorities: [], reactionStatus: "not_answered", reactionEvidence: [], sourceRequest,
    action: kind !== "resume" ? "answer_source" : active ? "probe_reaction" : pending ? "present_priority" : "resume_guide",
    selectedPriorityId: kind !== "resume" ? active?.id ?? null : active?.id ?? pending?.id ?? null, rationale });
  const understandingUpdate = kind === "clarification" && requestsSimplerPresentation(message)
    ? participantUnderstandingUpdateSchema.parse({ version: 1, productFamiliarity: null, preferredDepth: "brief", participantEvidence: [message] }) : null;
  return { kind, plan, understandingUpdate };
}
