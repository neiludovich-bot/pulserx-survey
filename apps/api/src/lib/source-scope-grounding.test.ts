import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../../../packages/schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../../../packages/prompts/src/index"));
vi.mock("@interview/engine", async () => import("../../../../packages/engine/src/index"));
const mocks = vi.hoisted(() => ({ gateway: null as unknown, query: vi.fn(), findMany: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => mocks.gateway }));
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query, sourceChunk: { findMany: mocks.findMany } } }));
import { OpenAIResponsesGateway } from "../../../../packages/engine/src/openai-workflows";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";

describe("reviewed answer scope and rendered references", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("keeps %s selected PFS scope through an adversarial expanded search and actual grounding repair", async (surveySlug) => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/unused");
    mocks.query.mockReset().mockResolvedValue([{ id: "trial-a" }, { id: "trial-b" }]);
    const sourceTexts = ["Trial A reports radiographic progression-free survival in population A.", "Trial B reports metastasis-free survival in population B."];
    mocks.findMany.mockReset().mockResolvedValue(sourceTexts.map((text, index) => ({ id: index === 0 ? "trial-a" : "trial-b", content: text, tags: [], sourceDocument: { title: `Synthetic trial ${index}`, description: "Synthetic fixture", url: `https://example.test/trial-${index}`, tags: [], assets: [] } })));
    const selectedQuestion = `What PFS evidence is available for ${surveySlug}?`;
    const plan = { version: 1, interpretedQuestion: `Compare PFS and MFS for ${surveySlug}.`, retrievalQueries: [`${surveySlug} progression free survival`, `${surveySlug} metastasis free survival`], answerApproach: "direct", usesSourceContext: false, contextBoundary: null, rationale: "Adversarial fixture expands the request to an unasked endpoint." };
    const fact = "Trial A reports rPFS in population A. [1]";
    const contrast = "Trial B reports MFS in population B. [2]";
    const violation = { excerpt: contrast, reason: "The actual selected request is PFS; the search interpretation cannot authorize an MFS comparison." };
    const parse = vi.fn()
      .mockResolvedValueOnce({ output_parsed: plan })
      .mockResolvedValueOnce({ output_parsed: { selections: sourceTexts.map((text, index) => ({ sourceId: index === 0 ? "db:trial-a" : "db:trial-b", supportExcerpt: text, assetIds: [], evidenceRole: "direct" })), rationale: "Adversarial selection includes an unrelated endpoint." } })
      .mockResolvedValueOnce({ output_parsed: { answerBody: `${fact} ${contrast}`, usedSourceIndexes: [1, 2], limitations: [] } })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: false, unsupportedClaims: [violation] } })
      .mockResolvedValueOnce({ output_parsed: { answerBody: fact, usedSourceIndexes: [1], limitations: [] } })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: true, unsupportedClaims: [] } });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug, participantMessage: selectedQuestion, currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, surveyContext: "Synthetic scope regression", responseMode: "answer_only" });
    expect(result.enabled).toBe(true);
    expect(result.answer).toBe(fact);
    expect(result.sourceQuestionPlan).toEqual(plan);
    expect(mocks.query.mock.calls.some(([query]) => JSON.stringify(query.values).includes("metastasis"))).toBe(true);
    expect(parse).toHaveBeenCalledTimes(6);
    const payload = (index: number) => JSON.parse(parse.mock.calls[index][0].input[0].content[0].text);
    expect(payload(1)).toMatchObject({ query: selectedQuestion, sourceQuestionPlan: plan });
    expect(payload(2)).toMatchObject({ resolvedSourceQuestion: selectedQuestion, sourceQuestionPlan: plan });
    expect(payload(3).answerScope).toMatchObject({ resolvedSourceQuestion: selectedQuestion, currentParticipantRequest: selectedQuestion, sourceQuestionPlan: plan });
    expect(payload(4).groundingViolations).toEqual([violation]);
    expect(payload(3).sources).toEqual(sourceTexts.map((text, index) => ({ index: index + 1, text })));
    expect(result.references.map((reference) => reference.citationId)).toEqual(["rag:db:trial-a"]);
  });
  it("repairs an unsolicited MFS comparison and removes its unused source and chart", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const fact = "Trial A reports rPFS in population A. [1]";
    const contrast = "Trial B reports MFS in population B. [2]";
    const initial = { practicalAnswer: `${fact} ${contrast}`, usedSourceIndexes: [1, 2], qualification: null };
    const repaired = { practicalAnswer: fact, usedSourceIndexes: [1], qualification: null };
    const violation = { excerpt: contrast, reason: "The MFS/population contrast is outside the selected PFS information need." };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: initial })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: false, unsupportedClaims: [violation] } })
      .mockResolvedValueOnce({ output_parsed: repaired })
      .mockResolvedValueOnce({ output_parsed: { version: 1, supported: true, unsupportedClaims: [] } });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const sources = [
      { id: "trial-a", title: "Trial A rPFS", text: "Trial A reports radiographic progression-free survival in population A." },
      { id: "trial-b", title: "Trial B MFS", text: "Trial B reports metastasis-free survival in population B." },
    ].map((source, index) => ({ ...source, surveySlug: "nubeqa" as const, url: `https://example.test/${source.id}`, description: "Synthetic fixture", tags: [], evidenceRole: index === 0 ? "direct" as const : "contextual" as const,
      assets: [{ title: source.title, url: `https://example.test/${source.id}.svg`, description: null, assetKind: "CHART", tags: [], priority: 1 }],
    }));
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: "Can you explain that?", sourceTopicContext: "What progression-free survival results are described?", evidencePacket: { sources }, currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, surveyContext: "SYNTHETIC scope regression", responseMode: "answer_only" });
    expect(result.enabled).toBe(true);
    expect(result.answer).toBe(fact);
    expect(result.references.map((reference) => reference.citationId)).toEqual(["rag:trial-a"]);
    expect(result.references[0].assets.map((asset) => asset.url)).toEqual(["https://example.test/trial-a.svg"]);
    expect(JSON.stringify(result.references)).not.toContain("trial-b");
    expect(result.evidencePacket?.sources.map((source) => source.id)).toEqual(["trial-a"]);
    expect(result.sourceAnswerGrounding?.attempt).toBe(2);
    expect(parse).toHaveBeenCalledTimes(4);
    const review = JSON.parse(parse.mock.calls[1][0].input[0].content[0].text);
    const repair = JSON.parse(parse.mock.calls[2][0].input[0].content[0].text);
    expect(review.answerScope).toMatchObject({ version: 1, resolvedSourceQuestion: "What progression-free survival results are described?", currentParticipantRequest: "Can you explain that?" });
    expect(review.sources).toEqual(sources.map((source, index) => ({ index: index + 1, text: source.text })));
    expect(repair.groundingViolations).toEqual([violation]);
    expect(repair.previousDraft.practicalAnswer).toBe(initial.practicalAnswer);
  });
});
