import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { OpenAIResponsesGateway } from "./openai-workflows";
import { validateModeratorEvidenceSelection } from "./moderator-planning";

const presentationPlan = { version: 1 as const, purpose: "source_answer" as const, depth: "brief" as const, maxFacts: 1, maxTopics: 1, maxWords: 40, askReadiness: false };
const input = { surveySlug: "nubeqa" as const, query: "Explain the current monitoring point more simply.", presentationPlan,
  candidates: ["first", "second"].map((id) => ({ id, title: id, url: "", description: "", text: "When condition A applies, monitor outcome A.", tags: [], assets: [] })) };

describe("evidence presentation contract", () => {
  it.each(["all", "contextual"] as const)("structurally bounds %s selection to one exact source while preserving presentation context", async (evidenceFocus) => {
    const output = { selections: [{ sourceId: "first", supportExcerpt: input.candidates[0].text, assetIds: [], evidenceRole: evidenceFocus === "contextual" ? "contextual" : "direct", contribution: "answer" }], rationale: "One complete conditional instruction." };
    const parse = vi.fn().mockResolvedValue({ output_parsed: { ...output, selections: output.selections.map(({ supportExcerpt: _text, ...selection }) => ({ ...selection, supportSpanRange: { startSpan: 0, endSpan: 0 } })) } });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    expect((await gateway.selectModeratorEvidence({ ...input, evidenceFocus })).result).toEqual(output);
    const request = parse.mock.calls[0][0];
    expect(request.text.format.schema.properties.selections.maxItems).toBe(1);
    expect(request.text.format.name).toBe(`moderator_${evidenceFocus}_single_fact_span_selection_v1`);
    expect(JSON.parse(request.input[0].content[0].text).presentationPlan).toEqual(presentationPlan);
    expect(() => validateModeratorEvidenceSelection(input, { ...output, selections: [...output.selections, { ...output.selections[0], sourceId: "second" }] })).toThrow("at most one");
    expect(() => validateModeratorEvidenceSelection(input, { ...output, selections: [{ ...output.selections[0], supportExcerpt: "Invented condition." }] })).toThrow("exact supporting excerpt");
  });
});
