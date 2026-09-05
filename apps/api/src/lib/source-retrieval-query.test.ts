import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sourceContentSearchSql, sourceContentSearchTerms } from "./source-retrieval-query";
import { controlledRagTestInternals } from "./controlled-rag-service";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import * as modelGateway from "./model-gateway";

const mocks = vi.hoisted(() => ({ query: vi.fn(), findMany: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query, sourceChunk: { findMany: mocks.findMany } } }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: vi.fn(() => null) }));
const input = { surveySlug: "brukinsa" as const, participantMessage: "What approved evidence about DDI (drug-drug interactions) is available for BRUKINSA?", surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only" as const };

describe("source library content retrieval", () => {
  beforeEach(() => { vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/unused"); mocks.query.mockReset(); mocks.findMany.mockReset(); vi.mocked(modelGateway.getOptionalOpenAIGateway).mockReturnValue(null); });
  afterEach(() => vi.unstubAllEnvs());

  it("uses the supplied abbreviation expansion and excludes retrieval scaffolding", () => {
    expect(sourceContentSearchTerms(input.participantMessage, "brukinsa")).toEqual(["drug", "interactions"]);
    expect(sourceContentSearchTerms("What approved evidence is available for BRUKINSA?", "brukinsa")).toEqual([]);
  });

  it.each(["noted", "described", "listed", "mentioned", "reported"])("keeps direct '%s' questions and expanded planned questions on the same content search", (verb) => {
    const direct = sourceContentSearchSql(`Which drug interactions are ${verb}?`, "padcev")!;
    const planned = sourceContentSearchSql("What drug-drug interactions (DDI) are described for PADCEV?", "padcev")!;
    expect(direct.values).toEqual(planned.values);
    expect(direct.values).toEqual(["drug OR interactions", "drug interactions", "padcev", "padcev"]);
  });

  it("parameterizes content search and ranks matches before the 80-row bound", () => {
    const query = sourceContentSearchSql(input.participantMessage, "brukinsa")!;
    expect(query.values).toEqual(["drug OR interactions", "drug interactions", "brukinsa", "brukinsa"]);
    expect(query.sql).toContain("to_tsvector('english', chunk.content) @@ search.any_terms");
    expect(query.sql.indexOf("ts_rank_cd")).toBeLessThan(query.sql.indexOf("LIMIT 80"));
    expect(query.sql).not.toContain("document.tags");
    expect(query.sql).not.toContain("document.title");
    expect(sourceContentSearchSql("What evidence is available?", "brukinsa")).toBeNull();
  });

  it("hydrates a relevant late section selected from the full corpus instead of taking the first document pages", async () => {
    mocks.query.mockResolvedValue([{ id: "pi-section-120" }]);
    mocks.findMany.mockResolvedValue([{ id: "pi-section-120", content: "Drug interaction information in the selected prescribing-information section.", tags: [], sourceDocument: { title: "Prescribing information", description: null, url: null, tags: ["efficacy"], assets: [] } }]);
    const chunks = await controlledRagTestInternals.databaseChunks(input);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["pi-section-120"] }, surveySlug: "brukinsa", sourceDocument: { status: "ACTIVE" } }), take: 80 }));
    expect(chunks.map((chunk) => chunk.id)).toEqual(["db:pi-section-120"]);
    expect(chunks[0].text).toContain("Drug interaction information");
  });

  it("preserves content-ranked library IDs when narrowing the combined candidate list", async () => {
    const ids = Array.from({ length: 30 }, (_value, index) => `section-${index}`);
    mocks.query.mockResolvedValue(ids.map((id) => ({ id })));
    mocks.findMany.mockResolvedValue([...ids].reverse().map((id) => ({ id, content: "Content-ranked source passage.", tags: id === "section-0" ? [] : ["drug", "interactions"], sourceDocument: { title: "Document", description: null, url: "https://example.com/document", tags: [], assets: [] } })));
    const chunks = await controlledRagTestInternals.retrieveChunks(input);
    expect(chunks[0].id).toBe("db:section-0");
    expect(chunks.filter((chunk) => chunk.id.startsWith("db:")).map((chunk) => chunk.id).sort()).toEqual(ids.slice(0, 19).map((id) => `db:${id}`).sort());
  });

  it("does not load unrelated first pages when the content query has no matches", async () => {
    mocks.query.mockResolvedValue([]);
    expect(await controlledRagTestInternals.databaseChunks(input)).toEqual([]);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("presents the content-ranked passage first to the semantic selector despite broader PI metadata", async () => {
    mocks.query.mockResolvedValue([{ id: "direct-passage" }, { id: "pi-introduction" }]);
    mocks.findMany.mockResolvedValue([
      { id: "pi-introduction", content: "Introductory indication information.", tags: ["drug", "interactions"], sourceDocument: { title: "Full Prescribing Information", description: "Drug interactions and all label topics", url: "https://example.com/pi", tags: ["drug interactions"], assets: [] } },
      { id: "direct-passage", content: "The source passage specifically discusses drug interactions.", tags: [], sourceDocument: { title: "Clinical resource", description: null, url: "https://example.com/resource", tags: [], assets: [] } },
    ]);
    const select = vi.fn().mockResolvedValue({ result: { selections: [], rationale: "Observe candidates without composing." } });
    vi.mocked(modelGateway.getOptionalOpenAIGateway).mockReturnValue({ selectModeratorEvidence: select } as unknown as NonNullable<ReturnType<typeof modelGateway.getOptionalOpenAIGateway>>);
    await askControlledRagForSurveyInterviewerTurn({ ...input, participantMessage: "Which drug interactions are noted?" });
    const candidates = select.mock.calls[0][0].candidates;
    expect(candidates[0].id).toBe("db:direct-passage");
    expect(candidates.some((candidate: { id: string }) => candidate.id === "brukinsa-safety-management")).toBe(true);
  });
});
