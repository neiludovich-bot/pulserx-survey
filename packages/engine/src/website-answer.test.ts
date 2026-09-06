import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import type { ModeratorEvidenceSelectionInput } from "@interview/schemas";
import { validateWebsiteAnswer } from "./website-answer";
import { OpenAIResponsesGateway } from "./openai-workflows";

const input: ModeratorEvidenceSelectionInput = {
  surveySlug: "nubeqa", query: "What did Study A report?", sourceTopicContext: null,
  priorSourceIds: [], sourceQuestionPlan: null, evidenceFocus: "all",
  candidates: [{ id: "study-a", title: "Study A", url: "https://example.test/study-a", description: "Synthetic fixture", tags: [],
    text: "Study A reported 12 months in population X. This was assessed under condition Y.",
    assets: [{ id: "study-a:asset:0", title: "Study A result", url: "https://example.test/a.png", description: "Synthetic result", assetKind: "IMAGE", tags: [] }] }],
};
const output = { version: 1, selections: [{ sourceId: "study-a", supportSpanRange: { startSpan: 0, endSpan: 1 },
  assetIds: ["study-a:asset:0"], evidenceRole: "direct", contribution: "answer" }],
  paragraphs: [{ text: "Study A reported 12 months in population X under condition Y.", sourceIds: ["study-a"] }],
  unavailableReason: null, rationale: "Use the reported study result." };

describe("one-pass website answers", () => {
  it("removes redundant inline source IDs while preserving structured citations and clinical text", () => {
    const id = "db:fixture";
    const evidence = { ...input, candidates: [{ ...input.candidates[0], id }] };
    const answer = { ...output, selections: [{ ...output.selections[0], sourceId: id, assetIds: [] }], paragraphs: [{ text: `${output.paragraphs[0].text}[${id}]`, sourceIds: [id] }] };
    const result = validateWebsiteAnswer(evidence, answer);
    expect(result.paragraphs).toEqual([{ text: output.paragraphs[0].text, sourceIds: [id] }]);
    expect(() => validateWebsiteAnswer(evidence, { ...answer, paragraphs: [{ text: "A result.[db:unknown]", sourceIds: [id] }] })).toThrow("invalid_output");
    expect(() => validateWebsiteAnswer(evidence, { ...answer, paragraphs: [{ text: `24 months.[${id}]`, sourceIds: [id] }] })).toThrow("unsupported_number");
  });
  it("reconstructs original support and keeps paragraph/source ownership", () => {
    const result = validateWebsiteAnswer(input, output);
    expect(result.selections[0].supportExcerpt).toBe(input.candidates[0].text);
    expect(result.paragraphs).toEqual(output.paragraphs);
  });
  it.each(["unknown", "other-bot-source"])("rejects unowned evidence %s", sourceId => {
    expect(() => validateWebsiteAnswer(input, { ...output, selections: [{ ...output.selections[0], sourceId }] })).toThrow();
  });
  it("rejects an asset from another source", () => {
    expect(() => validateWebsiteAnswer(input, { ...output, selections: [{ ...output.selections[0], assetIds: ["other:asset:0"] }] })).toThrow();
  });
  it("rejects source IDs in a paragraph that were not selected", () => {
    expect(() => validateWebsiteAnswer(input, { ...output, paragraphs: [{ text: "A result.", sourceIds: ["unknown"] }] })).toThrow();
  });
  it("rejects a fabricated numerical value", () => {
    expect(() => validateWebsiteAnswer(input, { ...output, paragraphs: [{ ...output.paragraphs[0], text: "Study A reported 24 months." }] })).toThrow("unsupported_number");
  });
  it("rejects unsolicited MFS or OS even when that comparison has source support", () => {
    const scoped = { ...input, query: "What PFS information is available?", candidates: [{ ...input.candidates[0], text: "Study A reports PFS. Study B reports MFS and overall survival." }] };
    const comparison = { ...output, paragraphs: [{ text: "Study A reports PFS; Study B reports MFS and overall survival instead.", sourceIds: ["study-a"] }] };
    expect(() => validateWebsiteAnswer(scoped, comparison)).toThrow("unrequested_endpoint");
    expect(() => validateWebsiteAnswer({ ...scoped, query: "Compare PFS and MFS with overall survival." }, comparison)).not.toThrow();
  });
  it("cannot convert no evidence into a fabricated answer", () => {
    expect(() => validateWebsiteAnswer(input, { ...output, unavailableReason: "not_in_sources" })).toThrow();
    expect(validateWebsiteAnswer(input, { ...output, selections: [], paragraphs: [], unavailableReason: "not_in_sources" }).paragraphs).toEqual([]);
  });
  it("rejects an expanding repeated simplification", () => {
    const brief = { ...input, presentationPlan: { version: 1 as const, purpose: "source_answer" as const, depth: "brief" as const, maxFacts: 1, maxTopics: 1, askReadiness: false },
      presentationContext: { version: 1 as const, kind: "simplify_previous_answer" as const, participantRequest: "Even simpler", lastSourceAnswer: Array(20).fill("word").join(" ") } };
    expect(() => validateWebsiteAnswer(brief, { ...output, paragraphs: [{ text: Array(21).fill("word").join(" "), sourceIds: ["study-a"] }] })).toThrow("too_verbose");
    expect(() => validateWebsiteAnswer(brief, { ...output, paragraphs: [{ text: Array(46).fill("word").join(" "), sourceIds: ["study-a"] }] })).toThrow("too_verbose");
  });
  it("uses one model call for source selection and writing, without a review loop", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: output });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test", sourceModel: "test" }, undefined, { parse });
    const result = await gateway.answerFromWebsite(input);
    expect(result.attempts).toBe(1);
    expect(parse).toHaveBeenCalledOnce();
    expect(result.trace.callType).toBe("website_answer");
    expect(result).not.toHaveProperty("groundingReview");
  });
  it("repairs a local numerical failure once with typed feedback", async () => {
    const bad = { ...output, paragraphs: [{ ...output.paragraphs[0], text: "Study A reported 24 months." }] };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: bad }).mockResolvedValueOnce({ output_parsed: output });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    expect((await gateway.answerFromWebsite(input)).attempts).toBe(2);
    const repairInput = JSON.parse(parse.mock.calls[1][0].input[0].content[0].text);
    expect(repairInput.repairFeedback).toBe("unsupported_number");
    expect(repairInput.repairDetail).toEqual({ paragraph: "Study A reported 24 months.", unsupportedNumbers: ["24"], sourceIds: ["study-a"] });
  });
  it("does not make an extra application retry for provider failures", async () => {
    const parse = vi.fn().mockRejectedValue({ status: 429, message: "Synthetic provider failure" });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    await expect(gateway.answerFromWebsite(input)).rejects.toMatchObject({ status: 429 });
    expect(parse).toHaveBeenCalledOnce();
  });
});
