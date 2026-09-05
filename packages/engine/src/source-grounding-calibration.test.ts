import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { controlledRagCompositionInputSchema, sourceGroundingReviewInputSchema, sourceGroundingReviewResultSchema } from "@interview/schemas";
import { sourceGroundingReviewSystemPrompt, contextualSourceCompositionSystemPrompt, directSourceCompositionSystemPrompt } from "@interview/prompts";
import { OpenAIResponsesGateway } from "./openai-workflows";
import { sourceGroundingCalibrationFixtures } from "./source-grounding-calibration-fixtures";

describe("source-grounding calibration replay contracts", () => {
  // These are deterministic delivery/repair contracts using gold reviewer verdicts.
  // The exported fixtures can also be replayed against the real reviewer model.
  it.each(sourceGroundingCalibrationFixtures)("preserves the gold review and delivery boundary for $id", async ({ input, expected }) => {
    expect(sourceGroundingReviewInputSchema.parse(input)).toEqual(input);
    expect(sourceGroundingReviewResultSchema.parse(expected)).toEqual(expected);
    const usedSourceIndexes = [...new Set([...input.draft.practicalAnswer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))];
    const composition = { ...input.draft, usedSourceIndexes };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: composition }).mockResolvedValueOnce({ output_parsed: expected })
      .mockResolvedValueOnce({ output_parsed: composition }).mockResolvedValueOnce({ output_parsed: expected });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const result = gateway.composeControlledRagAnswer(controlledRagCompositionInputSchema.parse({
      surveySlug: "nubeqa", participantMessage: "Explain the supplied information.", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
      sources: input.sources.map((source) => ({ ...source, title: "Replay excerpt", url: null, description: null, evidenceRole: "contextual" })),
    }));
    if (expected.supported) {
      await expect(result).resolves.toMatchObject({ result: { answerBody: input.draft.practicalAnswer } });
      expect(parse).toHaveBeenCalledTimes(2);
    } else {
      await expect(result).rejects.toThrow("unsupported claims");
      expect(parse).toHaveBeenCalledTimes(4);
      const repair = JSON.parse(parse.mock.calls[2][0].input[0].content[0].text);
      expect(repair.groundingViolations).toEqual(expected.unsupportedClaims);
    }
    expect(JSON.parse(parse.mock.calls[1][0].input[0].content[0].text)).toEqual(input);
    expect(parse.mock.calls[1][0].instructions).toBe(sourceGroundingReviewSystemPrompt.instructions.join("\n"));
  });

  it("calibrates wording and authority while retaining checks for changed clinical meaning", () => {
    const reviewer = sourceGroundingReviewSystemPrompt.instructions.join("\n");
    expect(reviewer).toContain("Judge semantic entailment, not verbatim wording");
    expect(reviewer).toContain("exact-copy rule applies only to unsupportedClaims[].excerpt");
    expect(reviewer).toContain("Do not reject it solely for omitting boilerplate");
    expect(reviewer).toContain("conditional on coadministration must retain that condition");
    expect(reviewer).toContain("require explicit support, not merely omission");
    expect(sourceGroundingReviewSystemPrompt.version).toBe("source-grounding-review-v3");
    expect(contextualSourceCompositionSystemPrompt.instructions.join("\n")).toContain("Do not call a checklist the label");
    expect(directSourceCompositionSystemPrompt.instructions.join("\n")).not.toContain("Attribute management guidance to the label without");
  });
});
