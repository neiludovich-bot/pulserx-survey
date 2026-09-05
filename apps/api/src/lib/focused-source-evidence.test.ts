import { afterEach, describe, expect, it, vi } from "vitest";
import * as modelGateway from "./model-gateway";
import { alignCitedSourceReferences, selectFocusedSourceEvidence, withExplicitSourceAssets } from "./focused-source-evidence";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import { CONTROLLED_RAG_CHUNKS, type ControlledRagChunk } from "./controlled-rag-source-packs";

function mockSelector(result: unknown) {
  const selectModeratorEvidence = vi.fn().mockResolvedValue({ result });
  vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue({ selectModeratorEvidence } as unknown as NonNullable<ReturnType<typeof modelGateway.getOptionalOpenAIGateway>>);
  return selectModeratorEvidence;
}

function source(surveySlug: ControlledRagChunk["surveySlug"], id: string): ControlledRagChunk {
  return { surveySlug, id, title: "Trial evidence", description: "Approved trial evidence", url: `https://example.com/${id}`, text: "Progression-free survival evidence from this trial.", tags: ["efficacy"], assets: [{
    title: "Progression-free survival curve", description: "Trial endpoint", url: `https://example.com/${id}.png`, assetKind: "CHART", tags: ["pfs"], priority: 1,
  }, {
    title: "Adverse reactions", description: "Other outcome", url: `https://example.com/${id}-safety.png`, assetKind: "CHART", tags: ["safety"], priority: 100,
  }] };
}

describe("focused evidence selection", () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("removes uncited sources and renumbers markers without changing source ownership", () => {
    const references = ["unused", "used"].map((id) => ({ citationId: id, title: id, url: `https://example.com/${id}`, description: null, assets: [] }));
    expect(alignCitedSourceReferences("The rate was 70.3%. [2]", references)).toEqual({ answer: "The rate was 70.3%. [1]", references: [references[1]] });
    expect(() => alignCitedSourceReferences("Unsupported. [3]", references)).toThrow();
  });

  it("uses the next selected source question for legacy answer-then-ask rather than the previous reaction", async () => {
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue(null);
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: "I would be concerned about CYP3A4 inducers.", surveyContext: "NUBEQA", currentQuestion: "What do you think of DDI?", selectedNextQuestion: "What access and patient support resources do you need?", selectedQuestionSourceContext: "NUBEQA patient access and support resources", responseMode: "answer_then_ask" });
    expect(result.references.map((reference) => reference.citationId)).toEqual(["rag:nubeqa-guidelines-resources"]);
    expect(result.answer).not.toContain("CYP3A4");
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)("uses the typed semantic selection and only selected own assets for %s", async (surveySlug) => {
    const select = mockSelector({ selections: [{ sourceId: "trial", assetIds: ["trial:asset:0"] }], rationale: "The curve supports the selected endpoint." });
    const result = await selectFocusedSourceEvidence({ surveySlug, query: "How long did participants remain without progression?", candidates: [source(surveySlug, "safety"), source(surveySlug, "trial")], fallbackSourceIds: ["safety"] });
    expect(result.mode).toBe("semantic");
    expect(result.chunks.map((chunk) => chunk.id)).toEqual(["trial"]);
    expect(result.chunks[0].assets?.map((asset) => asset.url)).toEqual(["https://example.com/trial.png"]);
    expect(select.mock.calls[0][0].query).toBe("How long did participants remain without progression?");
  });

  it("rejects a source borrowing another source's asset even if the model returns it", async () => {
    mockSelector({ selections: [{ sourceId: "trial", assetIds: ["safety:asset:0"] }], rationale: "Invalid ownership fixture." });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "PFS", candidates: [source("nubeqa", "trial"), source("nubeqa", "safety")], fallbackSourceIds: ["trial"] });
    expect(result.mode).toBe("fallback");
    expect(result.chunks[0].assets?.map((asset) => asset.url)).toEqual(["https://example.com/trial.png"]);
  });

  it("preserves an explicit unsupported selection rather than silently substituting another trial", async () => {
    mockSelector({ selections: [], rationale: "None of these sources supports the requested population." });
    const result = await selectFocusedSourceEvidence({ surveySlug: "nubeqa", query: "A different trial population", candidates: [source("nubeqa", "trial")], fallbackSourceIds: ["trial"] });
    expect(result).toEqual({ mode: "semantic", chunks: [] });
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
    const selectModeratorEvidence = vi.fn().mockResolvedValue({ result: { selections: [{ sourceId: trial.id, assetIds: [] }], rationale: "ARANOTE answers the requested endpoint." } });
    const composeControlledRagAnswer = vi.fn().mockResolvedValue({ result: { answerBody: "ARANOTE assessed radiographic progression-free survival. [1]" } });
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue({ selectModeratorEvidence, composeControlledRagAnswer } as unknown as NonNullable<ReturnType<typeof modelGateway.getOptionalOpenAIGateway>>);
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: "Explain ARANOTE PFS", surveyContext: "Earlier topic: drug interactions", currentQuestion: "What about DDI?", selectedNextQuestion: "What do you think about interactions?", selectedQuestionSourceContext: "Drug interactions", recentInterviewerContext: "participant: Explain DDI\ninterviewer: CYP3A4 and BCRP interactions.", responseMode: "answer_only" });
    expect(selectModeratorEvidence.mock.calls[0][0].query).toBe("Explain ARANOTE PFS");
    expect(composeControlledRagAnswer.mock.calls[0][0]).toEqual(expect.objectContaining({ clinicalEvidenceCard: null, selectedQuestionSourceContext: null, sources: [expect.objectContaining({ title: trial.title })] }));
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${trial.id}`]);
    expect(result.references[0].assets).toEqual([expect.objectContaining({ assetKind: "LINK", url: trial.url })]);
  });
});
