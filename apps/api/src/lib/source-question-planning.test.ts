import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeratorEvidencePacket, SourceQuestionPlan } from "@interview/schemas";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";

const mocks = vi.hoisted(() => ({ plan: vi.fn(), query: vi.fn(), findMany: vi.fn(), select: vi.fn(), compose: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query, sourceChunk: { findMany: mocks.findMany } } }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({
  planSourceQuestion: mocks.plan, selectModeratorEvidence: mocks.select, composeControlledRagAnswer: mocks.compose,
}) }));

type SurveySlug = "nubeqa" | "brukinsa" | "padcev";
const screenshotQuestion = "how can it say adverse reactions should be monitored more frequently and not tell you want to monitor for?";
const generatedAnswer = "GENERATED PRIOR ANSWER IS CONVERSATION, NOT A SOURCE FACT.";
const recentTurns = [
  { role: "participant" as const, content: "What drug interactions should I consider?" },
  { role: "interviewer" as const, content: generatedAnswer },
];
const boundary = "General safety information supplies monitoring context; do not attribute these events to the interaction or infer interaction-specific incidence.";

function fixture(surveySlug: SurveySlug) {
  const ddi = {
    id: `db:${surveySlug}-ddi-fixture`, surveySlug, title: `${surveySlug} interaction source`,
    url: `https://example.test/${surveySlug}/interactions`, description: "Synthetic test source, not clinical guidance.",
    text: "Original interaction monitoring excerpt. Additional original safety facts omitted from the earlier excerpt.",
    tags: ["interaction", "monitoring"], assets: [],
  };
  const safety = {
    ...ddi, id: `db:${surveySlug}-safety-fixture`, title: `${surveySlug} general safety source`,
    url: `https://example.test/${surveySlug}/safety`,
    text: "Original general safety monitoring excerpt. This text does not establish interaction-specific causation.",
    tags: ["general", "safety", "monitoring"],
  };
  const packet: ModeratorEvidencePacket = { sources: [{ ...ddi, text: "Original interaction monitoring excerpt." }] };
  const plan: SourceQuestionPlan = {
    version: 1, interpretedQuestion: `What ${surveySlug} interaction and general safety information helps explain monitoring?`,
    retrievalQueries: [`${surveySlug} interaction monitoring`, `${surveySlug} general safety monitoring`],
    answerApproach: "contextual_explanation", usesSourceContext: true, contextBoundary: boundary,
    rationale: "Connect the monitoring instruction to separately identified general safety context.",
  };
  const input = {
    surveySlug, participantMessage: screenshotQuestion, surveyContext: "Synthetic source planning regression.",
    currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
    responseMode: "answer_only" as const, sourceTopicContext: `What drug interactions are documented for ${surveySlug}?`,
    recentTurns, recentInterviewerContext: `interviewer: ${generatedAnswer}`, evidencePacket: packet,
  };
  return { ddi, safety, packet, plan, input };
}

function databaseRows(chunks: ReturnType<typeof fixture>["ddi"][]) {
  return chunks.map((chunk) => ({
    id: chunk.id.replace(/^db:/, ""), content: chunk.text, tags: chunk.tags,
    sourceDocument: { title: chunk.title, description: chunk.description, url: chunk.url, tags: [], assets: [] },
  }));
}

function sqlValues() {
  return mocks.query.mock.calls.map(([sql]) => JSON.stringify(sql.values).toLowerCase());
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/unused");
  mocks.plan.mockReset(); mocks.query.mockReset(); mocks.findMany.mockReset(); mocks.select.mockReset(); mocks.compose.mockReset();
  mocks.compose.mockResolvedValue({ result: { answerBody: "The monitoring explanation is supported by the original interaction and safety sources. [1] [2]", usedSourceIndexes: [1, 2] } });
});
afterEach(() => vi.unstubAllEnvs());

