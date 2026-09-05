import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ModeratorEvidencePacket } from "@interview/schemas";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import { CONTROLLED_RAG_CHUNKS } from "./controlled-rag-source-packs";

const mocks = vi.hoisted(() => ({ query: vi.fn(), findMany: vi.fn(), select: vi.fn(), compose: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query, sourceChunk: { findMany: mocks.findMany } } }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ selectModeratorEvidence: mocks.select, composeControlledRagAnswer: mocks.compose }) }));

const packet: ModeratorEvidencePacket = { sources: [{
  id: "db:retained-padcev-interactions", surveySlug: "padcev", title: "PADCEV Order Set Resource",
  url: "https://www.padcevhcp.com/Content/hcp/pdf/PADCEV-Order-Set-Resource.pdf",
  description: "The source used in the previous interaction answer.",
  text: "The retained approved source excerpt about drug-interaction monitoring.",
  tags: ["drug interactions"], assets: [{
    title: "PADCEV Order Set Resource", url: "https://www.padcevhcp.com/Content/hcp/pdf/PADCEV-Order-Set-Resource.pdf",
    description: null, assetKind: "PDF", tags: ["drug interactions"], priority: 1,
  }],
}] };
const input = {
  surveySlug: "padcev" as const, participantMessage: "Can you explain that more simply?",
  surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
  responseMode: "answer_only" as const, sourceTopicContext: "What drug-drug interactions are described for PADCEV?",
  recentInterviewerContext: "interviewer: GENERATED ANSWER MUST NOT BECOME SOURCE EVIDENCE.", evidencePacket: packet,
};

describe("retained source evidence for clarification", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/unused");
    mocks.query.mockReset().mockResolvedValue([]); mocks.findMany.mockReset();
    mocks.select.mockReset().mockResolvedValue({ result: { selections: [], rationale: "No newly retrieved match." } });
    mocks.compose.mockReset().mockResolvedValue({ result: { answerBody: "The same interaction-monitoring information, stated more simply. [1]", usedSourceIndexes: [1] } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("explains the already shown PADCEV source without querying or selecting again", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn(input);
    expect(result.enabled).toBe(true);
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.compose).toHaveBeenCalledWith(expect.objectContaining({
      participantMessage: input.participantMessage,
      resolvedSourceQuestion: input.sourceTopicContext,
      clinicalEvidenceCard: null,
      sources: [expect.objectContaining({ text: packet.sources[0].text, url: packet.sources[0].url })],
    }));
    expect(JSON.stringify(mocks.compose.mock.calls[0][0].sources)).not.toContain("GENERATED ANSWER");
    expect(result.references[0]).toEqual(expect.objectContaining({ citationId: `rag:${packet.sources[0].id}`, assets: packet.sources[0].assets }));
    expect(result.evidencePacket).toEqual(packet);
  });

  it("ignores the retained interaction packet for an explicit new efficacy question", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({ ...input, participantMessage: "What does EV-302 show for progression-free survival?" });
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.compose).not.toHaveBeenCalled();
    expect(result.enabled).toBe(false);
    expect(result.references).toEqual([]);
  });

  it("rejects a retained packet from another brand", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({ ...input, surveySlug: "brukinsa" });
    expect(mocks.select).toHaveBeenCalledOnce();
    expect(mocks.compose).not.toHaveBeenCalled();
    expect(result.enabled).toBe(false);
  });

  it("returns only actually cited selected source excerpts in the reusable packet", async () => {
    const efficacy = CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === "nubeqa-mcspc-aranote")!;
    const ddi = CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === "nubeqa-ddi-profile")!;
    const excerpt = ddi.text.split(". ")[0] + ".";
    mocks.select.mockResolvedValue({ result: { selections: [
      { sourceId: efficacy.id, supportExcerpt: efficacy.text, assetIds: [] },
      { sourceId: ddi.id, supportExcerpt: excerpt, assetIds: [] },
    ], rationale: "Selected source excerpts." } });
    mocks.compose.mockResolvedValue({ result: { answerBody: "The interaction information. [2]", usedSourceIndexes: [2] } });
    const result = await askControlledRagForSurveyInterviewerTurn({ ...input, surveySlug: "nubeqa", participantMessage: "What are the drug-drug interactions?", evidencePacket: null });
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${ddi.id}`]);
    expect(result.evidencePacket?.sources).toEqual([{ ...ddi, text: excerpt, assets: [] }]);
    expect(result.answer).toContain("[1]");
  });
});
