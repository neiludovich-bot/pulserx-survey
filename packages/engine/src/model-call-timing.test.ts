import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { openAIDebugTraceSchema, controlledRagCompositionInputSchema } from "../../schemas/src/index";
import { OpenAIResponsesGateway } from "./openai-workflows";

const plan = { version: 1, interpretedQuestion: "PRIVATE interpreted question", usesSourceContext: false, retrievalQueries: ["PRIVATE query"], answerApproach: "direct", contextBoundary: null, rationale: "PRIVATE rationale" };
const input = { surveySlug: "nubeqa" as const, participantMessage: "PRIVATE participant content", sourceTopicContext: null, recentTurns: [] };
const config = { analysisModel: "gpt-5.4-mini", decisionModel: "gpt-5.4-mini", phrasingModel: "gpt-5.4-mini", sourceModel: "gpt-5.4", reasoningEffort: "low" as const };

describe("safe model-call timing", () => {
  afterEach(() => vi.restoreAllMocks());
  it("records elapsed model time and usage without content, preserving requests and old traces", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    let clock = 100;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const parse = vi.fn().mockImplementation(async () => { clock = 137; return { id: "PRIVATE response id", output_text: "PRIVATE response text", output_parsed: plan,
      usage: { input_tokens: 1000, output_tokens: 80, total_tokens: 1080, input_tokens_details: { cached_tokens: 700 }, output_tokens_details: { reasoning_tokens: 45 } }, privateBody: "PRIVATE body" }; });
    const gateway = new OpenAIResponsesGateway("PRIVATE key", config, undefined, { parse });
    const result = await gateway.planSourceQuestion(input);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toEqual({ event: "model_call_timing", callType: "source_question_plan", model: "gpt-5.4", schemaName: "source_question_plan_v1", survey_slug: "nubeqa", status: "success", elapsedMs: 37, reasoningEffort: "low", inputTokens: 1000, outputTokens: 80, reasoningTokens: 45, cachedInputTokens: 700 });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
    expect(result.result).toEqual(plan);
    expect(result.trace.elapsedMs).toBe(37);
    const { elapsedMs: _elapsed, ...oldTrace } = result.trace;
    expect(openAIDebugTraceSchema.parse(oldTrace)).not.toHaveProperty("elapsedMs");
    expect(parse.mock.calls[0][0]).toMatchObject({ model: "gpt-5.4", reasoning: { effort: "low" }, store: true });
    expect(parse.mock.calls[0][0]).not.toHaveProperty("max_output_tokens");
  });
  it("logs provider failure once and rethrows the exact original error without its body", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = Object.assign(new Error("PRIVATE provider message"), { status: 429, body: "PRIVATE response" });
    const parse = vi.fn().mockRejectedValue(failure);
    await expect(new OpenAIResponsesGateway("PRIVATE key", config, undefined, { parse }).planSourceQuestion(input)).rejects.toBe(failure);
    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ status: "failure", inputTokens: null, outputTokens: null, reasoningTokens: null, cachedInputTokens: null });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
    expect(parse).toHaveBeenCalledOnce();
  });
  it("labels missing structured output as failure and drops nonallowlisted survey labels", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const parse = vi.fn().mockResolvedValue({ output_text: "PRIVATE unparsed text", usage: { input_tokens: 0, output_tokens: 0 } });
    await expect(new OpenAIResponsesGateway("PRIVATE key", config, undefined, { parse }).composeControlledRagAnswer(controlledRagCompositionInputSchema.parse({ surveySlug: "PRIVATE study name", participantMessage: "PRIVATE question", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, sources: [{ index: 1, title: "PRIVATE source", url: null, description: null, text: "PRIVATE facts" }] }))).rejects.toThrow("returned no parsed output");
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({ status: "failure", survey_slug: null, inputTokens: 0, outputTokens: 0, reasoningTokens: null, cachedInputTokens: null });
    expect(JSON.stringify(log.mock.calls)).not.toContain("PRIVATE");
  });
  it("does not let logging failures change a successful model result", async () => {
    vi.spyOn(console, "info").mockImplementation(() => { throw new Error("Logging unavailable"); });
    const parse = vi.fn().mockResolvedValue({ output_parsed: plan });
    const result = await new OpenAIResponsesGateway("test", config, undefined, { parse }).planSourceQuestion(input);
    expect(result.result).toEqual(plan);
    expect(parse).toHaveBeenCalledOnce();
  });
  it("labels grounding and phrasing by allowlisted brand without altering reasoning behavior", async () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: { answerBody: "The source describes a result. [1]", usedSourceIndexes: [1], limitations: [] } })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: true, unsupportedClaims: [] } })
      .mockResolvedValueOnce({ output_parsed: { text: "What is your first impression of DDI?" } });
    const gateway = new OpenAIResponsesGateway("test", { ...config, groundingReasoningEffort: "medium" }, undefined, { parse });
    await gateway.composeControlledRagAnswer(controlledRagCompositionInputSchema.parse({ surveySlug: "padcev", participantMessage: "Explain the result.", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, sources: [{ index: 1, title: "Source", url: null, description: null, text: "The source describes a result." }] }));
    await gateway.phraseModeratorTurn({ brand: "BRUKINSA", action: "reaction", priorityLabel: "DDI", participantMessage: "DDI", previousPriorityLabel: null });
    expect(log.mock.calls.map(([entry]) => { const value = JSON.parse(entry as string); return [value.callType, value.survey_slug, value.reasoningEffort]; })).toEqual([["source_composition", "padcev", "low"], ["source_grounding_review", "padcev", "medium"], ["moderator_phrasing", "brukinsa", null]]);
    expect(parse.mock.calls[2][0]).not.toHaveProperty("reasoning");
  });
});
