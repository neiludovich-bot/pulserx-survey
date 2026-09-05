import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeratorPlanInput, ModeratorPlanResult, ModeratorPhrasingInput } from "@interview/schemas";
import { env } from "../env";
import type { SourceAnswerProviderInput } from "./source-answer-service";
import {
  resetMvpCustomGptSurveySessions,
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
} from "./mvp-customgpt-survey-service";

const mocks = vi.hoisted(() => ({ plan: vi.fn(), phrase: vi.fn(), source: vi.fn(), persist: vi.fn() }));
vi.mock("./model-gateway", () => ({
  getOptionalOpenAIGateway: () => ({ planModeratorTurn: mocks.plan, phraseModeratorTurn: mocks.phrase }),
}));
vi.mock("./source-answer-service", () => ({ askSourceProviderForSurveyInterviewerTurn: mocks.source }));
vi.mock("./mvp-survey-persistence", () => ({
  loadMvpSurveySessionSnapshot: vi.fn(async () => null),
  persistMvpSurveySessionStarted: vi.fn(async () => undefined),
  persistMvpSurveyTurnAudit: mocks.persist,
}));

const originalEnv = {
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  CUSTOMGPT_API_KEY: env.CUSTOMGPT_API_KEY,
  MVP_SOURCE_PROVIDER: env.MVP_SOURCE_PROVIDER,
  MVP_TURN_ROUTER_PROVIDER: env.MVP_TURN_ROUTER_PROVIDER,
};
const guide = [
  "What factors matter most?",
  "Which access barrier matters most in your setting?",
  "What else would you like to add?",
];
const firstReaction = "The PFS evidence changes how I weigh benefit.";
const secondReaction = "The DDI information would require a medication review.";

function planResult(input: ModeratorPlanInput): ModeratorPlanResult {
  const reaction = [firstReaction, secondReaction].includes(input.participantMessage);
  return {
    newPriorities: input.participantMessage === "PFS and DDI" ? [
      { label: "PFS", participantEvidence: "PFS", sourceQuestion: `What PFS evidence is available for ${input.brand}?` },
      { label: "DDI", participantEvidence: "DDI", sourceQuestion: `What drug interactions are documented for ${input.brand}?` },
    ] : [],
    reactionStatus: reaction ? "answered" : "not_answered",
    reactionEvidence: reaction ? [input.participantMessage] : [],
    action: input.asksSourceQuestion ? "answer_source" : reaction ? "present_priority" : "probe_reaction",
    selectedPriorityId: null,
    rationale: "Capture each stated priority and its evidence reaction before returning to the authored guide.",
  };
}

