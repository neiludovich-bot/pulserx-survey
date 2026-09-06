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
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("keeps the actual %s source request across reload despite a broader search plan", async (brand) => {
    const sessionId = startAtFamiliarity(brand);
    const request = `What PFS evidence is available for ${brand}?`;
    const expanded = `Compare PFS and MFS results for ${brand}.`;
    const answer = { ...success(brand), sourceQuestionPlan: { version: 1, interpretedQuestion: expanded, retrievalQueries: [expanded], answerApproach: "direct", usesSourceContext: false, contextBoundary: null, rationale: "Adversarial search broadens the original request." } };
    mocks.source.mockResolvedValueOnce(answer);
    const first = await submitMvpCustomGptSurveyTurn({ sessionId, content: request });
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion.query).toBe(request);
    rehydrate(first);
    mocks.source.mockResolvedValueOnce(answer);
    await submitMvpCustomGptSurveyTurn({ sessionId, content: "Can you explain that more simply?" });
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ sourceTopicContext: request, evidencePacket: answer.evidencePacket });
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion.query).toBe(request);
  });

  it.each(["rate_limited", "provider_timeout", "authentication_failed"])("describes temporary source unavailability without implying unsupported evidence (%s)", async (code) => {
    const sessionId = startAtFamiliarity("nubeqa");
    mocks.source.mockResolvedValueOnce({ ...success("nubeqa"), enabled: false, answer: null, reason: "PRIVATE PROVIDER MESSAGE", sourceOutcome: { version: 1, status: "composition_failure", attempts: [{ stage: "grounding", code, responseId: null, model: null }] } });
    const response = await submitMvpCustomGptSurveyTurn({ sessionId, content: "What drug interactions are described?" });
    expect(response.messages.at(-1)?.content).toContain("can't access the source information right now");
    expect(response.messages.at(-1)?.content).toContain('say "retry"');
    expect(response.messages.at(-1)?.content).not.toMatch(/supported answer|PRIVATE|429|API/);
    expect(response.messages.at(-1)?.references).toEqual([]);
    expect(mocks.persist.mock.calls.at(-1)![0].session).toMatchObject({ pendingReturnQuestionId: "familiarity", moderatorState: { sourceDiscussion: { status: "failed", pendingQuestion: "What drug interactions are described?" } } });
  });

  it.each([true, false])("clarifies a failed practical question without losing it or reusing older evidence across reloads (replacement packet=%s)", async (hasReplacementPacket) => {
    const sessionId = startAtFamiliarity("nubeqa");
    mocks.source.mockResolvedValue(success("nubeqa"));
    const original = await submitMvpCustomGptSurveyTurn({ sessionId, content: "What drug interactions are described?" });
    const oldPacket = mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion.evidencePacket;
    rehydrate(original);
    const pending = "What does that mean for what to monitor in practical terms?";
    const failure = { ...success("nubeqa"), enabled: false, answer: null, reason: "Grounding rejected", sourceOutcome: { version: 1, status: "grounding_rejected", attempts: [] } };
    mocks.source.mockResolvedValueOnce(failure);
    const failed = await submitMvpCustomGptSurveyTurn({ sessionId, content: pending });
    rehydrate(failed);
    mocks.source.mockResolvedValueOnce(failure);
    const stillFailed = await submitMvpCustomGptSurveyTurn({ sessionId, content: "Can you explain that more simply?" });
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ participantMessage: "Can you explain that more simply?", evidencePacket: undefined, sourceTopicContext: expect.stringContaining(pending) });
    expect(mocks.source.mock.calls.at(-1)![0].sourceTopicContext).toContain("What drug interactions are described?");
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion).toMatchObject({ status: "failed", pendingQuestion: pending, evidencePacket: oldPacket });
    rehydrate(stillFailed);
    const newPacket = { sources: [{ ...oldPacket.sources[0], id: "practical-evidence", text: "Exact evidence supporting the practical question." }] };
    mocks.source.mockResolvedValueOnce({ ...success("nubeqa"), evidencePacket: hasReplacementPacket ? newPacket : null });
    await submitMvpCustomGptSurveyTurn({ sessionId, content: "Even more simply please." });
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ participantMessage: "Even more simply please.", evidencePacket: undefined, sourceTopicContext: expect.stringContaining(pending) });
    const completed = mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion;
    expect(completed).toMatchObject({ status: "open", query: pending });
    expect(completed.evidencePacket).toEqual(hasReplacementPacket ? newPacket : undefined);
    expect(completed.pendingQuestion).toBeUndefined();
  });

  it.each([{ brand: "nubeqa" as const, questionId: "familiarity", answered: true }, { brand: "brukinsa" as const, questionId: "role", answered: false }].flatMap((scenario) => [false, true].map((phrasingFails) => ({ ...scenario, phrasingFails }))))("recovers a source request outside an agenda while retaining $questionId coverage (answered=$answered, phrasing failure=$phrasingFails)", async ({ brand, questionId, answered, phrasingFails }) => {
    const started = startMvpCustomGptSurvey({ surveySlug: brand, targetDurationSeconds: 600 });
    const snapshot = mocks.started.mock.calls.at(-1)![0].session;
    mocks.load.mockResolvedValue({ session: { ...snapshot, currentQuestionId: questionId, askedQuestionIds: ["intro_consent", questionId], answeredQuestionIds: ["intro_consent"], answerEvidenceByQuestionId: {}, queuedQuestionIds: [] }, messages: started.messages, turnCount: 1 });
    resetMvpCustomGptSurveySessions();
    const question = "What study results are described?";
    const participantContent = answered ? `Somewhat familiar. ${question}` : question;
    const sourceRequest = { kind: "question", participantEvidence: question, resolvedQuestion: question };
    mocks.route.mockResolvedValueOnce({ ...questionRoute, sourceRequest: null, asksSourceQuestion: false, answerStatus: answered ? "answered" : "not_answered", answerEvidence: answered ? ["Somewhat familiar."] : [], decision: { ...questionRoute.decision, kind: "planned_answer", needsSource: false, sourceDirective: null } });
    mocks.gatewayEnabled = true;
    mocks.plan.mockResolvedValue({ result: { sourceRequest, newPriorities: [], reactionStatus: "not_answered", reactionEvidence: [], action: "answer_source", selectedPriorityId: null, rationale: "Recover the actual question missed upstream." } });
    mocks.source.mockResolvedValue(success(brand));
    const response = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: participantContent });
    expect(mocks.source).toHaveBeenCalledOnce();
    expect(response.messages.at(-1)?.content).toContain('say "continue"');
    const saved = mocks.persist.mock.calls.at(-1)![0];
    expect(saved.session.moderatorState.priorities).toEqual([]);
    expect(saved.turn.moderatorDecision.plan.sourceRequest).toEqual(sourceRequest);
    expect(saved.session.answeredQuestionIds.includes(questionId)).toBe(answered);
    const returnId = saved.session.pendingReturnQuestionId;
    if (answered) expect(returnId).not.toBe(questionId);
    else expect(returnId).toBe(questionId);
    expect(saved.session.moderatorState.sourceDiscussion.returnTarget).toEqual({ kind: "guide", id: returnId });
    expect(mocks.phrase).not.toHaveBeenCalled();
    const selected = snapshot.guide.find((item: { id: string }) => item.id === returnId);
    const resumedWording = answered ? "What factors matter most in your treatment decisions?" : "What is your clinical role?";
    const sourceReply = response.messages.at(-1)?.content;
    if (phrasingFails) mocks.phrase.mockRejectedValueOnce(new Error("Invalid guide-resume wording"));
    else mocks.phrase.mockResolvedValueOnce({ result: { text: resumedWording }, trace: { responseId: "guide-source-resume-fixture" } });
    rehydrate(response);
    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "Thanks, continue." });
    expect(mocks.persist.mock.calls.at(-1)![0].session.currentQuestionId).toBe(returnId);
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion).toBeUndefined();
    expect(mocks.phrase).toHaveBeenCalledOnce();
    expect(mocks.phrase.mock.calls[0][0]).toMatchObject({ action: "guide_resume", selectedQuestion: { id: returnId, question: selected.canonicalQuestion, objective: selected.objective }, discussedPriorities: [], recentTurns: expect.arrayContaining([expect.objectContaining({ role: "interviewer", content: sourceReply })]) });
    const phrasingAudit = mocks.persist.mock.calls.at(-1)![0].turn.moderatorDecision.guideResumePhrasing;
    expect(phrasingAudit.status).toBe(phrasingFails ? "fallback" : "success");
    expect(resumed.currentQuestion).toBe(selected.canonicalQuestion);
    if (phrasingFails) expect(resumed.messages.at(-1)?.content).toBe(selected.canonicalQuestion);
    else {
      expect(resumed.messages.at(-1)?.content).toBe(resumedWording);
      expect(phrasingAudit.trace).toEqual({ responseId: "guide-source-resume-fixture" });
    }
  });

  it.each((["nubeqa", "brukinsa", "padcev"] as const).flatMap((brand) => [false, true].map((phrasingFails) => ({ brand, phrasingFails }))))("reconciles volunteered familiarity and resumes the unanswered $brand default-guide step (phrasing failure=$phrasingFails)", async ({ brand, phrasingFails }) => {
    const started = startMvpCustomGptSurvey({ surveySlug: brand, targetDurationSeconds: 600 });
    const researchAnswer = (evidence: string, source = false) => ({ ...questionRoute, answerStatus: "answered", answerEvidence: [evidence], asksSourceQuestion: source, decision: { ...questionRoute.decision, kind: source ? "source_question" : "planned_answer", needsSource: source, sourceDirective: source ? "Answer the source question." : null } });
    mocks.route.mockResolvedValueOnce(researchAnswer("Yes, we can begin."));
    const intake = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "Yes, we can begin." });
    const low = "Not very familiar with it.";
    // Deliberately include a mistaken current-role answer credit: the separate
    // validated familiarity fact must not satisfy unrelated structured intake.
    mocks.route.mockResolvedValueOnce({ ...researchAnswer(low), understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidence: [low] } });
    const orientation = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: low });
    expect(orientation.currentQuestion).toContain("What would you most like clarified");
    const baseline = mocks.persist.mock.calls.at(-1)![0].session;
    expect(baseline.answeredQuestionIds).toContain("familiarity");
    expect(baseline.answerEvidenceByQuestionId.familiarity).toEqual([low]);
    if (brand !== "nubeqa") {
      expect(baseline.answeredQuestionIds).not.toContain("role");
      expect(baseline.pendingReturnQuestionId).toBe("role");
    }
    rehydrate(orientation);
    mocks.gatewayEnabled = true;
    const priorities = "PFS and DDI are the two things I would want to understand.";
    mocks.route.mockResolvedValueOnce(researchAnswer(priorities));
    mocks.plan.mockResolvedValueOnce({ result: { newPriorities: [{ label: "PFS", participantEvidence: "PFS", sourceQuestion: "What progression-free survival results are reported?" }, { label: "DDI", participantEvidence: "DDI", sourceQuestion: "What drug interactions are described?" }], reactionStatus: "not_answered", reactionEvidence: [], action: "present_priority", selectedPriorityId: null, rationale: "Explain the two priorities." } });
    const resumedWording = brand === "nubeqa" ? "What factors matter most in your treatment decisions?" : "What is your clinical role?";
    mocks.phrase.mockImplementation(async ({ action, priorityLabel }: { action: string; priorityLabel: string }) => {
      if (action === "guide_resume" && phrasingFails) throw new Error("Invalid resumed-question phrasing");
      return { result: { text: action === "guide_resume" ? resumedWording : `What would you want clarified about ${priorityLabel}?` }, trace: { responseId: "phrasing-fixture" } };
    });
    mocks.source.mockResolvedValue(success(brand));
    const presented = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: priorities });
    rehydrate(presented);
    const priorityState = mocks.persist.mock.calls.at(-1)![0].session.moderatorState;
    const reaction = "The efficacy results would be one part of my assessment.";
    mocks.route.mockResolvedValueOnce(researchAnswer(reaction));
    mocks.plan.mockResolvedValueOnce({ result: { newPriorities: [], reactionStatus: "answered", reactionEvidence: [reaction], action: "present_priority", selectedPriorityId: priorityState.priorities[1].id, rationale: "Move to DDI." } });
    await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: reaction });
    const openingQuestion = "What drug-drug interactions are noted?";
    const openingRequest = { kind: "question", participantEvidence: openingQuestion, resolvedQuestion: openingQuestion };
    mocks.route.mockResolvedValueOnce({ ...questionRoute, sourceRequest: openingRequest });
    mocks.plan.mockResolvedValueOnce({ result: { sourceRequest: openingRequest, newPriorities: [], reactionStatus: "not_answered", reactionEvidence: [], action: "answer_source", selectedPriorityId: priorityState.priorities[1].id, rationale: "Answer the question and park the DDI reaction." } });
    const opened = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: openingQuestion });
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.sourceDiscussion.returnTarget).toEqual({ kind: "priority", id: priorityState.priorities[1].id });
    rehydrate(opened);
    const mixedReaction = "It's something I need to track but not terribly concerning.";
    const mixedQuestion = "So someone on those medications is at risk for what adverse reactions";
    const mixedSourceRequest = { kind: "question", participantEvidence: mixedQuestion, resolvedQuestion: "What adverse reactions are described?" };
    mocks.route.mockResolvedValueOnce({ ...researchAnswer(mixedReaction, true), sourceRequest: mixedSourceRequest, answerStatus: "not_answered", answerEvidence: [] });
    mocks.plan.mockResolvedValueOnce({ result: { sourceRequest: mixedSourceRequest, newPriorities: [], reactionStatus: "answered", reactionEvidence: [mixedReaction], action: "answer_source", selectedPriorityId: priorityState.priorities[1].id, rationale: "Credit the reaction and answer the followup independently of the missed upstream reaction." } });
    const detour = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: `${mixedReaction} ${mixedQuestion}` });
    expect(mocks.persist.mock.calls.at(-1)![0].session.moderatorState.priorities[1]).toMatchObject({ status: "reacted", reactionEvidence: [mixedReaction] });
    rehydrate(detour);
    mocks.route.mockResolvedValueOnce(questionRoute);
    mocks.plan.mockResolvedValueOnce({ result: { newPriorities: [], reactionStatus: "not_answered", reactionEvidence: [], action: "answer_source", selectedPriorityId: null, rationale: "Clarify the source discussion." } });
    const clarified = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "Can you explain that more simply?" });
    rehydrate(clarified);
    mocks.route.mockResolvedValueOnce({ ...questionRoute, asksSourceQuestion: false, decision: { ...questionRoute.decision, kind: "planned_answer", needsSource: false, sourceDirective: null } });
    mocks.plan.mockResolvedValueOnce({ result: { newPriorities: [], reactionStatus: "not_answered", reactionEvidence: [], action: "resume_guide", selectedPriorityId: null, rationale: "Resume after both reactions and the detour." } });
    const resumed = await submitMvpCustomGptSurveyTurn({ sessionId: started.sessionId, content: "Thanks, continue." });
    expect(resumed.currentQuestion).not.toMatch(/How familiar/);
    expect(resumed.currentQuestion).toBe(brand === "nubeqa" ? baseline.guide.find((question: { id: string }) => question.id === "decision_framework").canonicalQuestion : intake.currentQuestion);
    const final = mocks.persist.mock.calls.at(-1)![0].session;
    const selected = baseline.guide.find((question: { id: string }) => question.id === (brand === "nubeqa" ? "decision_framework" : "role"));
    expect(mocks.phrase.mock.calls.at(-1)![0]).toMatchObject({ action: "guide_resume", selectedQuestion: { id: selected.id, question: selected.canonicalQuestion, objective: selected.objective }, discussedPriorities: [{ label: "PFS", reactionEvidence: [reaction] }, { label: "DDI", reactionEvidence: [mixedReaction] }] });
    expect(final.currentQuestionId).toBe(selected.id);
    const phrasingAudit = mocks.persist.mock.calls.at(-1)![0].turn.moderatorDecision.guideResumePhrasing;
    expect(phrasingAudit.status).toBe(phrasingFails ? "fallback" : "success");
    if (phrasingFails) expect(resumed.messages.at(-1)?.content).toContain(selected.canonicalQuestion);
    else {
      expect(resumed.messages.at(-1)?.content).toBe(resumedWording);
      expect(resumed.messages.at(-1)?.content).not.toContain("Before we get into");
      expect(phrasingAudit.trace).toEqual({ responseId: "phrasing-fixture" });
    }
    expect(final.answerEvidenceByQuestionId.familiarity).toEqual([low]);
    expect(final.moderatorState.priorities.map((p: { status: string }) => p.status)).toEqual(["reacted", "reacted"]);
    expect(final.pendingReturnQuestionId).toBeNull();
    if (brand !== "nubeqa") expect(final.answeredQuestionIds).not.toContain("role");
  });
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
    expect(mocks.phrase.mock.calls.at(-1)![0]).toMatchObject({ understanding: { productFamiliarity: "low" }, probeIntent: "first_impression", presentationPlan: { depth: "brief" } });
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
