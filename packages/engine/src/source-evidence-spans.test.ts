import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { indexedSourceSpans, normalizeSourceEvidenceSpanSelection } from "./source-evidence-spans";
import { sourceEvidenceSpanSelectionModelResultSchema, moderatorEvidenceSelectionResultSchema } from "../../schemas/src/index";
import { OpenAIResponsesGateway } from "./openai-workflows";
import { zodTextFormat } from "openai/helpers/zod";

const text = "Do not coadminister X.\r\n\r\nOnly when condition A applies, monitor symptoms at 1.5 weeks.  Rates were 70.3% vs. 52.1% in the comparator arm.";
const input = { surveySlug: "padcev" as const, query: "What does the source report?", candidates: [{ id: "source", title: "Source", url: "", description: "", text, tags: [], assets: [{ id: "own-asset", title: "Source figure", url: "https://example.test/figure.svg", description: "", assetKind: "CHART", tags: [] }] }] };
const selection = { sourceId: "source", supportSpanRange: { startSpan: 0, endSpan: 1 }, assetIds: ["own-asset"], evidenceRole: "direct", contribution: "answer" };
const output = { selections: [selection], rationale: "Exact source selection." };

describe("indexed source evidence spans", () => {
  it("reconstructs original CRLF, whitespace, negation, and conditional text without copying model prose", () => {
    const result = normalizeSourceEvidenceSpanSelection(input, output);
    expect(result.selections[0].supportExcerpt).toBe("Do not coadminister X.\r\n\r\nOnly when condition A applies, monitor symptoms at 1.5 weeks.");
    expect(result.selections[0]).toMatchObject({ assetIds: ["own-asset"], contribution: "answer", evidenceRole: "direct" });
    expect(result.selections[0]).not.toHaveProperty("supportSpanRange");
  });
  it("keeps common abbreviation/comparison and numbered instructions together", () => {
    expect(indexedSourceSpans("Median PFS was 14.2 vs. 6.3 months with comparator.").map((span) => span.text)).toEqual(["Median PFS was 14.2 vs. 6.3 months with comparator."]);
    expect(indexedSourceSpans("1. Do not coadminister X. 2. Only if condition A applies, monitor symptoms.").map((span) => span.text)).toEqual(["1. Do not coadminister X.", "2. Only if condition A applies, monitor symptoms."]);
    expect(indexedSourceSpans(text).at(-1)?.text).toBe("Rates were 70.3% vs. 52.1% in the comparator arm.");
  });
  it.each([{ startSpan: 1, endSpan: 0 }, { startSpan: 0, endSpan: 99 }, { startSpan: -1, endSpan: 0 }, { startSpan: 0.5, endSpan: 1 }])("rejects invalid range %j", (supportSpanRange) => {
    expect(() => normalizeSourceEvidenceSpanSelection(input, { ...output, selections: [{ ...selection, supportSpanRange }] })).toThrow();
  });
  it("fails closed for overlong complete sentences and does not silently clip them", () => {
    expect(() => normalizeSourceEvidenceSpanSelection({ ...input, candidates: [{ ...input.candidates[0], text: `Do not ${"word ".repeat(350)}coadminister X.` }] }, { ...output, selections: [{ ...selection, supportSpanRange: { startSpan: 0, endSpan: 0 } }] })).toThrow("1500-character");
  });
  it("retains source/asset ownership, duplicate, contextual-role and single-fact restrictions", () => {
    expect(() => normalizeSourceEvidenceSpanSelection(input, { ...output, selections: [{ ...selection, sourceId: "missing" }] })).toThrow("submitted source");
    expect(() => normalizeSourceEvidenceSpanSelection(input, { ...output, selections: [{ ...selection, assetIds: ["foreign-asset"] }] })).toThrow("belong");
    expect(() => normalizeSourceEvidenceSpanSelection(input, { ...output, selections: [selection, selection] })).toThrow("distinct");
    expect(() => normalizeSourceEvidenceSpanSelection({ ...input, evidenceFocus: "contextual" }, output)).toThrow("cannot select direct");
    expect(() => normalizeSourceEvidenceSpanSelection({ ...input, presentationPlan: { version: 1, purpose: "source_answer", depth: "brief", maxFacts: 1, maxTopics: 1, askReadiness: false } }, { ...output, selections: [selection, selection] })).toThrow("at most one");
  });
  it("keeps canonical historical excerpts valid while requiring strict span-only wire output", () => {
    const canonical = { selections: [{ sourceId: "source", supportExcerpt: "Do not coadminister X.", assetIds: [] }], rationale: "Historical canonical selection" };
    expect(moderatorEvidenceSelectionResultSchema.safeParse(canonical).success).toBe(true);
    expect(sourceEvidenceSpanSelectionModelResultSchema.safeParse(canonical).success).toBe(false);
    expect(sourceEvidenceSpanSelectionModelResultSchema.safeParse({ ...output, selections: [{ ...selection, supportExcerpt: "Invented copied text" }] }).success).toBe(false);
    const schema = zodTextFormat(sourceEvidenceSpanSelectionModelResultSchema, "evidence_spans").schema;
    expect(schema.additionalProperties).toBe(false);
  });
  it("sends spans without duplicate full text and reconstructs the canonical result in one actual gateway call", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: output });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const result = await gateway.selectModeratorEvidence(input);
    expect(parse).toHaveBeenCalledOnce();
    const sent = JSON.parse(parse.mock.calls[0][0].input[0].content[0].text);
    expect(sent.candidates[0]).not.toHaveProperty("text");
    expect(sent.candidates[0].spans[0]).toEqual({ index: 0, text: "Do not coadminister X." });
    expect(sent.candidates[0].spans[0]).not.toHaveProperty("start");
    expect(result.result.selections[0].supportExcerpt).toBe(text.slice(0, text.indexOf("  Rates")));
    expect(result.trace.request.schemaName).toBe("moderator_evidence_span_selection_v1");
  });
});
