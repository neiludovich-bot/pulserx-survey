import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../../../packages/schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../../../packages/prompts/src/index"));
vi.mock("@interview/engine", async () => import("../../../../packages/engine/src/index"));
const mocks = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => mocks.gateway }));
vi.mock("./prisma", () => ({ prisma: {} }));
import { OpenAIResponsesGateway } from "../../../../packages/engine/src/openai-workflows";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import { CONTROLLED_RAG_CHUNKS } from "./controlled-rag-source-packs";

const sources = ["nubeqa-ddi-profile", "nubeqa-safety-dosing"].map((id, index) => {
  const source = CONTROLLED_RAG_CHUNKS.find((candidate) => candidate.id === id)!;
  return { ...source, assets: [], contribution: index === 0 ? "answer" as const : "requested_context" as const, evidenceRole: index === 0 ? "direct" as const : "contextual" as const };
});
const base = { surveySlug: "nubeqa" as const, participantMessage: "What does that mean?", sourceTopicContext: "What should I monitor in practical terms?", evidencePacket: { sources }, currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, surveyContext: "Synthetic requested-context regression", responseMode: "answer_only" as const };
const reviewed = { version: 1, supported: true, unsupportedClaims: [] };

describe("legacy selected requested context through the actual composer gateway", () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(["direct", "contextual"] as const)("repairs a %s draft that only repeats the original relationship before grounding review", async (mode) => {
    vi.stubEnv("NODE_ENV", "production");
    const body = "General guidance includes monitoring ischemic heart disease symptoms. [1]";
    const wrap = (text: string, indexes: number[]) => mode === "direct" ? { answerBody: text, usedSourceIndexes: indexes, limitations: [] } : { practicalAnswer: text, usedSourceIndexes: indexes, qualification: null };
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: wrap("The interacting medicine changes exposure. [2]", [2]) })
      .mockResolvedValueOnce({ output_parsed: wrap(body, [1]) }).mockResolvedValueOnce({ output_parsed: reviewed });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    // Exercise the retained reviewed-provider fallback explicitly.
    Object.defineProperty(mocks.gateway, "answerFromWebsite", { value: undefined });
    const result = await askControlledRagForSurveyInterviewerTurn({ ...base, evidencePacket: { sources: sources.map((source) => ({ ...source, evidenceRole: mode === "direct" ? "direct" : source.evidenceRole })) } });
    expect(result.enabled).toBe(true);
    expect(result.answer).toBe(body);
    expect(parse).toHaveBeenCalledTimes(3);
    const first = JSON.parse(parse.mock.calls[0][0].input[0].content[0].text);
    const repair = JSON.parse(parse.mock.calls[1][0].input[0].content[0].text);
    expect(first.sources[0]).toMatchObject({ contribution: "requested_context", text: sources[1].text });
    expect(repair.groundingViolations[0].reason).toContain("selected requested context");
    expect(result.sourceOutcome?.attempts.map((attempt) => attempt.code)).toEqual(["missing_contextual_citation", "composed", "supported"]);
    expect(result.sourceAnswerGrounding?.attempt).toBe(2);
  });
  it("does not satisfy the practical request by placing its citation only in a limitation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const omitted = { practicalAnswer: "The interacting medicine changes exposure. [2]", usedSourceIndexes: [2, 1], qualification: "General monitoring is separate. [1]" };
    const parse = vi.fn().mockResolvedValue({ output_parsed: omitted });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    // Exercise the retained reviewed-provider fallback explicitly.
    Object.defineProperty(mocks.gateway, "answerFromWebsite", { value: undefined });
    const result = await askControlledRagForSurveyInterviewerTurn(base);
    expect(parse).toHaveBeenCalledTimes(2);
    expect(result.enabled).toBe(true);
    expect(result.sourceOutcome).toMatchObject({ status: "extractive_recovery", recovery: { method: "verbatim_curated_source_card", sourceId: sources[1].id } });
    expect(result.sourceOutcome?.attempts.map((attempt) => attempt.code)).toEqual(["missing_contextual_citation", "missing_contextual_citation"]);
    expect(result.sourceAnswerGrounding).toBeNull();
    expect(result.answer).toContain(sources[1].text);
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${sources[1].id}`]);
  });
  it.each(["essential_qualification", undefined] as const)("does not require an extra contextual citation for contribution=%s", async (contribution) => {
    vi.stubEnv("NODE_ENV", "production");
    const parse = vi.fn().mockResolvedValueOnce({ output_parsed: { practicalAnswer: "The original relationship is described. [1]", usedSourceIndexes: [1], qualification: null } }).mockResolvedValueOnce({ output_parsed: reviewed });
    mocks.gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    // Exercise the retained reviewed-provider fallback explicitly.
    Object.defineProperty(mocks.gateway, "answerFromWebsite", { value: undefined });
    const result = await askControlledRagForSurveyInterviewerTurn({ ...base, evidencePacket: { sources: [sources[0], { ...sources[1], contribution }] } });
    expect(result.enabled).toBe(true);
    expect(result.sourceOutcome?.status).toBe("success");
    expect(parse).toHaveBeenCalledTimes(2);
    expect(result.references.map((reference) => reference.citationId)).toEqual([`rag:${sources[0].id}`]);
  });
});