describe.each(["nubeqa", "brukinsa", "padcev"] as const)("%s source question planning", (surveySlug) => {
  function setup() {
    const data = fixture(surveySlug);
    mocks.plan.mockResolvedValue({ result: data.plan });
    mocks.query.mockResolvedValue([{ id: data.ddi.id.slice(3) }, { id: data.safety.id.slice(3) }]);
    mocks.findMany.mockResolvedValue(databaseRows([data.ddi, data.safety]));
    mocks.select.mockResolvedValue({ result: { selections: [
      { sourceId: data.ddi.id, supportExcerpt: data.ddi.text, assetIds: [], evidenceRole: "direct" },
      { sourceId: data.safety.id, supportExcerpt: data.safety.text, assetIds: [], evidenceRole: "contextual" },
    ], rationale: "Use exact original interaction and general safety excerpts with an explicit causation boundary." } });
    return data;
  }

  it("plans the screenshot monitoring question with recent context and retrieves complementary original safety evidence", async () => {
    const { input, plan, ddi, safety } = setup();
    const result = await askControlledRagForSurveyInterviewerTurn(input);
    expect(mocks.plan).toHaveBeenCalledWith(expect.objectContaining({ participantMessage: screenshotQuestion, sourceTopicContext: input.sourceTopicContext, recentTurns }));
    expect(mocks.plan.mock.invocationCallOrder[0]).toBeLessThan(mocks.query.mock.invocationCallOrder[0]);
    expect(sqlValues().some((values) => /general/.test(values) && /safety/.test(values))).toBe(true);
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.select).toHaveBeenCalledWith(expect.objectContaining({ sourceQuestionPlan: plan, evidenceFocus: "all" }));
    expect(JSON.stringify(mocks.select.mock.calls[0][0].candidates)).not.toContain(generatedAnswer);
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({
      participantMessage: screenshotQuestion, sourceQuestionPlan: plan, recentTurns,
      clinicalEvidenceCard: null,
      sources: [expect.objectContaining({ text: ddi.text, evidenceRole: "direct" }), expect.objectContaining({ text: safety.text, evidenceRole: "contextual" })],
    }));
    expect(JSON.stringify(mocks.compose.mock.calls[0][0].sources)).not.toContain(generatedAnswer);
    expect(result.evidencePacket?.sources.map((source) => source.text)).toEqual([ddi.text, safety.text]);
    expect(result.evidencePacket?.sources.map((source) => source.evidenceRole)).toEqual(["direct", "contextual"]);
    expect(result.sourceQuestionPlan).toEqual(plan);
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${ddi.id}`, `rag:${safety.id}`]);
  });

  it("keeps the full newly retrieved source when its ID matches an older trimmed packet", async () => {
    const { input, ddi } = setup();
    await askControlledRagForSurveyInterviewerTurn(input);
    const candidates = mocks.select.mock.calls[0][0].candidates as Array<{ id: string; text: string }>;
    expect(candidates.filter((candidate) => candidate.id === ddi.id)).toEqual([expect.objectContaining({ text: ddi.text })]);
    expect(mocks.compose.mock.calls[0][0].sources[0].text).toContain("Additional original safety facts omitted");
  });

  it.each([
    { singleQuery: false, initialRole: "direct" },
    { singleQuery: true, initialRole: "direct" },
    { singleQuery: false, initialRole: "contextual" },
  ] as const)("recovers an actual general warning despite initial $initialRole label (single query=$singleQuery)", async ({ singleQuery, initialRole }) => {
    const { input, plan: initialPlan, ddi, safety } = setup();
    const plan = { ...initialPlan, retrievalQueries: singleQuery ? initialPlan.retrievalQueries.slice(0, 1) : initialPlan.retrievalQueries };
    mocks.plan.mockResolvedValue({ result: plan });
    const repeatedDdi = "Original interaction monitoring excerpt repeated in the broad source.";
    const broadSource = { ...safety, text: `${repeatedDdi} ${safety.text}` };
    mocks.findMany.mockResolvedValue(databaseRows([ddi, broadSource]));
    mocks.select.mockReset()
      .mockResolvedValueOnce({ result: { selections: [
        { sourceId: ddi.id, supportExcerpt: ddi.text, assetIds: [], evidenceRole: "direct" },
        { sourceId: safety.id, supportExcerpt: repeatedDdi, assetIds: [], evidenceRole: initialRole },
      ], rationale: "Both first-pass excerpts describe only the interaction instruction." } })
      .mockResolvedValueOnce({ result: { selections: [
        { sourceId: safety.id, supportExcerpt: safety.text, assetIds: [], evidenceRole: "contextual" },
      ], rationale: "This different exact passage supplies the missing general safety context." } });
    const result = await askControlledRagForSurveyInterviewerTurn(input);
    expect(mocks.select).toHaveBeenCalledTimes(2);
    const first = mocks.select.mock.calls[0][0];
    const recovery = mocks.select.mock.calls[1][0];
    expect(recovery).toMatchObject({ evidenceFocus: "contextual", query: input.participantMessage, sourceQuestionPlan: plan });
    expect(recovery.candidates).toEqual(first.candidates);
    expect(recovery.candidates.find((candidate: { id: string }) => candidate.id === safety.id).text).toBe(broadSource.text);
    const composedSources = mocks.compose.mock.calls[0][0].sources;
    expect(composedSources).toHaveLength(2);
    expect(composedSources).toEqual([
      expect.objectContaining({ text: ddi.text, evidenceRole: "direct" }),
      expect.objectContaining({ text: safety.text, evidenceRole: "contextual" }),
    ]);
    expect(JSON.stringify(composedSources)).not.toContain(repeatedDdi);
    expect(JSON.stringify(composedSources)).not.toContain(generatedAnswer);
    expect(result.evidencePacket?.sources.map(({ id, text, evidenceRole }) => ({ id, text, evidenceRole }))).toEqual([
      { id: ddi.id, text: ddi.text, evidenceRole: "direct" },
      { id: safety.id, text: safety.text, evidenceRole: "contextual" },
    ]);
    expect(new Set(result.references.map((reference) => reference.citationId)).size).toBe(2);
  });

  it("does not broaden a direct causal question into general safety context", async () => {
    const { input, ddi } = setup();
    const question = "Which adverse reactions are proven to be caused specifically by that interaction?";
    const direct: SourceQuestionPlan = {
      version: 1, interpretedQuestion: question, retrievalQueries: [`${surveySlug} interaction specific adverse reaction causation`],
      answerApproach: "direct", usesSourceContext: true, contextBoundary: "Do not substitute general adverse reactions for interaction-specific causation.", rationale: "The participant asks only for causal evidence.",
    };
    mocks.plan.mockResolvedValue({ result: direct });
    mocks.select.mockResolvedValue({ result: { selections: [{ sourceId: ddi.id, supportExcerpt: ddi.text, assetIds: [] }], rationale: "Only the original interaction source addresses the causal boundary." } });
    mocks.compose.mockResolvedValue({ result: { answerBody: "The interaction source does not establish specific causal adverse reactions. [1]", usedSourceIndexes: [1] } });
    await askControlledRagForSurveyInterviewerTurn({ ...input, participantMessage: question });
    expect(sqlValues()).toHaveLength(1);
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(sqlValues()[0]).not.toContain("general");
    expect(mocks.compose.mock.calls[0][0].sourceQuestionPlan).toEqual(direct);
    expect(mocks.compose.mock.calls[0][0].sources).toHaveLength(1);
  });

  it("does not carry the previous packet into an independent trial question", async () => {
    const { input, packet } = setup();
    const question = "What were the progression-free survival results in the named trial?";
    mocks.plan.mockResolvedValue({ result: {
      version: 1, interpretedQuestion: question, retrievalQueries: [`${surveySlug} trial progression free survival`],
      answerApproach: "direct", usesSourceContext: false, contextBoundary: null, rationale: "An independent trial evidence request.",
    } });
    mocks.query.mockResolvedValue([]);
    mocks.select.mockResolvedValue({ result: { selections: [], rationale: "No matching synthetic trial source." } });
    await askControlledRagForSurveyInterviewerTurn({ ...input, participantMessage: question });
    const selection = mocks.select.mock.calls[0][0];
    expect(selection.sourceTopicContext).toBeNull();
    expect(selection.priorSourceIds).toEqual([]);
    expect(selection.candidates.some((candidate: { id: string }) => candidate.id === packet.sources[0].id)).toBe(false);
    expect(mocks.compose).not.toHaveBeenCalled();
  });

  it.each(["invalid", "missing"])("retains the original query when the planner result is %s", async (failure) => {
    const { input } = setup();
    const question = "What original question terms reach retrieval?";
    mocks.plan.mockResolvedValue(failure === "invalid"
      ? { result: { version: 1, interpretedQuestion: "UNTRUSTED PLANNER QUERY", retrievalQueries: ["UNTRUSTED PLANNER QUERY"], answerApproach: "not-a-valid-approach", usesSourceContext: false, contextBoundary: null, rationale: "Invalid output." } }
      : {});
    mocks.query.mockResolvedValue([]);
    mocks.select.mockResolvedValue({ result: { selections: [], rationale: "No synthetic source." } });
    await askControlledRagForSurveyInterviewerTurn({ ...input, participantMessage: question, evidencePacket: null });
    expect(sqlValues()).toHaveLength(1);
    expect(sqlValues()[0]).toContain("original");
    expect(sqlValues()[0]).not.toContain("untrusted");
    expect(mocks.select.mock.calls[0][0].query).toBe(question);
  });

  it("rephrases a retained pure clarification without planning or retrieving again", async () => {
    const { input, packet } = setup();
    mocks.compose.mockResolvedValue({ result: { answerBody: "The same monitoring excerpt, explained more simply. [1]", usedSourceIndexes: [1] } });
    const result = await askControlledRagForSurveyInterviewerTurn({ ...input, participantMessage: "Can you explain that more simply?" });
    expect(mocks.plan).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(result.evidencePacket).toEqual(packet);
    expect(mocks.compose.mock.calls[0][0].sources[0].text).toBe(packet.sources[0].text);
  });
});
