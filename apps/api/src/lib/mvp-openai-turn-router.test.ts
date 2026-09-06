import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import { classifyMvpTurnRouteHybrid, sanitizeMvpRouteFailure } from "./mvp-openai-turn-router";

const gateway = vi.hoisted(() => ({ analyzeMvpTurnRoute: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => gateway }));

const originalProvider = env.MVP_TURN_ROUTER_PROVIDER;
beforeEach(() => { env.MVP_TURN_ROUTER_PROVIDER = "openai_hybrid"; gateway.analyzeMvpTurnRoute.mockReset(); });
afterEach(() => { env.MVP_TURN_ROUTER_PROVIDER = originalProvider; });

const input = {
  surveySlug: "nubeqa" as const,
  sourceBrand: "NUBEQA",
  currentQuestionId: "decision_framework",
  currentQuestion: "Which factors matter most when evaluating treatment?",
  currentQuestionObjective: "Capture priorities before presenting drug information.",
  currentQuestionKeywords: ["efficacy", "safety"],
  currentQuestionCompletionSignals: ["decision factors are stated"],
  participantContent: "PFS and DDI",
  candidateQuestions: [{ id: "patient_fit", question: "Which patient factors would affect your view?", objective: "Assess patient fit", module: "Fit", allowedByIntent: true, alreadyAsked: false, routeKeywords: [], sourceContextRequirement: null }],
};

const result = {
  schemaVersion: 3,
  answerStatus: "answered",
  asksSourceQuestion: false,
  answerEvidence: ["PFS and DDI"],
  kind: "planned_answer",
  topic: "nubeqa_safety_dosing",
  needsSource: false,
  isOutOfScope: false,
  isUnanticipated: false,
  suggestedQuestionIds: ["patient_fit"],
  sourceDirective: null,
  rationale: "The respondent stated decision priorities.",
};

