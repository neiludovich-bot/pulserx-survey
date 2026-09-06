import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import { CONTROLLED_RAG_CHUNKS } from "./controlled-rag-source-packs";

const mocks = vi.hoisted(() => ({ query: vi.fn(), findMany: vi.fn(), select: vi.fn(), compose: vi.fn(), plan: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query, sourceChunk: { findMany: mocks.findMany } } }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ selectModeratorEvidence: mocks.select, composeControlledRagAnswer: mocks.compose, planSourceQuestion: mocks.plan }) }));

describe("presentation evidence focus", () => {
  beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.clearAllMocks(); });
  afterEach(() => vi.unstubAllEnvs());

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
