import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../../../packages/schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../../../packages/prompts/src/index"));
vi.mock("@interview/engine", async () => import("../../../../packages/engine/src/index"));
const mocks = vi.hoisted(() => ({ gateway: null as unknown }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => mocks.gateway }));
import { OpenAIResponsesGateway } from "../../../../packages/engine/src/openai-workflows";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";

describe("reviewed answer scope and rendered references", () => {
  afterEach(() => vi.unstubAllEnvs());
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
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: "Can you explain that more simply?", sourceTopicContext: "What progression-free survival results are described?", evidencePacket: { sources }, currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, surveyContext: "SYNTHETIC scope regression", responseMode: "answer_only" });
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
    expect(review.answerScope).toMatchObject({ version: 1, resolvedSourceQuestion: "What progression-free survival results are described?", currentParticipantRequest: "Can you explain that more simply?" });
    expect(review.sources).toEqual(sources.map((source, index) => ({ index: index + 1, text: source.text })));
    expect(repair.groundingViolations).toEqual([violation]);
    expect(repair.previousDraft.practicalAnswer).toBe(initial.practicalAnswer);
  });
});