describe("typed hybrid participant turn interpretation", () => {
  it.each(["wrong_survey_topic", "invalid_schema"])("repairs one local %s failure without changing the original participant/question context", async (category) => {
    const participantContent = "Not very familiar with it.";
    const invalid = { ...result, answerEvidence: [participantContent], ...(category === "wrong_survey_topic" ? { topic: "padcev_safety_management" } : { answerStatus: "UNKNOWN" }) };
    const valid = { ...result, topic: null, answerStatus: "not_answered", answerEvidence: [], understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidence: [participantContent] } };
    gateway.analyzeMvpTurnRoute.mockResolvedValueOnce({ result: invalid }).mockResolvedValueOnce({ result: valid });
    const routed = await classifyMvpTurnRouteHybrid({ ...input, currentQuestionId: "role", currentQuestion: "What is your clinical role?", participantContent });
    expect(routed).toMatchObject({ provider: "openai_hybrid", answerStatus: "not_answered", answerEvidence: [], understandingUpdate: valid.understandingUpdate, modelAttempts: 2, modelFailures: [{ code: category }] });
    const [first, second] = gateway.analyzeMvpTurnRoute.mock.calls.map(([request]) => request);
    expect(second).toEqual({ ...first, repairContext: { version: 1, validationCategory: category } });
  });

  it.each([null, 429, 401, 403])("does not retry provider/access failures or fabricate answer credit (status=%s)", async (status) => {
    gateway.analyzeMvpTurnRoute.mockRejectedValue({ name: "APIError", status, message: "PRIVATE PROVIDER DETAILS" });
    const route = await classifyMvpTurnRouteHybrid({ ...input, currentQuestionId: "role", currentQuestion: "What is your clinical role?", participantContent: "Not very familiar with it." });
    expect(route).toMatchObject({ answerStatus: "not_answered", answerEvidence: [], modelAttempts: 1 });
    expect(gateway.analyzeMvpTurnRoute).toHaveBeenCalledOnce();
    expect(JSON.stringify(route.modelFailures)).not.toContain("PRIVATE");
  });

  it("retains legitimate explicit deterministic behavior when the hybrid provider is disabled", async () => {
    env.MVP_TURN_ROUTER_PROVIDER = "deterministic";
    const route = await classifyMvpTurnRouteHybrid({ ...input, currentQuestionId: "role", currentQuestion: "What is your clinical role?", participantContent: "I am a medical oncologist." });
    expect(route).toMatchObject({ answerStatus: "answered", skipReason: "provider_disabled", error: null });
    expect(gateway.analyzeMvpTurnRoute).not.toHaveBeenCalled();
  });

  it("distinguishes a deliberate skip from a failed model interpretation", async () => {
    env.MVP_TURN_ROUTER_PROVIDER = "deterministic";
    expect(await classifyMvpTurnRouteHybrid(input)).toMatchObject({ provider: "deterministic", skipReason: "provider_disabled", error: null });
    env.MVP_TURN_ROUTER_PROVIDER = "openai_hybrid";
    expect(await classifyMvpTurnRouteHybrid({ ...input, candidateQuestions: [] })).toMatchObject({ skipReason: "no_candidates" });
    expect(await classifyMvpTurnRouteHybrid({ ...input, currentQuestionId: "intro_consent" })).toMatchObject({ skipReason: "consent" });
    expect(gateway.analyzeMvpTurnRoute).not.toHaveBeenCalled();
    gateway.analyzeMvpTurnRoute.mockRejectedValue({ name: "ZodError", message: "PRIVATE MODEL OUTPUT", issues: [{ code: "invalid_type", path: ["understandingUpdate", "productFamiliarity", "PRIVATE FIELD"], received: "PRIVATE VALUE" }] });
    const failed = await classifyMvpTurnRouteHybrid(input);
    expect(failed.skipReason).toBeUndefined();
    expect(failed.failureDiagnosis).toMatchObject({ code: "invalid_schema", errorName: "ZodError", issues: [{ code: "invalid_type", path: ["understandingUpdate", "productFamiliarity", "[unknown]"] }] });
    expect(JSON.stringify(failed.failureDiagnosis)).not.toContain("PRIVATE");
    expect(sanitizeMvpRouteFailure(failed.failureDiagnosis)).toEqual(failed.failureDiagnosis);
  });
  it("retains a fixed validation category for exact understanding excerpt failures", async () => {
    gateway.analyzeMvpTurnRoute.mockRejectedValue(new Error("Understanding updates require exact current participant excerpts."));
    const failed = await classifyMvpTurnRouteHybrid(input);
    expect(failed.failureDiagnosis?.code).toBe("invalid_understanding_excerpt");
    expect(sanitizeMvpRouteFailure(failed.failureDiagnosis)).toEqual(failed.failureDiagnosis);
  });
  it.each(["Even more simply please.", "Simpler please", "More simply"])("keeps an elliptical source clarification open when the model misses it: %s", async (participantContent) => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, schemaVersion: 5, sourceRequest: null, asksSourceQuestion: false, answerStatus: "not_answered", answerEvidence: [] } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, participantContent, sourceConversationActive: true });
    expect(route).toMatchObject({ provider: "deterministic", asksSourceQuestion: true, answerStatus: "not_answered", answerEvidence: [] });
    expect(route.error).toContain("only information requests");
  });
  it("does not manufacture answer credit from a rejected v5 source flag without provenance", async () => {
    const participantContent = "The efficacy results would be one part of my assessment; I would also weigh interaction concerns.";
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, schemaVersion: 5, sourceRequest: null, asksSourceQuestion: true, needsSource: true, answerEvidence: [participantContent] } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, participantContent });
    expect(route).toMatchObject({ provider: "deterministic", asksSourceQuestion: false, answerStatus: "not_answered", answerEvidence: [] });
    expect(route.error).toContain("source request");
  });

  it("retains v5 exact request provenance for a mixed in-situ question without punctuation", async () => {
    const reaction = "It's something I need to track but not terribly concerning.";
    const question = "So someone on those medications is at risk for what adverse reactions";
    const sourceRequest = { kind: "question", participantEvidence: question, resolvedQuestion: "What adverse reactions are described for the medications just discussed?" };
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, schemaVersion: 5, sourceRequest, answerEvidence: [reaction], asksSourceQuestion: true, needsSource: true, kind: "source_question", sourceDirective: "Answer the actual source followup." } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, participantContent: `${reaction} ${question}`, sourceConversationActive: true });
    expect(route).toMatchObject({ provider: "openai_hybrid", sourceRequest, answerStatus: "answered", answerEvidence: [reaction], asksSourceQuestion: true });
  });
  it.each([true, false])("exposes understanding updates only when their evidence is exact (valid=%s)", async (valid) => {
    const participantContent = "Not very familiar; keep it brief.";
    const understandingUpdate = { version: 1, productFamiliarity: "low", preferredDepth: "brief", participantEvidence: [valid ? "Not very familiar" : "I use it daily"] };
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, schemaVersion: 4, answerEvidence: ["Not very familiar"], understandingUpdate } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, currentQuestionId: "familiarity", currentQuestion: "How familiar are you?", participantContent });
    if (valid) expect(route.understandingUpdate).toEqual(understandingUpdate);
    else { expect(route.understandingUpdate).toBeUndefined(); expect(route.error).toContain("Understanding evidence"); }
  });
  it.each([false, true])("preserves both parts of a mixed trailing question even when the model misroutes it (source=%s)", async (asksSourceQuestion) => {
    const reaction = "It's something that I need to track but not terribly concerning.";
    const participantContent = `${reaction}  So someone on those medications are at risk for what adverse reactions`;
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: {
      ...result, asksSourceQuestion, needsSource: asksSourceQuestion,
      kind: asksSourceQuestion ? "source_question" : "planned_answer",
      sourceDirective: asksSourceQuestion ? "Answer the follow-up about those medications." : null,
      answerEvidence: [participantContent],
    } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, participantContent, sourceConversationActive: true });
    expect(route).toMatchObject({ provider: "deterministic", answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [] });
    expect(route.error).toContain("trailing information question");
  });
  it.each(["not_answered", "partial"])("retains explicit mixed-turn priorities when the model says %s", async (answerStatus) => {
    const statement = "PFS and DDI matter most to me.";
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: {
      ...result, answerStatus, answerEvidence: answerStatus === "partial" ? [statement] : [],
      asksSourceQuestion: true, needsSource: true, kind: "source_question",
      sourceDirective: "Answer the interaction question.",
    } });
    const route = await classifyMvpTurnRouteHybrid({ ...input,
      participantContent: `${statement} What drug interactions should I consider?`,
    });
    expect(route).toMatchObject({ provider: "deterministic", answerStatus: "not_answered",
      asksSourceQuestion: true, answerEvidence: [] });
    expect(route.error).toContain("explicit statement of priorities");
  });
  it("runs the mocked model in tests and passes authored question context", async () => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result });
    const route = await classifyMvpTurnRouteHybrid(input);
    expect(route.provider).toBe("openai_hybrid");
    expect(route.answerStatus).toBe("answered");
    expect(route.asksSourceQuestion).toBe(false);
    expect(route.decision.needsSource).toBe(false);
    expect(gateway.analyzeMvpTurnRoute).toHaveBeenCalledWith(expect.objectContaining({ currentQuestionObjective: input.currentQuestionObjective, currentQuestionCompletionSignals: input.currentQuestionCompletionSignals }));
  });

  it("supplies durable participant understanding to the typed router", async () => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result });
    const understanding = { version: 1 as const, productFamiliarity: "low" as const, preferredDepth: "detailed" as const, depthPreferenceExplicit: true, participantEvidence: ["I am new to this but want detail"] };
    await classifyMvpTurnRouteHybrid({ ...input, understanding });
    expect(gateway.analyzeMvpTurnRoute).toHaveBeenCalledWith(expect.objectContaining({ understanding }));
  });

  it("lets valid model interpretation override the deterministic source inference", async () => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, answerEvidence: ["I prioritize confidence."] } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, participantContent: "How clinicians use data varies; I prioritize confidence." });
    expect(route.provider).toBe("openai_hybrid");
    expect(route.decision.needsSource).toBe(false);
    expect(route.decision.sourceDirective).toBeNull();
    expect(route.asksSourceQuestion).toBe(false);
  });

  it("keeps answer credit independent from an accompanying source request", async () => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, asksSourceQuestion: true, needsSource: true, kind: "source_question", sourceDirective: "Answer the dosing question from approved sources." } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, participantContent: "PFS and DDI; what is the dosing guidance?" });
    expect(route).toMatchObject({ answerStatus: "answered", asksSourceQuestion: true, answerEvidence: ["PFS and DDI"] });
  });

  it.each([
    { ...result, answerEvidence: ["Overall survival"] },
    { ...result, answerEvidence: [] },
    { ...result, needsSource: true },
    { ...result, asksSourceQuestion: true },
    { ...result, topic: "padcev_safety_management" },
    { ...result, schemaVersion: 2 },
    { ...result, unexpected: true },
  ])("preserves unanswered research after two invalid model interpretations", async (invalid) => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: invalid });
    const route = await classifyMvpTurnRouteHybrid(input);
    expect(route).toMatchObject({ provider: "deterministic", answerStatus: "not_answered", asksSourceQuestion: false, answerEvidence: [], modelAttempts: 2 });
    expect(route.decision.needsSource).toBe(false);
    expect(route.error).not.toBeNull();
  });

  it("retains an unanswered research question when the model is unavailable", async () => {
    gateway.analyzeMvpTurnRoute.mockRejectedValue(new Error("Provider unavailable"));
    const route = await classifyMvpTurnRouteHybrid({ ...input, participantContent: "What drug interactions should I consider?" });
    expect(route).toMatchObject({ provider: "deterministic", answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [] });
    expect(route.decision.needsSource).toBe(true);
  });

  it.each([
    ["Can you explain that more simply?", "Can you explain that more simply?", "answered"],
    ["What drug interactions should I consider?", "drug interactions", "answered"],
    ["Please. Can you explain that more simply? Thanks.", "Can you explain that more simply?", "partial"],
  ])("rejects model answer credit based only on a follow-up request: %s", async (participantContent, excerpt, answerStatus) => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, answerStatus, answerEvidence: [excerpt] } });
    const route = await classifyMvpTurnRouteHybrid({
      ...input,
      participantContent,
      sourceConversationActive: true,
      recentInterviewerContext: "Interviewer: The approved drug-interaction source describes medication review.",
    });

    expect(gateway.analyzeMvpTurnRoute).toHaveBeenCalledWith(expect.objectContaining({
      currentQuestionId: "decision_framework",
      sourceConversationActive: true,
    }));
    expect(route).toMatchObject({ provider: "deterministic", answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [] });
    expect(route.decision.needsSource).toBe(true);
    expect(route.error).toContain("only information requests");
  });

  it("still credits an actual answer mixed with a source follow-up while research is parked", async () => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: {
      ...result,
      answerEvidence: ["PFS and DDI are my priorities."],
      asksSourceQuestion: true,
      needsSource: true,
      kind: "source_question",
      sourceDirective: "Explain the preceding source answer more simply.",
    } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, sourceConversationActive: true, participantContent: "PFS and DDI are my priorities. Can you explain that more simply?" });
    expect(route).toMatchObject({ provider: "openai_hybrid", answerStatus: "answered", asksSourceQuestion: true, answerEvidence: ["PFS and DDI are my priorities."] });
  });

  it("rejects model navigation when the active source discussion has an explicit follow-up question", async () => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: { ...result, answerStatus: "not_answered", answerEvidence: [], asksSourceQuestion: false } });
    const route = await classifyMvpTurnRouteHybrid({ ...input, sourceConversationActive: true, participantContent: "Can you explain that more simply?" });
    expect(route).toMatchObject({ provider: "deterministic", answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [] });
    expect(route.decision.needsSource).toBe(true);
    expect(route.error).toContain("only information requests");
  });
});
