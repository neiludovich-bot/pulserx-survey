import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import { BRUKINSA_HCP_MVP_GUIDE } from "./mvp-brukinsa-guide";
import { NUBEQA_HCP_MVP_GUIDE } from "./mvp-nubeqa-guide";
import { PADCEV_HCP_MVP_GUIDE } from "./mvp-padcev-guide";
import {
  resetMvpCustomGptSurveySessions,
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
} from "./mvp-customgpt-survey-service";
import type { MvpPersistenceSessionSnapshot } from "./mvp-survey-persistence";

const mocks = vi.hoisted(() => ({
  source: vi.fn(),
  route: vi.fn(),
  load: vi.fn(),
  started: vi.fn(),
  persisted: vi.fn(),
}));
vi.mock("./source-answer-service", () => ({ askSourceProviderForSurveyInterviewerTurn: mocks.source }));
vi.mock("./mvp-openai-turn-router", () => ({ classifyMvpTurnRouteHybrid: mocks.route }));
vi.mock("./mvp-survey-persistence", () => ({
  loadMvpSurveySessionSnapshot: mocks.load,
  persistMvpSurveySessionStarted: mocks.started,
  persistMvpSurveyTurnAudit: mocks.persisted,
}));

const originalProvider = env.MVP_SOURCE_PROVIDER;
const sourceResult = {
  provider: "controlled_rag",
  enabled: true,
  answer: "The approved safety material explains the relevant dosing and interaction considerations.",
  references: [],
  citationIds: [],
  conversationId: null,
  reason: null,
};

beforeEach(() => {
  env.MVP_SOURCE_PROVIDER = "controlled_rag";
  vi.clearAllMocks();
  mocks.source.mockResolvedValue(sourceResult);
  mocks.route.mockImplementation(() => { throw new Error("Navigation must not be classified as a research answer."); });
  mocks.started.mockResolvedValue(undefined);
  mocks.persisted.mockResolvedValue(undefined);
});
afterEach(() => {
  env.MVP_SOURCE_PROVIDER = originalProvider;
  resetMvpCustomGptSurveySessions();
  vi.restoreAllMocks();
});

function parkedSession(surveySlug: "nubeqa" | "brukinsa" | "padcev", pendingId: string) {
  const started = startMvpCustomGptSurvey({ surveySlug, targetDurationSeconds: 600 });
  const snapshot = mocks.started.mock.calls.at(-1)![0].session as MvpPersistenceSessionSnapshot;
  const session = {
    ...snapshot,
    currentQuestionId: "familiarity",
    pendingReturnQuestionId: pendingId,
    askedQuestionIds: ["intro_consent", "familiarity"],
    answeredQuestionIds: ["intro_consent", "familiarity"],
    answerEvidenceByQuestionId: { familiarity: ["I am familiar"] },
    queuedQuestionIds: [pendingId],
  };
  mocks.load.mockResolvedValue({
    session,
    messages: [
      ...started.messages,
      { ...started.messages[0], id: "source-request", role: "participant", content: "I am familiar. What about UTI?" },
      { ...started.messages[0], id: "source-answer", role: "interviewer", content: "Here is the requested source detail. Say continue to return to the survey." },
    ],
    turnCount: 2,
  });
  resetMvpCustomGptSurveySessions();
  return { sessionId: started.sessionId, session };
}

describe("source prerequisites when resuming the survey", () => {
  it.each([
    { surveySlug: "nubeqa" as const, guide: NUBEQA_HCP_MVP_GUIDE, id: "safety_dosing" },
    { surveySlug: "brukinsa" as const, guide: BRUKINSA_HCP_MVP_GUIDE, id: "general_safety_isi" },
    { surveySlug: "padcev" as const, guide: PADCEV_HCP_MVP_GUIDE, id: "safety" },
  ])("presents authored evidence before the parked $surveySlug safety question", async ({ surveySlug, guide, id }) => {
    const question = guide.find((item) => item.id === id)!;
    const { sessionId, session } = parkedSession(surveySlug, id);
    const response = await submitMvpCustomGptSurveyTurn({ sessionId, content: "continue" });

    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({
      participantMessage: "continue",
      selectedNextQuestion: question.canonicalQuestion,
      selectedQuestionSourceContext: question.sourceContextRequirement,
      responseMode: "answer_then_ask",
    }));
    expect(response.nextAction).toBe("answer_then_ask");
    expect(response.messages.at(-1)?.content).toContain(sourceResult.answer);
    expect(response.messages.at(-1)?.content).toContain(question.canonicalQuestion);
    const audited = mocks.persisted.mock.calls.at(-1)![0];
    expect(audited.session.pendingReturnQuestionId).toBeNull();
    expect(audited.session.currentQuestionId).toBe(id);
    expect(audited.session.answeredQuestionIds).toEqual(session.answeredQuestionIds);
    expect(audited.session.answerEvidenceByQuestionId).toEqual(session.answerEvidenceByQuestionId);
    expect(audited.turn.sourceContextRequirement).toBe(question.sourceContextRequirement);
    expect(audited.turn.turnRouteAnalysis).toMatchObject({ answerStatus: "not_answered", answerEvidence: [], asksSourceQuestion: false });
  });

  it("resumes an unanswered baseline without introducing source evidence", async () => {
    const { sessionId, session } = parkedSession("nubeqa", "decision_framework");
    const response = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Thanks, continue." });
    const question = NUBEQA_HCP_MVP_GUIDE.find((item) => item.id === "decision_framework")!;

    expect(response.messages.at(-1)?.content).toBe(question.canonicalQuestion);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.route).not.toHaveBeenCalled();
    expect(mocks.persisted.mock.calls.at(-1)![0].session.answeredQuestionIds).toEqual(session.answeredQuestionIds);
  });

  it("keeps the question parked when evidence retrieval fails and retries without answer credit", async () => {
    const { sessionId, session } = parkedSession("nubeqa", "safety_dosing");
    mocks.source.mockResolvedValueOnce({ ...sourceResult, enabled: false, answer: null, reason: "Source unavailable" });
    const failed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "continue" });
    const failedAudit = mocks.persisted.mock.calls.at(-1)![0];

    expect(failed.nextAction).toBe("setup_required");
    expect(failed.messages.at(-1)?.content).toContain('Say "continue" to try again');
    expect(failedAudit.session.pendingReturnQuestionId).toBe("safety_dosing");
    expect(failedAudit.session.currentQuestionId).toBe("familiarity");
    expect(failedAudit.session.answeredQuestionIds).toEqual(session.answeredQuestionIds);
    expect(failedAudit.turn.actualAskedQuestionId).toBeNull();

    const retried = await submitMvpCustomGptSurveyTurn({ sessionId, content: "continue" });
    expect(retried.nextAction).toBe("answer_then_ask");
    expect(mocks.source).toHaveBeenCalledTimes(2);
    expect(mocks.persisted.mock.calls.at(-1)![0].session.pendingReturnQuestionId).toBeNull();
    expect(mocks.route).not.toHaveBeenCalled();
  });
});
