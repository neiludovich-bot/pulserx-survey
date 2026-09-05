import { moderatorPlanResultSchema, sourceRequestSchema, type ModeratorState } from "@interview/schemas";
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
      moderator: plan.success ? { action, plannedAction: plan.data.action, reactionStatus: plan.data.reactionStatus, sourceRequest: request(plan.data.sourceRequest), reactionSpans: spans(plan.data.reactionEvidence), plannerAttempts: typeof decision.plannerAttempts === "number" ? Math.max(0, Math.min(2, decision.plannerAttempts)) : null, plannerRecovered: decision.plannerRecovered === true } : null,
      state: { activePriorityIndex: input.state.priorities.findIndex((priority) => priority.id === input.state.activePriorityId), priorities: input.state.priorities.slice(0, 64).map((priority, index) => ({ index, status: priority.status, probeCount: priority.probeCount, reactionSpans: spans(priority.reactionEvidence) })), sourceDiscussionStatus: input.state.sourceDiscussion?.status ?? null },
    }));
  } catch { /* Diagnostics cannot affect interview selection or delivery. */ }
}
