import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceQuestionPlan } from "@interview/schemas";
import * as modelGateway from "./model-gateway";
import { alignCitedSourceReferences, selectFocusedSourceEvidence, withExplicitSourceAssets } from "./focused-source-evidence";
import { askControlledRagForSurveyInterviewerTurn, controlledRagTestInternals } from "./controlled-rag-service";
import { CONTROLLED_RAG_CHUNKS, type ControlledRagChunk } from "./controlled-rag-source-packs";

function mockSelector(result: unknown) {
  const selectModeratorEvidence = vi.fn().mockResolvedValue({ result });
  vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue({ selectModeratorEvidence } as unknown as NonNullable<ReturnType<typeof modelGateway.getOptionalOpenAIGateway>>);
  return selectModeratorEvidence;
}

function source(surveySlug: ControlledRagChunk["surveySlug"], id: string): ControlledRagChunk {
  return { surveySlug, id, title: "Trial evidence", description: "Approved trial evidence", url: `https://example.com/${id}`, text: "Progression-free survival evidence from this trial. Separate safety context is also present in this document. Administration instructions are present.", tags: ["efficacy"], assets: [{
    title: "Progression-free survival curve", description: "Trial endpoint", url: `https://example.com/${id}.png`, assetKind: "CHART", tags: ["pfs"], priority: 1,
  }, {
    title: "Adverse reactions", description: "Other outcome", url: `https://example.com/${id}-safety.png`, assetKind: "CHART", tags: ["safety"], priority: 100,
  }] };
}

const contextualPlan: SourceQuestionPlan = {
  version: 1, interpretedQuestion: "Explain the direct evidence alongside separate safety context.",
  retrievalQueries: ["direct evidence", "separate safety context"], answerApproach: "contextual_explanation",
  usesSourceContext: true, contextBoundary: "Do not infer causal relationships from general safety context.",
  rationale: "Both evidence roles are needed.",
};

