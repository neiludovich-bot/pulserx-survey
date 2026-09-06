import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeratorPlanInput, ModeratorPlanResult, ModeratorPhrasingInput } from "@interview/schemas";
import { env } from "../env";
import type { SourceAnswerProviderInput } from "./source-answer-service";
import {
  resetMvpCustomGptSurveySessions,
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
} from "./mvp-customgpt-survey-service";

const mocks = vi.hoisted(() => ({ plan: vi.fn(), phrase: vi.fn(), source: vi.fn(), persist: vi.fn(), load: vi.fn(), analyze: vi.fn() }));
vi.mock("./model-gateway", () => ({
  getOptionalOpenAIGateway: () => ({ planModeratorTurn: mocks.plan, phraseModeratorTurn: mocks.phrase, analyzeMvpTurnRoute: mocks.analyze }),
}));
vi.mock("./source-answer-service", () => ({ askSourceProviderForSurveyInterviewerTurn: mocks.source }));
vi.mock("./mvp-survey-persistence", () => ({
  loadMvpSurveySessionSnapshot: mocks.load,
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
const secondReaction = "I would review concomitant medicines before choosing it, so that interaction profile would affect my decision.";
const mixedReaction = "It's something that I need to track but not terribly concerning.";
const mixedMessage = `${mixedReaction}  So someone on those medications are at risk for what adverse reactions`;

function planResult(input: ModeratorPlanInput): ModeratorPlanResult {
  const reaction = [firstReaction, secondReaction, mixedMessage].includes(input.participantMessage);
  const reactionTopic = input.participantMessage === firstReaction ? "PFS" : "DDI";
  return {
    ...(input.participantMessage === mixedMessage ? { sourceRequest: { kind: "question" as const, participantEvidence: "So someone on those medications are at risk for what adverse reactions", resolvedQuestion: "What adverse reactions are described for the medications just discussed?" } } : {}),
    newPriorities: input.participantMessage === "PFS and DDI" ? [
      { label: "PFS", participantEvidence: "PFS", sourceQuestion: `What PFS evidence is available for ${input.brand}?` },
      { label: "DDI", participantEvidence: "DDI", sourceQuestion: `What drug interactions are documented for ${input.brand}?` },
    ] : [],
    reactionStatus: reaction ? "answered" : "not_answered",
    reactionTargetPriorityId: reaction ? input.state.priorities.find((priority) => priority.label === reactionTopic)?.id ?? null : null,
    reactionEvidence: reaction ? [input.participantMessage === mixedMessage ? mixedReaction : input.participantMessage] : [],
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
  mocks.analyze.mockReset();
  mocks.plan.mockReset();
  mocks.plan.mockImplementation(async (input: ModeratorPlanInput) => ({ result: planResult(input) }));
  mocks.phrase.mockReset();
  mocks.phrase.mockImplementation(async (input: ModeratorPhrasingInput) => ({ result: {
    text: input.action === "guide_resume" ? input.selectedQuestion.question : input.action === "reaction"
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
  mocks.load.mockReset();
  mocks.load.mockResolvedValue(null);
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
  it.each(["topic", "schema"].flatMap((failure) => [false, true].map((recovers) => ({ failure, recovers }))))("keeps clinical role unanswered after low familiarity with a $failure routing failure (repair=$recovers)", async ({ failure, recovers }) => {
    const started = startMvpCustomGptSurvey({ surveySlug: "padcev", targetDurationSeconds: 600 });
    await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "Yes, we can begin." });
    env.MVP_TURN_ROUTER_PROVIDER = "openai_hybrid";
    const participantMessage = "Not very familiar with it.";
    const valid = { schemaVersion: 5, sourceRequest: null, answerStatus: "not_answered", answerEvidence: [], asksSourceQuestion: false,
      kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false,
      suggestedQuestionIds: [], sourceDirective: null, rationale: "Familiarity does not answer clinical role.",
      understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidence: [participantMessage] } };
    const invalid = { ...valid, answerStatus: failure === "schema" ? "INVALID" : "answered", answerEvidence: [participantMessage], topic: failure === "topic" ? "nubeqa_safety_dosing" : null };
    mocks.analyze.mockResolvedValueOnce({ result: invalid }).mockResolvedValueOnce({ result: recovers ? valid : invalid });
    const response = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: participantMessage });
    expect(mocks.analyze).toHaveBeenCalledTimes(2);
    const audit = auditFor(participantMessage);
    expect(audit.session.answeredQuestionIds).not.toContain("role");
    expect(audit.session.answerEvidenceByQuestionId.role ?? []).toEqual([]);
    expect(response.currentQuestion).toBe(recovers ? "What would you most like clarified about PADCEV before we go further?" : "What is your clinical role?");
    if (recovers) {
      expect(audit.session.moderatorState.understanding).toMatchObject({ productFamiliarity: "low", preferredDepth: "brief" });
      expect(audit.session.pendingReturnQuestionId).toBe("role");
    } else {
      expect(audit.session.moderatorState.understanding).toBeUndefined();
      expect(audit.turn.turnRouteAnalysis).toMatchObject({ answerStatus: "not_answered", answerEvidence: [], modelAttempts: 2 });
      expect(audit.turn.turnRouteAnalysis.modelFailures).toHaveLength(2);
    }
  });

  it.each((["nubeqa", "brukinsa", "padcev"] as const).flatMap((surveySlug) => [
    { surveySlug, router: "deterministic" as const }, { surveySlug, router: "openai_hybrid" as const },
  ]))("handles the exact mixed reaction and adverse-reaction question for $surveySlug ($router)", async ({ surveySlug, router }) => {
    const started = startMvpCustomGptSurvey({ surveySlug, targetDurationSeconds: 600, guide });
    const turn = (content: string) => submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content });
    await turn("PFS and DDI");
    const second = await turn(firstReaction);
    const secondAudit = auditFor(firstReaction);
    const ddiId = secondAudit.session.moderatorState.activePriorityId;
    const ddiQuestionId = `moderator-reaction:${ddiId}`;
    expect(second.currentQuestion).toContain("DDI information");
    env.MVP_TURN_ROUTER_PROVIDER = router;
    mocks.analyze.mockResolvedValue({ result: {
      schemaVersion: 3, answerStatus: "answered", answerEvidence: [mixedMessage], asksSourceQuestion: false,
      kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false,
      suggestedQuestionIds: [], sourceDirective: null, rationale: "Incorrectly overlooked the source question in a mixed reaction.",
    } });
    mocks.source.mockClear();
    const mixed = await turn(mixedMessage);
    const mixedAudit = auditFor(mixedMessage);
    if (router === "openai_hybrid") {
      expect(mixedAudit.turn.turnRouteAnalysis).toMatchObject({ answerStatus: "not_answered", modelAttempts: 2 });
      expect(mixedAudit.turn.turnRouteAnalysis.modelFailures).toHaveLength(2);
    }
    expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({ participantMessage: mixedMessage, asksSourceQuestion: true, answerStatus: router === "openai_hybrid" ? "not_answered" : "answered" }));
    expect(mocks.source).toHaveBeenLastCalledWith(expect.objectContaining({ participantMessage: mixedMessage, responseMode: "answer_only" }));
    expect(mixed.messages.at(-1)?.content).toContain("source summary");
    expect(mixed.messages.at(-1)?.content).not.toContain(second.currentQuestion!);
    expect(mixedAudit.session.answeredQuestionIds).toContain(ddiQuestionId);
    expect(mixedAudit.session.answerEvidenceByQuestionId[ddiQuestionId]).toEqual([mixedReaction]);
    expect(mixedAudit.session.moderatorState.priorities[1].reactionEvidence).toEqual([mixedReaction]);
    expect(mixedAudit.session.moderatorState.priorities.every((priority: { status: string }) => priority.status === "reacted")).toBe(true);
    expect(mixedAudit.session.moderatorState.sourceDiscussion).toBeDefined();

    mocks.analyze.mockResolvedValue({ result: {
      schemaVersion: 3, answerStatus: "not_answered", answerEvidence: [], asksSourceQuestion: false,
      kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false,
      suggestedQuestionIds: [], sourceDirective: null, rationale: "Incorrectly treated the follow-up as navigation.",
    } });
    const followupText = "Can you explain that more simply?";
    const followup = await turn(followupText);
    expect(mocks.source).toHaveBeenLastCalledWith(expect.objectContaining({ participantMessage: followupText, responseMode: "answer_only" }));
    expect(followup.messages.at(-1)?.content).not.toContain(second.currentQuestion!);
    expect(auditFor(followupText).session.answerEvidenceByQuestionId[ddiQuestionId]).toEqual([mixedReaction]);
    expect(auditFor(followupText).session.moderatorState.sourceDiscussion).toBeDefined();
    const resumed = await turn("continue");
    expect(resumed.currentQuestion).toBe(guide[1]);
    expect(resumed.messages.at(-1)?.content).not.toContain(second.currentQuestion!);
    expect(auditFor("continue").session.moderatorState.sourceDiscussion).toBeUndefined();
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)("keeps %s moderator clarification requests active when the hybrid model incorrectly denies a source request", async (surveySlug) => {
    const started = startMvpCustomGptSurvey({ surveySlug, targetDurationSeconds: 600, guide });
    const first = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "PFS and DDI" });
    const initialAudit = auditFor("PFS and DDI");
    expect(initialAudit.session.pendingReturnQuestionId).toBeNull();
    const activeId = initialAudit.session.moderatorState.activePriorityId;
    expect(initialAudit.session.moderatorState.priorities[0].status).toBe("presented");

    env.MVP_TURN_ROUTER_PROVIDER = "openai_hybrid";
    mocks.analyze.mockResolvedValue({ result: {
      schemaVersion: 3, answerStatus: "not_answered", answerEvidence: [], asksSourceQuestion: false,
      kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false,
      suggestedQuestionIds: [], sourceDirective: null, rationale: "Incorrectly treated clarification as navigation.",
    } });
    mocks.source.mockClear();
    const participantMessage = "Can you explain that more simply?";
    const clarified = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: participantMessage });

    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ participantMessage, sourceConversationActive: true }));
    expect(mocks.plan).toHaveBeenLastCalledWith(expect.objectContaining({ participantMessage, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ participantMessage, responseMode: "answer_only" }));
    expect(clarified.currentQuestion).toBe(first.currentQuestion);
    expect(auditFor(participantMessage).session.moderatorState.activePriorityId).toBe(activeId);
    expect(auditFor(participantMessage).session.answeredQuestionIds).not.toContain(`moderator-reaction:${activeId}`);
  });

  it.each((["nubeqa", "brukinsa", "padcev"] as const).flatMap((surveySlug) => [
    { surveySlug, restart: false }, { surveySlug, restart: true },
  ]))(
    "captures $surveySlug priorities and synthetic reactions, preserves detours, and returns to the imported guide (restart=$restart)",
    async ({ surveySlug, restart }) => {
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

      if (restart) {
        expect(firstAudit.session.guide.map((question: { canonicalQuestion: string }) => question.canonicalQuestion)).toEqual(guide);
        expect(firstAudit.session.fullGuide.map((question: { canonicalQuestion: string }) => question.canonicalQuestion)).toEqual(guide);
        mocks.load.mockResolvedValueOnce({
          session: structuredClone(firstAudit.session),
          messages: structuredClone(first.messages),
          turnCount: first.turnCount,
        });
        resetMvpCustomGptSurveySessions();
      }

      const sourceQuestion = "What drug interactions should I consider?";
      const detour = await turn(sourceQuestion);
      if (restart) expect(mocks.load).toHaveBeenCalledWith(started.sessionId);
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

      const genericFollowup = "Can you explain that more simply?";
      const sourceCallsBefore = mocks.source.mock.calls.length;
      const simplified = await turn(genericFollowup);
      expect(simplified.currentQuestion).toBe(second.currentQuestion);
      expect(simplified.messages.at(-1)?.content).not.toContain(second.currentQuestion!);
      expect(mocks.source.mock.calls[sourceCallsBefore]?.[0]).toMatchObject({
        participantMessage: genericFollowup,
        sourceTopicContext: priorities[1].sourceQuestion,
        responseMode: "answer_only",
      });
      const returnedToDdi = await turn("continue");
      expect(returnedToDdi.currentQuestion).toBe(second.currentQuestion);

      const returned = await turn(secondReaction);
      const completedAudit = auditFor(secondReaction);
      expect(completedAudit.session.answeredQuestionIds).toContain(secondQuestionId);
      expect(completedAudit.session.answerEvidenceByQuestionId[secondQuestionId]).toEqual([secondReaction]);
      expect(completedAudit.session.moderatorState.priorities).toHaveLength(2);
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
