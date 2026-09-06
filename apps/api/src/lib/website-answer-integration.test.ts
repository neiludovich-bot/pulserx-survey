import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../../../packages/schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../../../packages/prompts/src/index"));
vi.mock("@interview/engine", async () => import("../../../../packages/engine/src/index"));
const mocks = vi.hoisted(() => ({ gateway: null as unknown, query: vi.fn(), findMany: vi.fn() }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => mocks.gateway }));
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query, sourceChunk: { findMany: mocks.findMany } } }));
import { OpenAIResponsesGateway } from "../../../../packages/engine/src/openai-workflows";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";

const selection = (sourceId: string, contribution = "answer") => ({ sourceId, supportSpanRange: { startSpan: 0, endSpan: 0 }, assetIds: [], evidenceRole: "direct", contribution });
const base = { currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, surveyContext: "SYNTHETIC website controller regression", responseMode: "answer_only" as const };

describe("shared website answer through the real gateway", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("preserves %s authoritative PFS request, selected references and one-call budget", async surveySlug => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", "postgresql://fixture.invalid/unused");
    mocks.query.mockReset().mockResolvedValue([{ id: "trial-a" }, { id: "trial-b" }]);
    const texts = ["Trial A reports radiographic progression-free survival in population A.", "Trial B reports metastasis-free survival in population B."];
    mocks.findMany.mockReset().mockResolvedValue(texts.map((content, index) => ({ id: index ? "trial-b" : "trial-a", content, tags: [], sourceDocument: { title: `Trial ${index}`, description: "Synthetic fixture", url: `https://example.test/trial-${index}`, tags: [], assets: [] } })));
    const question = `What PFS evidence is available for ${surveySlug}?`;
    const plan = { version: 1 as const, interpretedQuestion: `Compare PFS and MFS for ${surveySlug}.`, retrievalQueries: ["progression free survival", "metastasis free survival"], answerApproach: "direct" as const, usesSourceContext: false, contextBoundary: null, rationale: "Adversarial search expansion cannot change the actual request." };
    const parse = vi.fn().mockResolvedValue({ output_parsed: { version: 1, selections: [selection("db:trial-a")], paragraphs: [{ text: texts[0], sourceIds: ["db:trial-a"] }], unavailableReason: null, rationale: "Selected requested endpoint." } });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const result = await askControlledRagForSurveyInterviewerTurn({ ...base, surveySlug, participantMessage: question, sourceQuestionPlan: plan });
    expect(parse).toHaveBeenCalledOnce();
    const payload = JSON.parse(parse.mock.calls[0][0].input[0].content[0].text);
    expect(payload).toMatchObject({ query: question, sourceQuestionPlan: plan });
    expect(payload.candidates.find((candidate: { id: string }) => candidate.id === "db:trial-a").spans).toEqual([{ index: 0, text: texts[0] }]);
    expect(result.answer).toBe(`${texts[0]} [1]`);
    expect(result.references.map(reference => reference.citationId)).toEqual(["rag:db:trial-a"]);
    expect(result.sourceAnswerGrounding).toBeNull();
    expect(result.sourceOutcome?.attempts.map(attempt => attempt.code)).toEqual(["source_linked"]);
  });

  it("simplifies the requested practical context without retrieving or returning the earlier mechanism", async () => {
    vi.stubEnv("NODE_ENV", "production");
    mocks.query.mockReset();
    mocks.findMany.mockReset();
    const source = (id: string, text: string, contribution: "answer" | "requested_context") => ({ id, text, contribution, surveySlug: "nubeqa" as const, title: id, url: `https://example.test/${id}`, description: "Synthetic fixture", tags: [], assets: [], evidenceRole: "direct" as const });
    const practical = "Monitor for symptoms of ischemic heart disease.";
    const sources = [source("mechanism", "Combined inhibitors increase exposure.", "answer"), source("monitoring", practical, "requested_context")];
    const parse = vi.fn().mockResolvedValue({ output_parsed: { version: 1, selections: [selection("monitoring", "requested_context")], paragraphs: [{ text: practical, sourceIds: ["monitoring"] }], unavailableReason: null, rationale: "Retain the practical angle." } });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const result = await askControlledRagForSurveyInterviewerTurn({ ...base, surveySlug: "nubeqa", participantMessage: "Can you explain that more simply?", sourceTopicContext: "What should I monitor in practical terms?", evidencePacket: { sources }, recentTurns: [{ role: "interviewer", content: "The general precautions include monitoring for symptoms of ischemic heart disease; this does not establish which events result from an interaction. [1]" }] });
    expect(parse).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
    const payload = JSON.parse(parse.mock.calls[0][0].input[0].content[0].text);
    expect(payload.candidates.map((candidate: { id: string }) => candidate.id)).toEqual(["monitoring"]);
    expect(payload.presentationContext.lastSourceAnswer).toContain("general precautions");
    expect(result.answer).toBe(`${practical} [1]`);
    expect(result.references.map(reference => reference.citationId)).toEqual(["rag:monitoring"]);
    expect(result.references[0].assets.every(asset => asset.assetKind === "LINK")).toBe(true);
  });
});
