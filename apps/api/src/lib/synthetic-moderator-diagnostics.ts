import { moderatorPlanResultSchema, sourceRequestSchema, type ModeratorState } from "@interview/schemas";
import { sanitizeSourceFailure } from "@interview/engine";
import type { MvpHybridTurnRouteDecision } from "./mvp-openai-turn-router";

type Input = {
  studyName: string;
  surveySlug: "nubeqa" | "brukinsa" | "padcev";
  phase: "before_moderator" | "after_moderator";
  turnSequence: number;
  participantMessage: string;
  route: MvpHybridTurnRouteDecision;
  state: ModeratorState;
  moderatorDecision?: unknown;
};
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};
const validationFailures: Record<string, string> = {
  "Source request evidence must be an exact participant excerpt.": "invalid_request_excerpt",
  "Source requests require an exact excerpt of the current participant message.": "invalid_request_excerpt",
  "Moderator evidence must be an exact participant excerpt.": "invalid_reaction_excerpt",
  "Moderator evidence must be exact excerpts of the current participant message.": "invalid_reaction_excerpt",
  "Evidence excerpts cannot be empty.": "empty_evidence",
  "A source-answer action must preserve the identified participant request.": "request_action_mismatch",
  "A navigation cue cannot supply priorities or reaction evidence.": "navigation_credit",
  "Reaction credit requires an active presented priority.": "missing_active_priority",
  "The moderator selected an unknown priority ID.": "unknown_priority",
  "A participant source question must retain its source-answer action.": "lost_source_action",
  "Presentation must select a pending or newly extracted priority.": "invalid_presentation_target",
  "A reaction probe requires an unanswered active presented priority within its probe budget.": "invalid_probe_target",
  "Resuming the guide cannot select a priority.": "invalid_resume_target",
};
const plannerFields = new Set(["state", "priorities", "sourceDiscussion", "returnTarget", "pendingQuestion", "query", "status", "failure", "message", "navigationHintShown", "priorityMentions", "sourceRequest", "participantEvidence", "resolvedQuestion", "reactionStatus", "reactionEvidence", "action", "selectedPriorityId", "newPriorities", "label", "sourceQuestion", "existingPriorityId", "kind", "additionEvidence", "rationale"]);

export function sanitizeModeratorPlanningFailure(error: unknown) {
  const { stage: _stage, ...safe } = sanitizeSourceFailure(error, "composition");
  const raw = record(error);
  const code = typeof raw.code === "string" && Object.values(validationFailures).includes(raw.code) ? raw.code : typeof raw.message === "string" && Object.prototype.hasOwnProperty.call(validationFailures, raw.message) ? validationFailures[raw.message]! : safe.code === "composition_unavailable" ? "planning_unavailable" : safe.code;
  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  return { ...safe, code, issues: safe.issues.map((issue, index) => ({ ...issue, path: (Array.isArray(record(rawIssues[index]).path) ? record(rawIssues[index]).path as unknown[] : []).slice(0, 6).map((part) => typeof part === "number" && Number.isInteger(part) && part >= 0 || part === "[]" ? "[]" : typeof part === "string" && plannerFields.has(part) ? part : "[unknown]") })) };
}

/** Synthetic QA only; emit speech-act spans, never messages, labels or IDs. */
export function logSyntheticModeratorDecision(input: Input): void {
  if (!input.studyName.startsWith("SYNTHETIC QA ")) return;
  try {
    const spans = (excerpts: string[]) => excerpts.slice(0, 16).map((excerpt) => {
      const start = input.participantMessage.indexOf(excerpt);
      return start < 0 ? null : { start, length: excerpt.length };
    });
    const request = (value: unknown) => {
      const parsed = sourceRequestSchema.safeParse(value);
      return parsed.success ? { kind: parsed.data.kind, span: spans([parsed.data.participantEvidence])[0] } : null;
    };
    const decision = record(input.moderatorDecision);
    const plan = moderatorPlanResultSchema.safeParse(decision.plan);
    const answerStatus = ["answered", "partial", "not_answered"].includes(input.route.answerStatus) ? input.route.answerStatus : "unknown";
    const action = typeof decision.action === "string" && ["present_priority", "probe_reaction", "answer_source", "resume_guide"].includes(decision.action) ? decision.action : null;
    console.warn(JSON.stringify({
      event: "synthetic_moderator_decision", phase: input.phase, surveySlug: input.surveySlug, turnSequence: input.turnSequence,
      router: { provider: ["openai_hybrid", "deterministic"].includes(input.route.provider) ? input.route.provider : "unknown", answerStatus, asksSourceQuestion: Boolean(input.route.asksSourceQuestion), sourceRequestProvided: input.route.sourceRequest !== undefined, sourceRequest: request(input.route.sourceRequest), answerSpans: spans(input.route.answerEvidence) },
      moderator: plan.success ? { action, plannedAction: plan.data.action, reactionStatus: plan.data.reactionStatus, sourceRequest: request(plan.data.sourceRequest), reactionSpans: spans(plan.data.reactionEvidence), plannerAttempts: typeof decision.plannerAttempts === "number" ? Math.max(0, Math.min(2, decision.plannerAttempts)) : null, plannerRecovered: decision.plannerRecovered === true, plannerFailures: Array.isArray(decision.plannerFailures) ? decision.plannerFailures.slice(0, 2).map(sanitizeModeratorPlanningFailure) : [] } : null,
      state: { activePriorityIndex: input.state.priorities.findIndex((priority) => priority.id === input.state.activePriorityId), priorities: input.state.priorities.slice(0, 64).map((priority, index) => ({ index, status: priority.status, probeCount: priority.probeCount, reactionSpans: spans(priority.reactionEvidence) })), sourceDiscussionStatus: input.state.sourceDiscussion?.status ?? null },
    }));
  } catch { /* Diagnostics cannot affect interview selection or delivery. */ }
}
