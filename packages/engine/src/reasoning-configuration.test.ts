import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { OpenAIResponsesGateway } from "./openai-workflows";

const plan = { version: 1, interpretedQuestion: "What does the selected study report?", usesSourceContext: false, retrievalQueries: ["study result"], answerApproach: "direct", contextBoundary: "Preserve the study population.", rationale: "A direct study question." };
const input = { surveySlug: "nubeqa", participantMessage: "What does the study report?", sourceTopicContext: null, recentTurns: [] };

describe("explicit reasoning configuration", () => {
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
  it("uses reasoning for both composition and review while preserving strict formats", async () => {
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: { answerBody: "The source describes a study result. [1]", usedSourceIndexes: [1], limitations: [] } })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: true, unsupportedClaims: [] } });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "gpt-5.4-mini", decisionModel: "gpt-5.4-mini", phrasingModel: "gpt-5.4-mini", sourceModel: "gpt-5.4" }, undefined, { parse });
    await gateway.composeControlledRagAnswer({ surveySlug: "nubeqa", participantMessage: "Explain the study.", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, sources: [{ index: 1, title: "Study", url: null, description: null, text: "The source describes a study result." }] });
    expect(parse).toHaveBeenCalledTimes(2);
    for (const [request] of parse.mock.calls) {
      expect(request.reasoning).toEqual({ effort: "medium" });
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
