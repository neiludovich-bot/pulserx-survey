import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import type { SourceAnswerProviderInput } from "./source-answer-service";
import {
  resetMvpCustomGptSurveySessions,
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
} from "./mvp-customgpt-survey-service";
import { NUBEQA_HCP_MVP_GUIDE } from "./mvp-nubeqa-guide";

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  persistTurn: vi.fn(),
}));

vi.mock("./source-answer-service", () => ({
  askSourceProviderForSurveyInterviewerTurn: mocks.source,
}));
vi.mock("./mvp-survey-persistence", () => ({
  loadMvpSurveySessionSnapshot: vi.fn(async () => null),
  persistMvpSurveySessionStarted: vi.fn(async () => undefined),
  persistMvpSurveyTurnAudit: mocks.persistTurn,
}));

const originalEnv = {
  CUSTOMGPT_API_KEY: env.CUSTOMGPT_API_KEY,
  CUSTOMGPT_PROJECT_ID: env.CUSTOMGPT_PROJECT_ID,
  CUSTOMGPT_NUBEQA_PROJECT_ID: env.CUSTOMGPT_NUBEQA_PROJECT_ID,
  OPENAI_API_KEY: env.OPENAI_API_KEY,
  MVP_SOURCE_PROVIDER: env.MVP_SOURCE_PROVIDER,
};
const frameworkQuestion = NUBEQA_HCP_MVP_GUIDE.find(
  (question) => question.id === "decision_framework",
)!.canonicalQuestion;

beforeEach(() => {
  env.CUSTOMGPT_API_KEY = undefined;
  env.CUSTOMGPT_PROJECT_ID = undefined;
  env.CUSTOMGPT_NUBEQA_PROJECT_ID = undefined;
  env.OPENAI_API_KEY = undefined;
  env.MVP_SOURCE_PROVIDER = "controlled_rag";
  mocks.source.mockReset();
  mocks.persistTurn.mockReset();
  mocks.persistTurn.mockResolvedValue(undefined);
  mocks.source.mockImplementation(async (input: SourceAnswerProviderInput) => ({
    provider: "controlled_rag",
    enabled: true,
    answer: input.responseMode === "answer_only"
      ? "The requested source link is available in the reference."
      : "The authored study context is available in the reference.",
    references: [],
    citationIds: [],
    conversationId: null,
    reason: null,
  }));
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Answer-intent regressions must not make network requests.");
  }));
});

afterEach(() => {
  Object.assign(env, originalEnv);
  resetMvpCustomGptSurveySessions();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startAtNubeqaFactors() {
  const started = startMvpCustomGptSurvey({
    surveySlug: "nubeqa",
    targetDurationSeconds: 600,
  });
  await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "Yes" });
  const factors = await submitMvpCustomGptSurveyTurn({
    sessionId: started.sessionId,
    content: "Somewhat familiar",
  });
  expect(factors.currentQuestion).toBe(frameworkQuestion);
  mocks.source.mockClear();
  mocks.persistTurn.mockClear();
  return started.sessionId;
}

