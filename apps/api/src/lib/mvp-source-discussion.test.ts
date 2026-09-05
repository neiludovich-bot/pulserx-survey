import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import { resetMvpCustomGptSurveySessions, startMvpCustomGptSurvey, submitMvpCustomGptSurveyTurn } from "./mvp-customgpt-survey-service";
import type { MvpPersistenceSessionSnapshot } from "./mvp-survey-persistence";
const mocks = vi.hoisted(() => ({ source: vi.fn(), route: vi.fn(), load: vi.fn(), started: vi.fn(), persist: vi.fn(), plan: vi.fn(), phrase: vi.fn(), gatewayEnabled: false }));
vi.mock("./source-answer-service", () => ({ askSourceProviderForSurveyInterviewerTurn: mocks.source }));
vi.mock("./mvp-openai-turn-router", () => ({ classifyMvpTurnRouteHybrid: mocks.route }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => mocks.gatewayEnabled ? { planModeratorTurn: mocks.plan, phraseModeratorTurn: mocks.phrase } : null }));
vi.mock("./mvp-survey-persistence", () => ({ loadMvpSurveySessionSnapshot: mocks.load, persistMvpSurveySessionStarted: mocks.started, persistMvpSurveyTurnAudit: mocks.persist }));
const provider = env.MVP_SOURCE_PROVIDER;
const questionRoute = { answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [], decision: { kind: "source_question", topic: null, needsSource: true, isOutOfScope: false, isUnanticipated: false, sourceDirective: "Answer the participant's source question.", rationale: "Information request" }, provider: "deterministic", suggestedQuestionIds: [], modelResult: null, error: null };
beforeEach(() => { vi.resetAllMocks(); mocks.gatewayEnabled = false; env.MVP_SOURCE_PROVIDER = "controlled_rag"; mocks.route.mockResolvedValue(questionRoute); mocks.started.mockResolvedValue(undefined); mocks.persist.mockResolvedValue(undefined); });
afterEach(() => { env.MVP_SOURCE_PROVIDER = provider; resetMvpCustomGptSurveySessions(); });
type Brand = "nubeqa" | "brukinsa" | "padcev";
function success(brand: Brand) {
  return { provider: "controlled_rag", enabled: true, answer: "The selected evidence addresses your question. [1]", references: [{ citationId: "rag:fixture", title: `${brand} evidence`, url: "https://example.test/source", description: null, assets: [] }], citationIds: ["rag:fixture"], conversationId: null, reason: null,
    sourceOutcome: { version: 1, status: "success", attempts: [] },
    evidencePacket: { sources: [{ id: "fixture", surveySlug: brand, title: `${brand} evidence`, url: "https://example.test/source", description: "", text: "Exact prior evidence.", tags: [], assets: [] }] } };
}
function startAtFamiliarity(brand: Brand) {
  const response = startMvpCustomGptSurvey({ surveySlug: brand, targetDurationSeconds: 600 });
  const snapshot = mocks.started.mock.calls.at(-1)![0].session as MvpPersistenceSessionSnapshot;
  mocks.load.mockResolvedValue({ session: { ...snapshot, currentQuestionId: "familiarity", askedQuestionIds: ["intro_consent", "familiarity"], answeredQuestionIds: ["intro_consent"], answerEvidenceByQuestionId: {}, queuedQuestionIds: [] }, messages: response.messages, turnCount: 1 });
  resetMvpCustomGptSurveySessions();
  return response.sessionId;
}
function rehydrate(response: Awaited<ReturnType<typeof submitMvpCustomGptSurveyTurn>>) {
  mocks.load.mockResolvedValue({ session: structuredClone(mocks.persist.mock.calls.at(-1)![0].session), messages: response.messages, turnCount: response.messages.filter((m) => m.role === "participant").length });
  resetMvpCustomGptSurveySessions();
}

