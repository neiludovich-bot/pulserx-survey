import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env";
import { classifyMvpTurnRouteHybrid } from "./mvp-openai-turn-router";

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
  it("runs the mocked model in tests and passes authored question context", async () => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result });
    const route = await classifyMvpTurnRouteHybrid(input);
    expect(route.provider).toBe("openai_hybrid");
    expect(route.answerStatus).toBe("answered");
    expect(route.asksSourceQuestion).toBe(false);
    expect(route.decision.needsSource).toBe(false);
    expect(gateway.analyzeMvpTurnRoute).toHaveBeenCalledWith(expect.objectContaining({ currentQuestionObjective: input.currentQuestionObjective, currentQuestionCompletionSignals: input.currentQuestionCompletionSignals }));
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
  ])("fails back to contextual local interpretation for invalid model output", async (invalid) => {
    gateway.analyzeMvpTurnRoute.mockResolvedValue({ result: invalid });
    const route = await classifyMvpTurnRouteHybrid(input);
    expect(route).toMatchObject({ provider: "deterministic", answerStatus: "answered", asksSourceQuestion: false, answerEvidence: ["PFS and DDI"] });
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