describe("participant answer intent through the MVP survey service", () => {
  it.each([
    "PFS and DDI",
    "OS, tolerability, and cost",
    "Drug interactions",
    "Safety and dosing",
  ])("credits the short NUBEQA decision-factor answer: %s", async (content) => {
    const sessionId = await startAtNubeqaFactors();
    const next = await submitMvpCustomGptSurveyTurn({ sessionId, content });

    expect(next.status).toBe("active");
    expect(next.currentQuestion).not.toBeNull();
    expect(next.currentQuestion).not.toBe(frameworkQuestion);
    expect(next.messages.at(-1)?.content).not.toContain(frameworkQuestion);
    // Evidence required by the next authored question is allowed. A bare
    // factor answer must not be turned into an unsolicited DDI explanation.
    for (const [input] of mocks.source.mock.calls as [SourceAnswerProviderInput][]) {
      expect(input.responseMode).not.toBe("answer_only");
      expect(input.selectedQuestionSourceContext).not.toContain("The participant asked a NUBEQA safety");
      expect(input.selectedNextQuestion).not.toBe(frameworkQuestion);
    }
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)(
    "accepts short factors for an imported brand-neutral guide on %s",
    async (surveySlug) => {
      const guide = [
        "What are the most important factors in your treatment decisions?",
        "Which practical barrier matters most in your setting?",
        "What else would you like to add?",
      ];
      const started = startMvpCustomGptSurvey({ surveySlug, targetDurationSeconds: 600, guide });
      expect(started.currentQuestion).toBe(guide[0]);
      const next = await submitMvpCustomGptSurveyTurn({
        sessionId: started.sessionId,
        content: "PFS and drug interactions",
      });

      expect(next.status).toBe("active");
      expect(next.currentQuestion).toBe(guide[1]);
      expect(next.messages.at(-1)?.content).toBe(guide[1]);
      expect(mocks.source).not.toHaveBeenCalled();
    },
  );

  it.each([
    "Show me the source link for drug interactions.",
    "What drug interactions should I consider?",
  ])("preserves an unanswered research question through a pure source detour: %s", async (content) => {
    const sessionId = await startAtNubeqaFactors();
    const answer = await submitMvpCustomGptSurveyTurn({
      sessionId,
      content,
    });
    expect(answer.status).toBe("active");
    expect(mocks.source).toHaveBeenCalled();

    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Thanks, continue." });
    expect(resumed.status).toBe("active");
    expect(resumed.currentQuestion).toBe(frameworkQuestion);

    const answered = await submitMvpCustomGptSurveyTurn({ sessionId, content: "PFS and DDI" });
    expect(answered.currentQuestion).not.toBe(frameworkQuestion);
  });

  it.each([
    "PFS and DDI matter most to me. Show me the source link for drug interactions.",
    "PFS and DDI matter most to me. What drug interactions should I consider?",
  ])("credits a mixed factor answer before answering its source request: %s", async (content) => {
    const sessionId = await startAtNubeqaFactors();
    const answer = await submitMvpCustomGptSurveyTurn({ sessionId, content });
    expect(answer.status).toBe("active");
    expect(mocks.source).toHaveBeenCalled();
    expect(answer.messages.at(-1)?.content).not.toContain(frameworkQuestion);

    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Thanks, continue." });
    expect(resumed.status).toBe("active");
    expect(resumed.currentQuestion).not.toBeNull();
    expect(resumed.currentQuestion).not.toBe(frameworkQuestion);
    expect(resumed.messages.at(-1)?.content).not.toContain(frameworkQuestion);
    expect(mocks.persistTurn).toHaveBeenCalledWith(expect.objectContaining({
      turn: expect.objectContaining({ participantMessage: content }),
    }));
  });

  it("retains a partial answer and its parked question while answering a source request", async () => {
    const sessionId = await startAtNubeqaFactors();
    const content = "Not sure. What is DDI?";
    const answer = await submitMvpCustomGptSurveyTurn({ sessionId, content });
    expect(answer.status).toBe("active");
    expect(mocks.source).toHaveBeenCalled();
    expect(answer.messages.at(-1)?.content).not.toContain(frameworkQuestion);

    const audited = mocks.persistTurn.mock.calls.find(([input]) =>
      input.turn.participantMessage === content,
    )?.[0];
    expect(audited?.turn.turnRouteAnalysis.answerStatus).toBe("partial");
    expect(audited?.session.answeredQuestionIds).not.toContain("decision_framework");
    expect(audited?.session.answerEvidenceByQuestionId.decision_framework).toContain("Not sure.");

    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Thanks, continue." });
    expect(resumed.status).toBe("active");
    expect(resumed.currentQuestion).toBe(frameworkQuestion);
  });

  it("credits a substantive answer after thanks instead of only resuming the parked question", async () => {
    const sessionId = await startAtNubeqaFactors();
    await submitMvpCustomGptSurveyTurn({
      sessionId,
      content: "What drug interactions should I consider?",
    });
    const content = "Thanks, cost matters most.";
    const answered = await submitMvpCustomGptSurveyTurn({ sessionId, content });

    expect(answered.status).toBe("active");
    expect(answered.currentQuestion).not.toBeNull();
    expect(answered.currentQuestion).not.toBe(frameworkQuestion);
    expect(answered.messages.at(-1)?.content).not.toContain(frameworkQuestion);
    const audited = mocks.persistTurn.mock.calls.find(([input]) =>
      input.turn.participantMessage === content,
    )?.[0];
    expect(audited?.turn.turnRouteAnalysis.answerStatus).toBe("answered");
    expect(audited?.session.answeredQuestionIds).toContain("decision_framework");
    expect(audited?.session.answerEvidenceByQuestionId.decision_framework).toContain(content);
  });

  it("keeps a request for a simpler explanation inside the source detour", async () => {
    const sessionId = await startAtNubeqaFactors();
    const initialAnswer = await submitMvpCustomGptSurveyTurn({
      sessionId,
      content: "What drug interactions should I consider?",
    });
    mocks.source.mockClear();
    const content = "Can you explain that more simply?";
    const followup = await submitMvpCustomGptSurveyTurn({ sessionId, content });

    expect(followup.status).toBe("active");
    expect(followup.currentQuestion).toBe(frameworkQuestion);
    expect(followup.messages.at(-1)?.content).not.toContain(frameworkQuestion);
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({
      participantMessage: content,
      responseMode: "answer_only",
    }));
    const sourceContext = (mocks.source.mock.calls[0][0] as SourceAnswerProviderInput)
      .recentInterviewerContext;
    expect(sourceContext).toBe(
      `participant: What drug interactions should I consider?\ninterviewer: ${initialAnswer.messages.at(-1)!.content}`,
    );
    expect(sourceContext).not.toContain("Is it okay to begin?");
    expect(sourceContext).not.toContain(frameworkQuestion);
    const audited = mocks.persistTurn.mock.calls.find(([input]) =>
      input.turn.participantMessage === content,
    )?.[0];
    expect(audited?.session.answeredQuestionIds).not.toContain("decision_framework");

    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Thanks." });
    expect(resumed.status).toBe("active");
    expect(resumed.currentQuestion).toBe(frameworkQuestion);
    expect(resumed.messages.at(-1)?.content).toBe(frameworkQuestion);
  });
});
