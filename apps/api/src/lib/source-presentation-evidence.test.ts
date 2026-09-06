import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import { CONTROLLED_RAG_CHUNKS, NUBEQA_DDI_FACTS } from "./controlled-rag-source-packs";

const mocks = vi.hoisted(() => ({ query: vi.fn(), findMany: vi.fn(), select: vi.fn(), compose: vi.fn(), plan: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query, sourceChunk: { findMany: mocks.findMany } } }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ selectModeratorEvidence: mocks.select, composeControlledRagAnswer: mocks.compose, planSourceQuestion: mocks.plan }) }));

describe("presentation evidence focus", () => {
  beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); Object.values(mocks).forEach((mock) => mock.mockReset()); });
  afterEach(() => vi.unstubAllEnvs());

  it.each([false, true])("focuses simplification on requested practical context while retaining all raw evidence (repeated=%s)", async (repeated) => {
    const sources = ["nubeqa-ddi-profile", "nubeqa-safety-dosing"].map((id, index) => {
      const source = CONTROLLED_RAG_CHUNKS.find((candidate) => candidate.id === id)!;
      return { ...source, assets: source.assets ?? [], evidenceRole: index === 0 ? "direct" as const : "contextual" as const, contribution: index === 0 ? "answer" as const : "requested_context" as const };
    });
    const fact = "General safety guidance includes monitoring ischemic heart disease symptoms and managing cardiovascular risk factors, including hypertension, diabetes, and dyslipidemia; discontinue NUBEQA for Grade 3-4 ischemic heart disease.";
    expect(sources[1].text).toContain(fact);
    mocks.select.mockResolvedValue({ result: { selections: [{ sourceId: sources[1].id, supportExcerpt: fact, assetIds: [], evidenceRole: "contextual", contribution: "answer" }], rationale: "Preserve one complete practical point, rather than repeating the interaction mechanism." } });
    mocks.compose.mockResolvedValue({ result: { answerBody: `${fact} [1]`, usedSourceIndexes: [1], limitations: [] } });
    const lastSourceAnswer = "The prior answer explained interaction exposure and practical monitoring. [1] [2]";
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: repeated ? "Even more simply please." : "Can you explain that more simply?", sourceTopicContext: "What does that mean for what to monitor in practical terms?", evidencePacket: { sources }, recentTurns: [{ role: "interviewer", content: lastSourceAnswer }], surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only" });
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.select.mock.calls[0][0]).toMatchObject({ presentationPlan: { maxFacts: repeated ? 1 : 2 }, presentationContext: { kind: "simplify_previous_answer", lastSourceAnswer } });
    expect(mocks.select.mock.calls[0][0].candidates.map((source: { id: string }) => source.id)).toEqual([sources[1].id]);
    expect(mocks.compose.mock.calls[0][0].sources).toEqual([expect.objectContaining({ text: fact, contribution: "requested_context" })]);
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${sources[1].id}`]);
    expect(result.evidencePacket).toEqual({ sources });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it.each(["supported", "empty", "invented"] as const)("carries the actual dcc2d80 monitoring explanation as presentation context only (%s selector)", async (selectionCase) => {
    // Actual last successful answer from the saved production replay. It mixes
    // two interaction cases and general monitoring; it is context, not evidence.
    const lastSourceAnswer = "Simply put, watch the drug whose exposure changes: with combined P-gp and strong CYP3A4 inhibitors, monitor NUBEQA adverse reactions more often; with BCRP or OATP1B1/OATP1B3 substrates, monitor adverse reactions from the other drug.[1] Separately, general NUBEQA safety guidance includes monitoring ischemic heart disease symptoms.[2]";
    const sourceTopicContext = "What does the interaction information mean for what to monitor in practical terms?";
    const sources = ["nubeqa-ddi-profile", "nubeqa-safety-dosing"].map((id, index) => {
      const source = CONTROLLED_RAG_CHUNKS.find((candidate) => candidate.id === id)!;
      return { ...source, assets: source.assets ?? [], evidenceRole: index === 0 ? "direct" as const : "contextual" as const };
    });
    const fact = NUBEQA_DDI_FACTS[0].split(". ")[1];
    expect(fact).toContain("Combined P-gp and strong CYP3A4 inhibitors");
    expect(sources[0].text).toContain(fact);
    mocks.select.mockResolvedValue({ result: { selections: selectionCase === "empty" ? [] : [{ sourceId: sources[0].id, supportExcerpt: selectionCase === "invented" ? "Monitor every NUBEQA patient weekly." : fact, assetIds: [], evidenceRole: "direct" }], rationale: "Presentation selection fixture." } });
    mocks.compose.mockResolvedValue({ result: { answerBody: `${fact} [1]`, usedSourceIndexes: [1], limitations: [] } });
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "nubeqa", participantMessage: "Even more simply please.", surveyContext: "SYNTHETIC regression", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
      responseMode: "answer_only", sourceTopicContext, evidencePacket: { sources },
      recentTurns: [{ role: "participant", content: "Can you explain that more simply?" }, { role: "interviewer", content: lastSourceAnswer }, { role: "participant", content: "Even more simply please." }],
    });
    const selectionInput = mocks.select.mock.calls[0][0];
    expect(selectionInput.query).toBe("Even more simply please.");
    expect(selectionInput.query).not.toBe(sourceTopicContext);
    expect(selectionInput.sourceTopicContext).toBe(sourceTopicContext);
    expect(selectionInput.presentationContext).toEqual({ version: 1, kind: "simplify_previous_answer", participantRequest: "Even more simply please.", lastSourceAnswer });
    expect(selectionInput.sourceQuestionPlan).toBeNull();
    expect(selectionInput.candidates.map((candidate: { text: string }) => candidate.text)).toEqual(sources.map((source) => source.text));
    expect(JSON.stringify(selectionInput.candidates)).not.toContain(lastSourceAnswer);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    if (selectionCase === "supported") {
      expect(result.enabled).toBe(true);
      expect(mocks.compose.mock.calls[0][0].sources).toEqual([expect.objectContaining({ text: fact })]);
      expect(result.evidencePacket).toEqual({ sources });
    } else {
      expect(result.enabled).toBe(false);
      expect(mocks.compose).not.toHaveBeenCalled();
      expect(result.references).toEqual([]);
    }
  });

  it.each([["nubeqa", "ARANOTE"], ["brukinsa", "SEQUOIA"], ["padcev", "EV-302"]] as const)("passes brief %s presentation scope upstream and renders only the selected efficacy source", async (surveySlug, study) => {
    mocks.query.mockResolvedValue([]);
    const source = CONTROLLED_RAG_CHUNKS.find((candidate) => candidate.surveySlug === surveySlug && candidate.title.includes(study))!;
    expect(source).toBeDefined();
    const presentationPlan = { version: 1 as const, purpose: "source_answer" as const, depth: "brief" as const, maxFacts: 3, maxTopics: 1, askReadiness: false };
    mocks.plan.mockResolvedValue({ result: { version: 1, interpretedQuestion: "What progression-free survival information is available?", retrievalQueries: ["progression-free survival"], usesSourceContext: false, answerApproach: "direct", contextBoundary: "Present the requested endpoint in its relevant setting.", rationale: "One introductory concept." } });
    mocks.select.mockResolvedValue({ result: { selections: [{ sourceId: source.id, supportExcerpt: source.text, assetIds: [], evidenceRole: "direct" }], rationale: "The requested endpoint only, without contrasting unrelated endpoints." } });
    mocks.compose.mockResolvedValue({ result: { answerBody: "The selected trial reports this endpoint in its stated population. [1]", usedSourceIndexes: [1], limitations: [] } });
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug, participantMessage: "PFS", surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only", presentationPlan });
    expect(result.enabled).toBe(true);
    expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ presentationPlan }));
    expect(mocks.select.mock.calls[0][0].presentationContext).toBeUndefined();
    expect(mocks.compose.mock.calls[0][0].sources).toEqual([expect.objectContaining({ title: source.title, text: source.text.slice(0, 1500) })]);
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${source.id}`]);
    expect(result.references[0].assets.every((asset) => asset.assetKind === "LINK")).toBe(true);
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)("narrows repeated %s simplification to one conditional fact while preserving the full raw packet", async (surveySlug) => {
    const fact = "When condition A applies, monitor outcome A.";
    const sources = [
      { id: "first", text: `${fact} When condition B applies, monitor outcome B.` },
      { id: "second", text: "Independent safety guidance describes outcome C." },
    ].map((source) => ({ ...source, surveySlug, title: source.id, url: `https://example.test/${source.id}`, description: "", tags: [], assets: [], evidenceRole: "direct" as const }));
    const packet = { sources };
    mocks.select.mockResolvedValue({ result: { selections: [{ sourceId: "first", supportExcerpt: fact, assetIds: [], evidenceRole: "direct" }], rationale: "One complete fact with its condition." } });
    mocks.compose.mockResolvedValue({ result: { answerBody: `${fact} [1]`, usedSourceIndexes: [1], limitations: [] } });
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug, participantMessage: "Even more simply please.", surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
      responseMode: "answer_only", sourceTopicContext: "What should I monitor under condition A or B?", evidencePacket: packet,
      recentTurns: [{ role: "participant", content: "Can you explain that more simply?" }, { role: "interviewer", content: "GENERATED PRIOR ANSWER IS NOT EVIDENCE. [1]" }],
    });
    expect(result.enabled).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ presentationPlan: expect.objectContaining({ maxFacts: 1, maxTopics: 1 }), candidates: expect.arrayContaining(sources.map((source) => expect.objectContaining({ id: source.id, text: source.text }))) }));
    expect(mocks.compose.mock.calls[0][0].sources).toEqual([expect.objectContaining({ text: fact })]);
    expect(JSON.stringify(mocks.compose.mock.calls[0][0].sources)).not.toContain("GENERATED PRIOR");
    expect(result.answer).toBe(`${fact} [1]`);
    expect(result.references.map((reference) => reference.citationId)).toEqual(["rag:first"]);
    expect(result.evidencePacket).toEqual(packet);
  });
});
