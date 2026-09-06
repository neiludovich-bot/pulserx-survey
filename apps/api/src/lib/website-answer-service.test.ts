import { beforeEach, describe, expect, it, vi } from "vitest";
import { moderatorEvidenceSelectionInputSchema } from "@interview/schemas";
import { answerFromWebsite, renderWebsiteAnswer, type WebsiteAnswerInput } from "./website-answer-service";
const mocks = vi.hoisted(() => ({ answer: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ answerFromWebsite: mocks.answer }) }));
const input: WebsiteAnswerInput = { surveySlug: "nubeqa", query: "Study result", sourceTopicContext: null, sourceQuestionPlan: null, priorSourceIds: [], evidenceFocus: "all",
  candidates: [{ id: "a", surveySlug: "nubeqa", title: "Study A", url: "https://example.test/a", description: "Fixture", tags: [], text: "Original supporting source text.",
    assets: [{ title: "A figure", url: "https://example.test/a.png", description: "Figure", assetKind: "IMAGE", tags: [], priority: 1 }] }] };
beforeEach(() => {
  mocks.answer.mockReset();
  mocks.answer.mockImplementation(async value => {
    moderatorEvidenceSelectionInputSchema.parse(value);
    return { result: { selections: [{ sourceId: "a", supportExcerpt: input.candidates[0].text, assetIds: ["a:asset:0"], evidenceRole: "direct", contribution: "answer" }],
      paragraphs: [{ text: "Source explanation.", sourceIds: ["a"] }], unavailableReason: null }, trace: { response: { id: "synthetic", model: "test" } } };
  });
});
describe("website answer adapter", () => {
  it("preserves source-owned figures and records provenance rather than review approval", async () => {
    const result = await answerFromWebsite(input);
    expect(mocks.answer).toHaveBeenCalledOnce();
    expect(result?.chunks[0].assets).toEqual(input.candidates[0].assets);
    expect(result?.outcome.attempts[0].code).toBe("source_linked");
    expect(result).not.toHaveProperty("groundingReview");
  });
  it("rejects mixed-bot candidates before a model call", async () => {
    await expect(answerFromWebsite({ ...input, candidates: [{ ...input.candidates[0], surveySlug: "padcev" }] })).rejects.toThrow("current bot");
    expect(mocks.answer).not.toHaveBeenCalled();
  });
  it("attaches citations after final source ordering", () => {
    const chunks = [{ ...input.candidates[0], id: "b" }, input.candidates[0]];
    expect(renderWebsiteAnswer([{ text: "Explanation.", sourceIds: ["a", "b"] }], chunks)).toBe("Explanation. [2] [1]");
    expect(() => renderWebsiteAnswer([{ text: "Explanation.", sourceIds: ["missing"] }], chunks)).toThrow();
  });
});