describe("focused evidence selection", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("does not add a second contextual pass to a one-fact presentation", async () => {
    const candidate = source("nubeqa", "selected");
    const select = mockSelector({ selections: [{ sourceId: candidate.id, supportExcerpt: candidate.text.split(". ")[0] + ".", assetIds: [], evidenceRole: "contextual" }], rationale: "One complete fact." });
    const presentationPlan = { version: 1 as const, purpose: "source_answer" as const, depth: "brief" as const, maxFacts: 1, maxTopics: 1, maxWords: 40, askReadiness: false };
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "Explain the current detail simply", candidates: [candidate], fallbackSourceIds: [], sourceQuestionPlan: contextualPlan, presentationPlan });
    expect(result.chunks).toHaveLength(1);
    expect(select).toHaveBeenCalledOnce();
    expect(select.mock.calls[0][0].presentationPlan).toEqual(presentationPlan);
  });

  it("fails closed when a one-fact selection returns multiple sources", async () => {
    const candidates = [source("nubeqa", "first"), source("nubeqa", "second")];
    const select = mockSelector({ selections: candidates.map((candidate) => ({ sourceId: candidate.id, supportExcerpt: candidate.text, assetIds: [], evidenceRole: "direct" })), rationale: "Too much evidence." });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "Explain more simply", candidates, fallbackSourceIds: ["first"], presentationPlan: { version: 1, purpose: "source_answer", depth: "brief", maxFacts: 1, maxTopics: 1, askReadiness: false } });
    expect(result).toEqual({ mode: "unavailable", chunks: [] });
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("removes uncited sources and renumbers markers without changing source ownership", () => {
    const references = ["unused", "used"].map((id) => ({ citationId: id, title: id, url: `https://example.com/${id}`, description: null, assets: [] }));
    expect(alignCitedSourceReferences("The rate was 70.3%. [2]", references)).toEqual({ answer: "The rate was 70.3%. [1]", references: [references[1]] });
    expect(() => alignCitedSourceReferences("Unsupported. [3]", references)).toThrow();
  });

  it.each(["[2-3]", "[2, 3]", "[2–3]"])("normalizes grouped citation %s and keeps ownership aligned", (marker) => {
    const references = ["unused", "first", "second"].map((id) => ({ citationId: id, title: id, url: `https://example.com/${id}`, description: null, assets: [] }));
    expect(alignCitedSourceReferences(`The rate was 70.3%. ${marker}`, references)).toEqual({ answer: "The rate was 70.3%. [1] [2]", references: references.slice(1) });
    expect(() => alignCitedSourceReferences("Invalid. [1-4]", references)).toThrow();
    expect(() => alignCitedSourceReferences("Invalid. [3-1]", references)).toThrow();
  });

  it("resolves a source clarification to the active moderator topic instead of the previous reaction", () => {
    const input = { surveySlug: "brukinsa" as const, participantMessage: "Can you explain that more simply?", surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only" as const, recentInterviewerContext: "participant: That PFS evidence increases my confidence.\ninterviewer: Now let's move to DDI. BRUKINSA has drug-interaction considerations.", sourceTopicContext: "What drug interactions are documented for BRUKINSA?" };
    expect(controlledRagTestInternals.sourceTurnInputs(input).retrievalQuery).toBe(input.sourceTopicContext);
    expect(controlledRagTestInternals.sourceTurnInputs({ ...input, sourceTopicContext: null }).retrievalQuery).toBe("Now let's move to DDI. BRUKINSA has drug-interaction considerations.");
    expect(controlledRagTestInternals.sourceTurnInputs({ ...input, participantMessage: "What did ALPINE show?" }).retrievalQuery).toBe("What did ALPINE show?");
  });

  it("uses the next selected source question for legacy answer-then-ask rather than the previous reaction", async () => {
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue(null);
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: "I would be concerned about CYP3A4 inducers.", surveyContext: "NUBEQA", currentQuestion: "What do you think of DDI?", selectedNextQuestion: "What access and patient support resources do you need?", selectedQuestionSourceContext: "NUBEQA patient access and support resources", responseMode: "answer_then_ask" });
    expect(result.references.map((reference) => reference.citationId)).toEqual(["rag:nubeqa-guidelines-resources"]);
    expect(result.answer).not.toContain("CYP3A4");
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)("uses the typed semantic selection and only selected own assets for %s", async (surveySlug) => {
    const select = mockSelector({ selections: [{ sourceId: "trial", assetIds: ["trial:asset:0"], supportExcerpt: "Progression-free survival evidence from this trial." }], rationale: "The curve supports the selected endpoint." });
    const result = await selectFocusedSourceEvidence({ surveySlug, query: "How long did participants remain without progression?", candidates: [source(surveySlug, "safety"), source(surveySlug, "trial")], fallbackSourceIds: ["safety"] });
    expect(result.mode).toBe("semantic");
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["trial"]);
    expect(result.chunks[0].text).toBe("Progression-free survival evidence from this trial.");
    expect(result.chunks[0].assets?.map((asset) => asset.url)).toEqual(["https://example.com/trial.png"]);
    expect(select.mock.calls[0][0].query).toBe("How long did participants remain without progression?");
  });

  it("rejects a source borrowing another source's asset even if the model returns it", async () => {
    mockSelector({ selections: [{ sourceId: "trial", assetIds: ["safety:asset:0"], supportExcerpt: "Progression-free survival evidence from this trial." }], rationale: "Invalid ownership fixture." });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "PFS", candidates: [source("nubeqa", "trial"), source("nubeqa", "safety")], fallbackSourceIds: ["trial"] });
    expect(result.mode).toBe("unavailable");
    expect(result.chunks).toEqual([]);
  });

  it("preserves an explicit unsupported selection rather than silently substituting another trial", async () => {
    mockSelector({ selections: [], rationale: "None of these sources supports the requested population." });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "A different trial population", candidates: [source("nubeqa", "trial")], fallbackSourceIds: ["trial"] });
    expect(result).toEqual({ mode: "semantic", chunks: [] });
  });

  it("does not replace a failed interaction selection with an unrelated efficacy card or expose raw errors", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const select = mockSelector(null).mockRejectedValue(Object.assign(new Error("Sensitive request/output content must not be logged"), { name: "ZodError" }));
    const result = await selectFocusedSourceEvidence({ surveySlug: "padcev", query: "What drug-drug interactions are documented?", candidates: [source("padcev", "efficacy")], fallbackSourceIds: ["efficacy"] });
    expect(result).toEqual({ mode: "unavailable", chunks: [] });
    expect(select).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "source_evidence_selection_failed", category: "ZodError" }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Sensitive request/output");
  });

  it("recovers on one retry when an invalid selection is followed by validated evidence", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const select = mockSelector({ selections: [{ sourceId: "missing", supportExcerpt: "Invented", assetIds: [] }], rationale: "Invalid fixture." });
    select.mockResolvedValueOnce({ result: { selections: [{ sourceId: "missing", supportExcerpt: "Invented", assetIds: [] }], rationale: "Invalid fixture." } });
    select.mockResolvedValueOnce({ result: { selections: [{ sourceId: "trial", supportExcerpt: "Progression-free survival evidence from this trial.", assetIds: [] }], rationale: "Validated evidence." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "padcev", query: "Progression-free survival", candidates: [source("padcev", "trial")], fallbackSourceIds: [] });
    expect(result.mode).toBe("semantic");
    expect(result.chunks[0].id).toBe("trial");
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("preserves validated first-pass evidence when the separate context pass finds nothing", async () => {
    const excerpt = "Progression-free survival evidence from this trial.";
    const select = mockSelector({ selections: [], rationale: "No additional safety context is supported." });
    select.mockResolvedValueOnce({ result: { selections: [{ sourceId: "trial", supportExcerpt: excerpt, assetIds: [], evidenceRole: "contextual" }], rationale: "Initial evidence was labeled contextual." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: contextualPlan.interpretedQuestion, sourceQuestionPlan: contextualPlan, candidates: [source("nubeqa", "trial")], fallbackSourceIds: [] });
    expect(select).toHaveBeenCalledTimes(2);
    expect(select.mock.calls[1][0]).toMatchObject({ evidenceFocus: "contextual", query: "separate safety context" });
    expect(result.mode).toBe("semantic");
    expect(result.chunks).toEqual([expect.objectContaining({ id: "trial", text: excerpt, evidenceRole: "contextual" })]);
  });

  it("retains direct evidence ahead of older contextual passages within the three-source bound", async () => {
    const direct = "Progression-free survival evidence from this trial.";
    const context = "Separate safety context is also present in this document.";
    const select = mockSelector({ selections: [
      { sourceId: "new-context-1", supportExcerpt: context, assetIds: [], evidenceRole: "contextual" },
      { sourceId: "new-context-2", supportExcerpt: context, assetIds: [], evidenceRole: "contextual" },
    ], rationale: "Two exact contextual passages support the complementary question." });
    select.mockResolvedValueOnce({ result: { selections: [
      { sourceId: "old-context-1", supportExcerpt: context, assetIds: [], evidenceRole: "contextual" },
      { sourceId: "old-context-2", supportExcerpt: context, assetIds: [], evidenceRole: "contextual" },
      { sourceId: "direct", supportExcerpt: direct, assetIds: [], evidenceRole: "direct" },
    ], rationale: "The initial response placed its direct evidence last." } });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: contextualPlan.interpretedQuestion, sourceQuestionPlan: contextualPlan,
      candidates: ["old-context-1", "old-context-2", "direct", "new-context-1", "new-context-2"].map((id) => source("nubeqa", id)), fallbackSourceIds: [] });
    expect(select).toHaveBeenCalledTimes(2);
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["direct", "new-context-1", "new-context-2"]);
    expect(result.chunks.map((chunk) => chunk.text)).toEqual([direct, context, context]);
  });

  it("does not use inherited interaction tags when the fallback source text only discusses efficacy", async () => {
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue(null);
    const unrelated = { ...source("padcev", "efficacy"), tags: ["drug", "interactions", "DDI"] };
    const result = await selectFocusedSourceEvidence({ surveySlug: "padcev", query: "What approved evidence about DDI is available for PADCEV?", candidates: [unrelated], fallbackSourceIds: [unrelated.id] });
    expect(result.chunks).toEqual([]);
  });

  it("does not promote a high-priority unrelated chart when there is no relevant figure", async () => {
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue(null);
    const result = await selectFocusedSourceEvidence({ surveySlug: "padcev", query: "PADCEV administration", candidates: [source("padcev", "trial")], fallbackSourceIds: ["trial"] });
    expect(result.chunks[0].assets).toEqual([]);
    const reference = withExplicitSourceAssets({ citationId: "trial", title: "Trial evidence", description: null, url: "https://example.com/trial", assets: [] });
    expect(reference.assets).toEqual([expect.objectContaining({ assetKind: "LINK", url: "https://example.com/trial" })]);
  });

  it("makes the current PFS question own both answer evidence and assets despite previous DDI context", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DATABASE_URL", "");
    const trial = CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === "nubeqa-mcspc-aranote")!;
    expect(trial).toBeDefined();
    const selectModeratorEvidence = vi.fn().mockResolvedValue({ result: { selections: [{ sourceId: trial.id, assetIds: [], supportExcerpt: trial.text }], rationale: "ARANOTE answers the requested endpoint." } });
    const composeControlledRagAnswer = vi.fn().mockResolvedValue({ result: { answerBody: "ARANOTE assessed radiographic progression-free survival. [1]" } });
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue({ selectModeratorEvidence, composeControlledRagAnswer } as unknown as NonNullable<ReturnType<typeof modelGateway.getOptionalOpenAIGateway>>);
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: "Explain ARANOTE PFS", surveyContext: "Earlier topic: drug interactions", currentQuestion: "What about DDI?", selectedNextQuestion: "What do you think about interactions?", selectedQuestionSourceContext: "Drug interactions", recentInterviewerContext: "participant: Explain DDI\ninterviewer: CYP3A4 and BCRP interactions.", responseMode: "answer_only" });
    expect(selectModeratorEvidence.mock.calls[0][0].query).toBe("Explain ARANOTE PFS");
    expect(composeControlledRagAnswer.mock.calls[0][0]).toEqual(expect.objectContaining({ clinicalEvidenceCard: null, selectedQuestionSourceContext: null, sources: [expect.objectContaining({ title: trial.title })] }));
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${trial.id}`]);
    expect(result.references[0].assets).toEqual([expect.objectContaining({ assetKind: "LINK", url: trial.url })]);
  });

  it("does not present indexing tags or document descriptions as medical evidence to the composer", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DATABASE_URL", "");
    const source = CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === "brukinsa-safety-management")!;
    expect(source.tags).toContain("cyp3a");
    expect(source.text.toLowerCase()).not.toContain("cyp3a");
    const selectModeratorEvidence = vi.fn().mockResolvedValue({ result: { selections: [{ sourceId: source.id, supportExcerpt: source.text, assetIds: [] }], rationale: "Selected actual source text." } });
    const composeControlledRagAnswer = vi.fn().mockResolvedValue({ result: { answerBody: "The source describes medication-management considerations. [1]", usedSourceIndexes: [1] } });
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue({ selectModeratorEvidence, composeControlledRagAnswer } as unknown as NonNullable<ReturnType<typeof modelGateway.getOptionalOpenAIGateway>>);
    await askControlledRagForSurveyInterviewerTurn({ surveySlug: "brukinsa", participantMessage: "Which drug interactions are noted?", surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only" });
    expect(composeControlledRagAnswer.mock.calls[0][0].sources).toEqual([expect.objectContaining({ text: source.text, tags: [], description: null })]);
    expect(JSON.stringify(composeControlledRagAnswer.mock.calls[0][0].sources).toLowerCase()).not.toContain("cyp3a");
  });
});