beforeEach(() => {
  env.OPENAI_API_KEY = undefined;
  env.CUSTOMGPT_API_KEY = undefined;
  env.MVP_SOURCE_PROVIDER = "controlled_rag";
  env.MVP_TURN_ROUTER_PROVIDER = "deterministic";
  mocks.plan.mockReset();
  mocks.plan.mockImplementation(async (input: ModeratorPlanInput) => ({ result: planResult(input) }));
  mocks.phrase.mockReset();
  mocks.phrase.mockImplementation(async (input: ModeratorPhrasingInput) => ({ result: {
    text: input.action === "reaction"
      ? `How does this ${input.priorityLabel} information affect your assessment?`
      : `You also mentioned ${input.priorityLabel}. Let's consider that next.`,
  } }));
  mocks.source.mockReset();
  mocks.source.mockImplementation(async (input: SourceAnswerProviderInput) => {
    const topic = /PFS/i.test(input.participantMessage) ? "PFS" : "DDI";
    const citationId = `${input.surveySlug}-${topic}`;
    return {
      enabled: true, provider: "controlled_rag", answer: `${input.surveySlug.toUpperCase()} ${topic} source summary.`,
      references: [{ citationId, title: `${topic} source`, url: `https://example.test/${input.surveySlug}/${topic}`, description: null, assets: [] }],
      citationIds: [citationId], conversationId: null, reason: null,
    };
  });
  mocks.persist.mockReset();
  mocks.persist.mockResolvedValue(undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Controller integration must use mocked providers."); }));
});

afterEach(() => {
  Object.assign(env, originalEnv);
  resetMvpCustomGptSurveySessions();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function auditFor(participantMessage: string) {
  return mocks.persist.mock.calls.find(([input]) => input.turn.participantMessage === participantMessage)?.[0];
}

describe("moderator controller integration", () => {
  it.each(["nubeqa", "brukinsa", "padcev"] as const)(
    "captures %s priorities and exact synthetic reactions, preserves detours, and returns to the imported guide",
    async (surveySlug) => {
      const started = startMvpCustomGptSurvey({ surveySlug, targetDurationSeconds: 600, guide });
      expect(started.currentQuestion).toBe(guide[0]);
      const turn = (content: string) => submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content });
      const first = await turn("PFS and DDI");
      const firstAudit = auditFor("PFS and DDI");
      const priorities = firstAudit?.session.moderatorState.priorities;
      expect(priorities.map((priority: { label: string; status: string }) => [priority.label, priority.status])).toEqual([["PFS", "presented"], ["DDI", "pending"]]);
      const firstQuestionId = `moderator-reaction:${priorities[0].id}`;
      const secondQuestionId = `moderator-reaction:${priorities[1].id}`;
      expect(firstAudit.session.currentQuestionId).toBe(firstQuestionId);
      expect(firstAudit.session.answeredQuestionIds).toContain("imported_1");
      expect(firstAudit.session.answerEvidenceByQuestionId.imported_1).toContain("PFS and DDI");
      expect(firstAudit.session.answeredQuestionIds).not.toContain(firstQuestionId);
      expect(first.currentQuestion).toContain("PFS information");
      expect(first.currentQuestion).not.toBe(guide[1]);
      expect(first.messages.at(-1)?.references).toHaveLength(1);
      expect(first.messages.at(-1)?.content).toContain(`${surveySlug.toUpperCase()} PFS source summary.`);

      const sourceQuestion = "What drug interactions should I consider?";
      const detour = await turn(sourceQuestion);
      expect(detour.currentQuestion).toBe(first.currentQuestion);
      expect(detour.messages.at(-1)?.content).not.toContain(first.currentQuestion!);
      expect(auditFor(sourceQuestion).session.answeredQuestionIds).not.toContain(firstQuestionId);
      expect(auditFor(sourceQuestion).session.moderatorState.activePriorityId).toBe(priorities[0].id);

      const resumed = await turn("Thanks, continue.");
      expect(resumed.currentQuestion).toBe(first.currentQuestion);
      expect(resumed.messages.at(-1)?.content).toBe(first.currentQuestion);
      expect(auditFor("Thanks, continue.").session.answeredQuestionIds).not.toContain(firstQuestionId);

      const second = await turn(firstReaction);
      const secondAudit = auditFor(firstReaction);
      expect(secondAudit.session.currentQuestionId).toBe(secondQuestionId);
      expect(secondAudit.session.answeredQuestionIds).toContain(firstQuestionId);
      expect(secondAudit.session.answeredQuestionIds).not.toContain(secondQuestionId);
      expect(secondAudit.session.answerEvidenceByQuestionId[firstQuestionId]).toEqual([firstReaction]);
      expect(secondAudit.session.moderatorState.priorities[0]).toMatchObject({ status: "reacted", reactionEvidence: [firstReaction] });
      expect(second.currentQuestion).toContain("DDI information");
      expect(second.messages.at(-1)?.content).toContain("You also mentioned DDI.");
      expect(second.messages.at(-1)?.references).toHaveLength(1);

      const returned = await turn(secondReaction);
      const completedAudit = auditFor(secondReaction);
      expect(completedAudit.session.answeredQuestionIds).toContain(secondQuestionId);
      expect(completedAudit.session.answerEvidenceByQuestionId[secondQuestionId]).toEqual([secondReaction]);
      expect(completedAudit.session.moderatorState.priorities.every((priority: { status: string }) => priority.status === "reacted")).toBe(true);
      expect(returned.currentQuestion).toBe(guide[1]);
      expect(returned.messages.at(-1)?.content).not.toContain(guide[0]);
      expect(returned.messages.at(-1)?.content).not.toContain(first.currentQuestion!);
      expect(returned.messages.at(-1)?.content).not.toContain(second.currentQuestion!);

      const accessAnswer = "Staff capacity is the main barrier.";
      const closing = await turn(accessAnswer);
      expect(closing.currentQuestion).toBe(guide[2]);
      expect(auditFor(accessAnswer).session.answeredQuestionIds).toContain("imported_2");
      expect(auditFor(accessAnswer).session.answerEvidenceByQuestionId.imported_2).toContain(accessAnswer);
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
