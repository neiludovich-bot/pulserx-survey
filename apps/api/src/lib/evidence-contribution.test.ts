import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../../../packages/schemas/src/index"));
const mocks = vi.hoisted(() => ({ select: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ selectModeratorEvidence: mocks.select }) }));
import { selectFocusedSourceEvidence } from "./focused-source-evidence";
import type { ControlledRagChunk } from "./controlled-rag-source-packs";

const source = (surveySlug: ControlledRagChunk["surveySlug"], id: string, text: string): ControlledRagChunk => ({
  surveySlug, id, title: id, text, description: "Synthetic evidence", url: `https://example.test/${id}`, tags: [],
  assets: [{ title: id, description: null, url: `https://example.test/${id}.svg`, assetKind: "CHART", tags: [], priority: 1 }],
});
const selection = (candidate: ControlledRagChunk, contribution: string, evidenceRole = "direct") => ({ sourceId: candidate.id, supportExcerpt: candidate.text, assetIds: [`${candidate.id}:asset:0`], evidenceRole, contribution });

describe("evidence contribution boundary", () => {
  afterEach(() => { vi.restoreAllMocks(); mocks.select.mockReset(); });
  const contextPlan = { version: 1 as const, interpretedQuestion: "Explain the instruction and requested practical context.", retrievalQueries: ["instruction", "practical context"], answerApproach: "contextual_explanation" as const, usesSourceContext: true, contextBoundary: "Keep general guidance separate.", rationale: "Requested context." };

  it("does not replace the sole answer with a qualification from the same source during contextual merge", async () => {
    const answer = "With condition A, monitor outcome A.";
    const qualification = "This applies only to population A.";
    const candidate = source("nubeqa", "shared", `${answer} ${qualification}`);
    mocks.select.mockResolvedValueOnce({ result: { selections: [{ ...selection(candidate, "answer"), supportExcerpt: answer }], rationale: "The supported answer." } })
      .mockResolvedValueOnce({ result: { selections: [{ ...selection(candidate, "essential_qualification", "contextual"), supportExcerpt: qualification }], rationale: "A separate qualification in the same source." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: contextPlan.interpretedQuestion, candidates: [candidate], fallbackSourceIds: [], sourceQuestionPlan: contextPlan });
    expect(result.chunks).toEqual([expect.objectContaining({ id: candidate.id, text: answer, assets: candidate.assets })]);
    expect(result).not.toHaveProperty("units");
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });

  it("retains an answer placed behind qualifiers when the contextual merge reaches the three-source limit", async () => {
    const candidates = ["old-qualifier-a", "old-qualifier-b", "answer", "new-qualifier-a", "new-qualifier-b"].map((id) => source("brukinsa", id, `${id} has its own exact source text.`));
    mocks.select.mockResolvedValueOnce({ result: { selections: [selection(candidates[0], "essential_qualification"), selection(candidates[1], "essential_qualification"), selection(candidates[2], "answer")], rationale: "Answer follows two qualifiers." } })
      .mockResolvedValueOnce({ result: { selections: [selection(candidates[3], "essential_qualification", "contextual"), selection(candidates[4], "essential_qualification", "contextual")], rationale: "Two separately supported qualifications." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "brukinsa", query: contextPlan.interpretedQuestion, candidates, fallbackSourceIds: [], sourceQuestionPlan: contextPlan });
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["answer", "new-qualifier-a", "new-qualifier-b"]);
    expect(result.chunks[0].text).toBe(candidates[2].text);
    expect(result.chunks[0].assets).toEqual(candidates[2].assets);
    expect(result.chunks.slice(1).every((chunk) => chunk.assets?.length === 0)).toBe(true);
  });

  it("preserves requested-context answer evidence during merge and allows it to replace a qualification", async () => {
    const answer = source("padcev", "answer", "A requested instruction.");
    const context = source("padcev", "context", "General guidance identifies a named monitoring detail. This applies to population A.");
    mocks.select.mockResolvedValueOnce({ result: { selections: [selection(context, "essential_qualification", "contextual"), selection(answer, "answer")], rationale: "Answer with qualification." } })
      .mockResolvedValueOnce({ result: { selections: [{ ...selection(context, "requested_context", "contextual"), supportExcerpt: "General guidance identifies a named monitoring detail." }], rationale: "The practical detail actually requested." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "padcev", query: contextPlan.interpretedQuestion, candidates: [answer, context], fallbackSourceIds: [], sourceQuestionPlan: contextPlan });
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["answer", "context"]);
    expect(result.chunks[1].text).toBe("General guidance identifies a named monitoring detail.");
    expect(result.chunks[1].assets).toEqual(context.assets);
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)("excludes an unsolicited %s contrast and its owned chart before composition", async (surveySlug) => {
    const requested = source(surveySlug, "requested", "Trial A reports outcome X in population A.");
    const contrast = source(surveySlug, "contrast", "Trial B reports outcome Y rather than outcome X.");
    mocks.select.mockResolvedValue({ result: { selections: [selection(requested, "answer"), selection(contrast, "contrast_or_limit_only")], rationale: "Only X was requested; the second source merely contrasts a different endpoint." } });
    const result = await selectFocusedSourceEvidence({ surveySlug, query: "Explain outcome X.", candidates: [requested, contrast], fallbackSourceIds: [contrast.id] });
    expect(result.mode).toBe("semantic");
    expect(result.chunks.map((chunk) => chunk.id)).toEqual([requested.id]);
    expect(result.chunks[0].text).toBe(requested.text);
    expect(result.chunks[0].assets).toEqual(requested.assets);
    expect(JSON.stringify(result.chunks)).not.toContain("contrast");
    expect(mocks.select).toHaveBeenCalledOnce();
  });
  it("preserves an explicit comparison because both findings answer the request", async () => {
    const candidates = [source("nubeqa", "x", "Study X reports its own result."), source("nubeqa", "y", "Study Y reports a different endpoint in a different setting.")];
    mocks.select.mockResolvedValue({ result: { selections: candidates.map((candidate) => selection(candidate, "answer")), rationale: "Both endpoints were explicitly requested." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "Compare X and Y while preserving their settings.", candidates, fallbackSourceIds: [] });
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["x", "y"]);
    expect(result.chunks.every((chunk) => chunk.assets?.length === 1)).toBe(true);
  });
  it("retains necessary qualifications without their chart and requested practical context with its own visual", async () => {
    const candidates = [source("padcev", "answer", "With condition A, monitor outcome A."), source("padcev", "qualifier", "This instruction applies only under condition A."), source("padcev", "context", "General safety guidance directs monitoring symptom B.")];
    mocks.select.mockResolvedValue({ result: { selections: [selection(candidates[0], "answer"), selection(candidates[1], "essential_qualification"), selection(candidates[2], "requested_context", "contextual")], rationale: "The question asks for the supported instruction and practical context." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "padcev", query: "Explain the monitoring instruction and practical context.", candidates, fallbackSourceIds: [] });
    expect(result.chunks.map((chunk) => chunk.text)).toEqual(candidates.map((candidate) => candidate.text));
    expect(result.chunks[1].assets).toEqual([]);
    expect(result.chunks[2].assets).toEqual(candidates[2].assets);
  });
  it("does not substitute an unrequested limitation or an unattached qualifier when no answer evidence exists", async () => {
    const candidates = [source("brukinsa", "limit", "This excerpt does not report incidence rates."), source("brukinsa", "qualifier", "Only population A was studied.")];
    mocks.select.mockResolvedValue({ result: { selections: [selection(candidates[0], "contrast_or_limit_only"), selection(candidates[1], "essential_qualification")], rationale: "No source answers the actual question." } });
    expect((await selectFocusedSourceEvidence({ surveySlug: "brukinsa", query: "Explain the interaction instructions.", candidates, fallbackSourceIds: candidates.map((candidate) => candidate.id) })).chunks).toEqual([]);
  });
  it("rejects an unknown contribution rather than guessing its permission", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const candidate = source("nubeqa", "source", "A factual source.");
    mocks.select.mockResolvedValue({ result: { selections: [selection(candidate, "anything_goes")], rationale: "Invalid contract." } });
    expect((await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "Explain the source.", candidates: [candidate], fallbackSourceIds: [candidate.id] })).mode).toBe("unavailable");
    expect(mocks.select).toHaveBeenCalledTimes(2);
  });
});