describe("shared persisted source detours", () => {
  it.each([null, "detailed"] as const)("uses validated familiarity in imported guides and preserves explicit depth=%s", async (preferredDepth) => {
    const started = startMvpCustomGptSurvey({ surveySlug: "nubeqa", targetDurationSeconds: 600, guide: ["How familiar are you with NUBEQA?", "What factors matter most?", "What else would you like to add?"] });
    const content = preferredDepth ? "Not very familiar, but give me detail" : "Not very familiar";
    mocks.route.mockResolvedValueOnce({ ...questionRoute, asksSourceQuestion: false, answerStatus: "answered", answerEvidence: [content], understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth, participantEvidence: [content] }, decision: { ...questionRoute.decision, kind: "planned_answer", needsSource: false, sourceDirective: null } });
    const needs = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content });
    expect(needs.messages.at(-1)?.content).toContain("What would you most like clarified");
    const understanding = mocks.persist.mock.calls.at(-1)![0].session.moderatorState.understanding;
    expect(understanding).toMatchObject({ productFamiliarity: "low", preferredDepth: preferredDepth ?? "brief", depthPreferenceExplicit: Boolean(preferredDepth) });
    rehydrate(needs);
    mocks.source.mockResolvedValue(success("nubeqa"));
    await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "What is it used for?" });
    expect(mocks.route.mock.calls.at(-1)![0].understanding).toEqual(understanding);
    expect(mocks.source.mock.calls.at(-1)![0].presentationPlan.depth).toBe(preferredDepth ?? "brief");
  });
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("retains %s source context across failure, reload, retry and resume", async (brand) => {
    const sessionId = startAtFamiliarity(brand);
    mocks.source.mockResolvedValue(success(brand));
    const first = await submitMvpCustomGptSurveyTurn({ sessionId, content: "What drug interactions are described?" });
    expect(first.messages.at(-1)?.content).toContain('say "continue"');
    const originalEvidence = mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion.evidencePacket;
    rehydrate(first);
    mocks.source.mockResolvedValueOnce({ ...success(brand), enabled: false, answer: null, reason: "Grounding rejected", sourceOutcome: { version: 1, status: "grounding_rejected", attempts: [{ stage: "grounding", code: "unsupported_claim", model: "fixture", responseId: "review-1" }] } });
    const failed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "What does that mean for monitoring?" });
    const failure = mocks.persist.mock.calls.at(-1)![0];
    expect(failed.messages.at(-1)?.content).toContain("kept our place");
    expect(failed.messages.at(-1)?.content).not.toMatch(/How familiar|keeping the interview moving|What else would you like/);
    expect(failure.turn.actualAskedQuestionId).toBeNull();
    expect(failure.session.currentQuestionId).toBe("familiarity");
    expect(failure.session.answeredQuestionIds).not.toContain("familiarity");
    expect(failure.session.moderatorState.sourceDiscussion).toMatchObject({ status: "failed", query: "What drug interactions are described?", pendingQuestion: "What does that mean for monitoring?", returnTarget: { kind: "guide", id: "familiarity" }, evidencePacket: originalEvidence, failure: { stage: "grounding" } });
    expect(failure.turn.moderatorDecision.sourceOutcome.status).toBe("grounding_rejected");
    rehydrate(failed);
    const retried = await submitMvpCustomGptSurveyTurn({ sessionId, content: "retry" });
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ participantMessage: "What does that mean for monitoring?", sourceTopicContext: "What drug interactions are described?", evidencePacket: originalEvidence });
    expect(retried.messages.at(-1)?.content).not.toContain('say "continue"');
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion.status).toBe("open");
    rehydrate(retried);
    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Thanks, continue." });
    expect(resumed.messages.at(-1)?.content).toMatch(/How familiar/);
    const resumedSession = mocks.persist.mock.calls.at(-1)![0].session;
    expect(resumedSession.moderatorState.sourceDiscussion).toBeUndefined();
    expect(resumedSession.pendingReturnQuestionId).toBeNull();
    expect(resumedSession.answeredQuestionIds).not.toContain("familiarity");
  });

  it("parks the guide before the first provider failure and can continue without answering", async () => {
    const sessionId = startAtFamiliarity("nubeqa");
    mocks.source.mockRejectedValueOnce(new Error("Source service unavailable"));
    const failed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "What drug interactions are described?" });
    expect(failed.messages.at(-1)?.content).toContain('say "retry"');
    expect(failed.messages.at(-1)?.content).not.toMatch(/How familiar/);
    const snapshot = mocks.persist.mock.calls.at(-1)![0].session;
    expect(snapshot.pendingReturnQuestionId).toBe("familiarity");
    rehydrate(failed);
    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "continue" });
    expect(resumed.messages.at(-1)?.content).toMatch(/How familiar/);
    expect(mocks.source).toHaveBeenCalledTimes(1);
  });

  it("preserves the research answer in a mixed turn even when the source answer fails", async () => {
    const sessionId = startAtFamiliarity("nubeqa");
    mocks.route.mockResolvedValueOnce({ ...questionRoute, answerStatus: "answered", answerEvidence: ["Somewhat familiar"] });
    mocks.source.mockResolvedValueOnce({ ...success("nubeqa"), enabled: false, answer: null, reason: "Composition failed" });
    const failed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Somewhat familiar. What interactions are described?" });
    const snapshot = mocks.persist.mock.calls.at(-1)![0].session;
    expect(snapshot.answeredQuestionIds).toContain("familiarity");
    expect(snapshot.answerEvidenceByQuestionId.familiarity).toEqual(["Somewhat familiar"]);
    expect(snapshot.pendingReturnQuestionId).not.toBe("familiarity");
    expect(snapshot.moderatorState.sourceDiscussion.returnTarget.id).toBe(snapshot.pendingReturnQuestionId);
    expect(failed.messages.at(-1)?.content).not.toMatch(/How familiar/);
    rehydrate(failed);
    mocks.source.mockResolvedValue(success("nubeqa"));
    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "continue" });
    expect(resumed.messages.at(-1)?.content).not.toMatch(/How familiar/);
    expect(mocks.persist.mock.calls.at(-1)![0].session.answerEvidenceByQuestionId.familiarity).toEqual(["Somewhat familiar"]);
  });

  it("queues all information priorities from an unfamiliar participant and presents only the first", async () => {
    const sessionId = startAtFamiliarity("nubeqa");
    mocks.route.mockResolvedValueOnce({ ...questionRoute, asksSourceQuestion: false, answerStatus: "answered", answerEvidence: ["Not very familiar"], understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidence: ["Not very familiar"] }, decision: { ...questionRoute.decision, kind: "planned_answer", needsSource: false, sourceDirective: null } });
    await submitMvpCustomGptSurveyTurn({ sessionId, content: "Not very familiar" });
    mocks.gatewayEnabled = true;
    mocks.route.mockResolvedValueOnce({ ...questionRoute, asksSourceQuestion: false, answerStatus: "answered", answerEvidence: ["PFS and DDI"], decision: { ...questionRoute.decision, kind: "planned_answer", needsSource: false, sourceDirective: null } });
    mocks.plan.mockResolvedValue({ result: { newPriorities: [{ label: "PFS", participantEvidence: "PFS", sourceQuestion: "What progression-free survival results are reported?" }, { label: "DDI", participantEvidence: "DDI", sourceQuestion: "What drug interactions are described?" }], reactionStatus: "not_answered", reactionEvidence: [], action: "present_priority", selectedPriorityId: null, rationale: "Address both requested information priorities in order." } });
    mocks.phrase.mockResolvedValue({ result: { text: "What would you want clarified about PFS before forming a view?" } });
    mocks.source.mockResolvedValue(success("nubeqa"));
    await submitMvpCustomGptSurveyTurn({ sessionId, content: "PFS and DDI" });
    expect(mocks.plan.mock.calls.at(-1)![0]).toMatchObject({ isPriorityQuestion: true, asksSourceQuestion: false });
    const state = mocks.persist.mock.calls.at(-1)![0].session.moderatorState;
    expect(state.priorities.map((p: { label: string; status: string }) => [p.label, p.status])).toEqual([["PFS", "presented"], ["DDI", "pending"]]);
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(mocks.phrase.mock.calls.at(-1)![0]).toMatchObject({ understanding: { productFamiliarity: "low" }, probeIntent: "information_need", presentationPlan: { depth: "brief" } });
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)("uses low familiarity to ask %s information needs and keeps the brief presentation preference", async (brand) => {
    const sessionId = startAtFamiliarity(brand);
    mocks.route.mockResolvedValueOnce({ ...questionRoute, asksSourceQuestion: false, answerStatus: "answered", answerEvidence: ["Not very familiar"], understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidence: ["Not very familiar"] }, decision: { ...questionRoute.decision, kind: "planned_answer", needsSource: false, sourceDirective: null } });
    const needs = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Not very familiar" });
    expect(needs.messages.at(-1)?.content).toContain(`What would you most like clarified about ${brand.toUpperCase()}`);
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.understanding).toMatchObject({ productFamiliarity: "low", preferredDepth: "brief" });
    mocks.source.mockResolvedValue(success(brand));
    const answer = await submitMvpCustomGptSurveyTurn({ sessionId, content: "What is it used for?" });
    expect(mocks.source.mock.calls.at(-1)![0].presentationPlan).toMatchObject({ purpose: "orientation", depth: "brief", maxFacts: 3, maxTopics: 1 });
    expect(mocks.persist.mock.calls.at(-1)![0].session.answeredQuestionIds).toContain("familiarity_information_need");
    expect(answer.messages.at(-1)?.content).not.toContain("What would you most like clarified");
  });
});
