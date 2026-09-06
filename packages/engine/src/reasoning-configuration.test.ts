import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { OpenAIResponsesGateway } from "./openai-workflows";

const plan = { version: 1, interpretedQuestion: "What does the selected study report?", usesSourceContext: false, retrievalQueries: ["study result"], answerApproach: "direct", contextBoundary: "Preserve the study population.", rationale: "A direct study question." };
const input = { surveySlug: "nubeqa", participantMessage: "What does the study report?", sourceTopicContext: null, recentTurns: [] };

describe("explicit reasoning configuration", () => {
  it.each([undefined, "medium"] as const)("separates interpretation from source planning: %s", async (interpretationReasoningEffort) => {
    const routeInput = { surveySlug: "nubeqa", sourceBrand: "NUBEQA", activeIntentSlug: null, activeIntentLabel: null, activeIntentSteeringRule: null,
      currentQuestionId: "familiarity", currentQuestion: "How familiar are you?", currentQuestionObjective: "Product familiarity", currentQuestionKeywords: [], currentQuestionCompletionSignals: [], sourceConversationActive: false,
      participantMessage: "Not very familiar.", recentInterviewerContext: null, candidateQuestions: [{ id: "factors", question: "What matters most?", objective: "Priorities", module: "Baseline", allowedByIntent: true, alreadyAsked: false, routeKeywords: [], sourceContextRequirement: null }] };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: { schemaVersion: 6, sourceRequest: null, answerStatus: "answered", asksSourceQuestion: false, answerEvidenceRanges: [{ startToken: 0, endToken: 2 }], kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false, suggestedQuestionIds: [], sourceDirective: null, rationale: "Explicit familiarity.", understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidenceRanges: [{ startToken: 0, endToken: 2 }] } } })
      .mockResolvedValueOnce({ output_parsed: { schemaVersion: 4, sourceRequest: null, priorityMentions: [], reactionStatus: "not_answered", reactionEvidenceRanges: [], action: "resume_guide", selectedPriorityId: null, rationale: "Explicit resume." } })
      .mockResolvedValueOnce({ output_parsed: plan });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "gpt-5.4-mini", decisionModel: "gpt-5.4-mini", phrasingModel: "gpt-5.4-mini", reasoningEffort: "low", interpretationReasoningEffort }, undefined, { parse });
    await gateway.analyzeMvpTurnRoute(routeInput);
    await gateway.planModeratorTurn({ brand: "NUBEQA", currentQuestion: "Your reaction?", participantMessage: "continue", recentTurns: [], state: { version: 1, priorities: [], activePriorityId: null }, isPriorityQuestion: false, asksSourceQuestion: false, answerStatus: "not_answered", isResumeCue: true });
    await gateway.planSourceQuestion(input);
    expect(parse.mock.calls.map(([request]) => request.reasoning.effort)).toEqual([interpretationReasoningEffort ?? "low", interpretationReasoningEffort ?? "low", "low"]);
    for (const [request] of parse.mock.calls) expect(request.metadata.reasoning_effort).toBe(request.reasoning.effort);
  });
  it.each(["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-2026-03-05", "gpt-5.5"])("enables and audits reasoning for source planning on %s", async (model) => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: plan });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: model, decisionModel: model, phrasingModel: model }, undefined, { parse });
    const result = await gateway.planSourceQuestion(input);
    expect(parse.mock.calls[0][0].reasoning).toEqual({ effort: "medium" });
    expect(result.trace.request.metadata).toMatchObject({ reasoning_effort: "medium", survey_slug: "nubeqa" });
  });
  it("honors an explicit setting without applying parameters to unrecognized models", async () => {
    for (const model of ["gpt-5.4", "gpt-4o", "custom-model"]) {
      const parse = vi.fn().mockResolvedValue({ output_parsed: plan });
      const gateway = new OpenAIResponsesGateway("test", { analysisModel: model, decisionModel: model, phrasingModel: model, reasoningEffort: "low" }, undefined, { parse });
      await gateway.planSourceQuestion(input);
      expect(parse.mock.calls[0][0].reasoning).toEqual(model === "gpt-5.4" ? { effort: "low" } : undefined);
    }
  });
  it.each([{ groundingReasoningEffort: undefined, compositionReasoningEffort: undefined }, { groundingReasoningEffort: "medium", compositionReasoningEffort: undefined }, { groundingReasoningEffort: "medium", compositionReasoningEffort: "medium" }] as const)("keeps composition and grounding overrides separate from the base effort: %j", async ({ groundingReasoningEffort, compositionReasoningEffort }) => {
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: { answerBody: "The source describes a study result. [1]", usedSourceIndexes: [1], limitations: [] } })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: true, unsupportedClaims: [] } });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "gpt-5.4-mini", decisionModel: "gpt-5.4-mini", phrasingModel: "gpt-5.4-mini", sourceModel: "gpt-5.4", reasoningEffort: "low", groundingReasoningEffort, compositionReasoningEffort }, undefined, { parse });
    await gateway.composeControlledRagAnswer({ surveySlug: "nubeqa", participantMessage: "Explain the study.", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, sources: [{ index: 1, title: "Study", url: null, description: null, text: "The source describes a study result." }] });
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls.map(([request]) => request.reasoning)).toEqual([{ effort: compositionReasoningEffort ?? "low" }, { effort: groundingReasoningEffort ?? "low" }]);
    for (const [request] of parse.mock.calls) {
      expect(request.text.format.strict).toBe(true);
    }
  });
  it("keeps question phrasing on its existing fast path", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: { text: "What is your first impression of DDI?" } });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "gpt-5.4-mini", decisionModel: "gpt-5.4-mini", phrasingModel: "gpt-5.4-mini" }, undefined, { parse });
    await gateway.phraseModeratorTurn({ brand: "NUBEQA", action: "reaction", priorityLabel: "DDI", participantMessage: "DDI", previousPriorityLabel: null });
    expect(parse.mock.calls[0][0]).not.toHaveProperty("reasoning");
  });
});
