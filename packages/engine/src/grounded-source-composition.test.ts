import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { controlledRagCompositionInputSchema } from "@interview/schemas";
import { OpenAIResponsesGateway } from "./openai-workflows";

const supported = { version: 1, supported: true, unsupportedClaims: [] };
const gatewayFor = (parse: ReturnType<typeof vi.fn>) => new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
const base = controlledRagCompositionInputSchema.parse({
  surveySlug: "nubeqa", participantMessage: "What does the selected source say?", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
  sources: [{ index: 1, title: "Source", url: null, description: null, text: "With combined P-gp and strong CYP3A4 inhibitors, the label calls for more frequent monitoring for NUBEQA adverse reactions.", evidenceRole: "direct" }],
});
const direct = (answerBody: string, limitations: string[] = []) => ({ answerBody, usedSourceIndexes: [1], limitations });
const contextual = (practicalAnswer: string, qualification: string | null = null) => ({ practicalAnswer, qualification, usedSourceIndexes: [1] });
const requestInput = (parse: ReturnType<typeof vi.fn>, index: number) => JSON.parse(parse.mock.calls[index][0].input[0].content[0].text);

describe("shared direct and contextual grounding", () => {
  it("reviews direct answers, repairs an unsupported absence from its exact draft, and preserves direct output", async () => {
    const rejected = direct("  The label does not name a special toxicity checklist. [1]\n");
    const repaired = direct("With combined P-gp and strong CYP3A4 inhibitors, the label calls for more frequent monitoring for NUBEQA adverse reactions. [1]");
    const violations = [{ excerpt: "does not name a special toxicity checklist", reason: "Omission from the source does not establish absence from the label." }];
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: rejected })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: false, unsupportedClaims: violations } })
      .mockResolvedValueOnce({ output_parsed: repaired }).mockResolvedValueOnce({ output_parsed: supported });
    const result = await gatewayFor(parse).composeControlledRagAnswer(base);
    expect(result.result).toEqual(repaired);
    expect(parse.mock.calls[0][0].text.format.name).toBe("controlled_rag_composition_result_v2");
    expect(requestInput(parse, 0)).not.toHaveProperty("previousDraft");
    expect(requestInput(parse, 2).previousDraft).toEqual({ practicalAnswer: rejected.answerBody, qualification: null });
    expect(requestInput(parse, 2).groundingViolations).toEqual(violations);
    expect(requestInput(parse, 2).sources).toEqual(base.sources);
    for (const index of [1, 3]) {
      expect(requestInput(parse, index).sources).toEqual(base.sources.map(({ index, text }) => ({ index, text })));
      expect(requestInput(parse, index)).not.toHaveProperty("previousDraft");
      expect(requestInput(parse, index)).not.toHaveProperty("participantMessage");
    }
    expect(requestInput(parse, 3).draft.practicalAnswer).toBe(repaired.answerBody);
    expect(result.groundingReview.attempt).toBe(2);
    expect(parse).toHaveBeenCalledTimes(4);
  });

  it("fails closed when direct answers still omit the coadministration condition after repair", async () => {
    const draft = direct("The label calls for more frequent monitoring for all NUBEQA patients. [1]");
    const review = { version: 1, supported: false, unsupportedClaims: [{ excerpt: "for all NUBEQA patients", reason: "The source limits the instruction to a specific coadministration condition." }] };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: draft }).mockResolvedValueOnce({ output_parsed: review })
      .mockResolvedValueOnce({ output_parsed: draft }).mockResolvedValueOnce({ output_parsed: review });
    const error = await gatewayFor(parse).composeControlledRagAnswer(base).catch((error) => error);
    expect(error.message).toContain("unsupported claims");
    expect(error.contextualCompositionAttempts).toHaveLength(2);
    expect(error.contextualCompositionAttempts.every((attempt: { failure: { code: string } }) => attempt.failure.code === "unsupported_claims")).toBe(true);
    expect(parse).toHaveBeenCalledTimes(4);
  });

  it("grounds direct limitations as well as the answer without changing their external shape", async () => {
    const draft = direct("The source describes conditional monitoring. [1]", ["This applies with combined P-gp and strong CYP3A4 inhibitors. [1]"]);
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: draft }).mockResolvedValueOnce({ output_parsed: supported });
    expect((await gatewayFor(parse).composeControlledRagAnswer(base)).result).toEqual(draft);
    expect(requestInput(parse, 1).draft).toEqual({ practicalAnswer: draft.answerBody, qualification: draft.limitations[0] });
  });

  it("supports the full existing direct answer length in reviewer and repair inputs", async () => {
    const body = "Supported text. ".repeat(140) + "[1]";
    expect(body.length).toBeGreaterThan(2000);
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: direct(body) }).mockResolvedValueOnce({ output_parsed: supported });
    expect((await gatewayFor(parse).composeControlledRagAnswer(base)).result.answerBody).toBe(body);
    expect(requestInput(parse, 1).draft.practicalAnswer).toBe(body);
  });

  it.each(["direct", "contextual"] as const)("repairs %s over-budget output before review without truncating it or changing sources", async (mode) => {
    const long = "The selected source describes one supported finding. ".repeat(4).trim() + " [1]";
    const short = "The selected source supports this specific finding and its stated condition. [1]";
    const draft = mode === "direct" ? direct : contextual;
    const input = controlledRagCompositionInputSchema.parse({ ...base,
      presentationPlan: { version: 1, purpose: "source_answer", depth: "brief", maxFacts: 2, maxTopics: 1, askReadiness: false, maxWords: 20 },
      sources: base.sources.map((source) => ({ ...source, evidenceRole: mode })),
    });
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: draft(long) }).mockResolvedValueOnce({ output_parsed: draft(short) })
      .mockResolvedValueOnce({ output_parsed: supported });
    const result = await gatewayFor(parse).composeControlledRagAnswer(input);
    expect(result.result.answerBody).toBe(short);
    expect(requestInput(parse, 1).previousDraft).toEqual({ practicalAnswer: long, qualification: null });
    expect(requestInput(parse, 1).presentationPlan.maxWords).toBe(20);
    expect(requestInput(parse, 1).sources).toEqual(input.sources);
    expect(parse.mock.calls[1][0].text.format.name).not.toBe("source_grounding_review_result_v1");
    expect(parse.mock.calls[2][0].text.format.name).toBe("source_grounding_review_result_v1");
    expect(result.contextualCompositionAttempts[0].failure?.code).toBe("word_budget_exceeded");
    expect(result.contextualCompositionAttempts[0].failure?.stage).toBe("composition");
    expect(parse).toHaveBeenCalledTimes(3);
  });

  it.each(["direct", "contextual"] as const)("rejects %s when combined answer and qualification remain over budget twice", async (mode) => {
    const body = "The selected source supports this finding. [1]";
    const qualification = "This is a supported condition from the selected source that preserves the population and treatment scope of this specific finding. [1]";
    const draft = mode === "direct" ? direct(body, [qualification]) : contextual(body, qualification);
    const input = controlledRagCompositionInputSchema.parse({ ...base,
      presentationPlan: { version: 1, purpose: "source_answer", depth: "brief", maxFacts: 2, maxTopics: 1, askReadiness: false, maxWords: 20 },
      sources: base.sources.map((source) => ({ ...source, evidenceRole: mode })),
    });
    const parse = vi.fn().mockResolvedValue({ output_parsed: draft });
    const error = await gatewayFor(parse).composeControlledRagAnswer(input).catch((error) => error);
    expect(error.code).toBe("word_budget_exceeded");
    expect(error.contextualCompositionAttempts).toHaveLength(2);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(parse.mock.calls.every(([request]) => request.text.format.name !== "source_grounding_review_result_v1")).toBe(true);
  });

  it("does not count standalone citation markers against a direct word budget", async () => {
    const body = "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty [1]";
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: direct(body) }).mockResolvedValueOnce({ output_parsed: supported });
    const input = controlledRagCompositionInputSchema.parse({ ...base, presentationPlan: { version: 1, purpose: "source_answer", depth: "brief", maxFacts: 2, maxTopics: 1, askReadiness: false, maxWords: 20 } });
    expect((await gatewayFor(parse).composeControlledRagAnswer(input)).result.answerBody).toBe(body);
    expect(parse).toHaveBeenCalledTimes(2);
  });
});
