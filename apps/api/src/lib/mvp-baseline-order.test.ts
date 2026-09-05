import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MvpTurnRouteAnalysisInput } from "@interview/schemas";
import { env } from "../env";
import {
  resetMvpCustomGptSurveySessions,
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
} from "./mvp-customgpt-survey-service";
import { NUBEQA_HCP_MVP_GUIDE } from "./mvp-nubeqa-guide";

const mocks = vi.hoisted(() => ({ analyze: vi.fn(), source: vi.fn() }));
vi.mock("./model-gateway", () => ({
  getOptionalOpenAIGateway: () => ({ analyzeMvpTurnRoute: mocks.analyze }),
}));
vi.mock("./source-answer-service", () => ({
  askSourceProviderForSurveyInterviewerTurn: mocks.source,
}));
vi.mock("./mvp-survey-persistence", () => ({
  loadMvpSurveySessionSnapshot: vi.fn(async () => null),
  persistMvpSurveySessionStarted: vi.fn(async () => undefined),
  persistMvpSurveyTurnAudit: vi.fn(async () => undefined),
}));

const originalEnv = {
  MVP_TURN_ROUTER_PROVIDER: env.MVP_TURN_ROUTER_PROVIDER,
  MVP_SOURCE_PROVIDER: env.MVP_SOURCE_PROVIDER,
};
const question = (id: string) => NUBEQA_HCP_MVP_GUIDE.find((item) => item.id === id)!.canonicalQuestion;

beforeEach(() => {
  env.MVP_TURN_ROUTER_PROVIDER = "openai_hybrid";
  env.MVP_SOURCE_PROVIDER = "controlled_rag";
  mocks.analyze.mockReset();
  mocks.source.mockReset();
  mocks.source.mockResolvedValue({
    provider: "controlled_rag",
    enabled: true,
    answer: "The approved source addresses the requested interaction information.",
    references: [],
    citationIds: [],
    conversationId: null,
    reason: null,
  });
  mocks.analyze.mockImplementation(async (input: MvpTurnRouteAnalysisInput) => {
    const asksSourceQuestion = input.participantMessage.includes("?");
    return {
      result: {
        schemaVersion: 3,
        answerStatus: asksSourceQuestion ? "not_answered" : "answered",
        answerEvidence: asksSourceQuestion ? [] : [input.participantMessage],
        asksSourceQuestion,
        kind: asksSourceQuestion ? "source_question" : "planned_answer",
        topic: asksSourceQuestion ? "nubeqa_safety_dosing" : null,
        needsSource: asksSourceQuestion,
        isOutOfScope: false,
        isUnanticipated: false,
        // A valid model suggestion must still respect mandatory baseline order.
        suggestedQuestionIds: ["indication_positioning"],
        sourceDirective: asksSourceQuestion ? "Answer the requested drug-interaction question." : null,
        rationale: "The next suggested discussion is NUBEQA positioning.",
      },
    };
  });
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Baseline ordering tests must not make network requests.");
  }));
});

afterEach(() => {
  Object.assign(env, originalEnv);
  resetMvpCustomGptSurveySessions();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function startAtFamiliarity() {
  const started = startMvpCustomGptSurvey({ surveySlug: "nubeqa", targetDurationSeconds: 600 });
  const next = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "Yes" });
  expect(next.currentQuestion).toBe(question("familiarity"));
  return started.sessionId;
}

describe("mandatory baseline order with the hybrid model enabled", () => {
  it("asks decision factors before a model-suggested positioning question", async () => {
    const sessionId = await startAtFamiliarity();
    const next = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Somewhat familiar" });

    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({
      currentQuestionId: "familiarity",
      participantMessage: "Somewhat familiar",
      candidateQuestions: expect.arrayContaining([expect.objectContaining({ id: "indication_positioning" })]),
    }));
    expect(next.currentQuestion).toBe(question("decision_framework"));
    expect(next.messages.at(-1)?.content).toBe(question("decision_framework"));
    expect(mocks.source).not.toHaveBeenCalled();
  });

  it("answers a source question at familiarity and preserves the unanswered baseline question", async () => {
    const sessionId = await startAtFamiliarity();
    const answer = await submitMvpCustomGptSurveyTurn({
      sessionId,
      content: "What drug interactions should I consider?",
    });

    expect(mocks.analyze).toHaveBeenCalledWith(expect.objectContaining({ currentQuestionId: "familiarity" }));
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ responseMode: "answer_only" }));
    expect(answer.currentQuestion).toBe(question("familiarity"));
    expect(answer.messages.at(-1)?.content).not.toContain(question("familiarity"));
    expect(answer.messages.at(-1)?.content).not.toContain(question("decision_framework"));

    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Thanks, continue" });
    expect(resumed.currentQuestion).toBe(question("familiarity"));
    expect(resumed.messages.at(-1)?.content).toBe(question("familiarity"));

    const factors = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Somewhat familiar" });
    expect(factors.currentQuestion).toBe(question("decision_framework"));
  });
});
