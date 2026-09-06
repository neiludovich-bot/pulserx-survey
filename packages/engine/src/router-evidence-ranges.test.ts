import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { mvpTurnRouteAnalysisIndexedModelResultSchema, mvpTurnRouteAnalysisResultSchema, mvpTurnRouteModelSchemaForSurvey, type MvpTurnRouteAnalysisInput } from "../../schemas/src/index";
import { zodTextFormat } from "openai/helpers/zod";
import { evidenceFromTokenRange, participantTokensForModel } from "./evidence-ranges";
import { OpenAIResponsesGateway } from "./openai-workflows";
import { z } from "zod";

const input: MvpTurnRouteAnalysisInput = {
  surveySlug: "nubeqa", sourceBrand: "NUBEQA", activeIntentSlug: null, activeIntentLabel: null, activeIntentSteeringRule: null,
  currentQuestionId: "familiarity", currentQuestion: "How familiar are you?", currentQuestionObjective: "Capture familiarity", currentQuestionKeywords: [], currentQuestionCompletionSignals: [], sourceConversationActive: false,
  participantMessage: "Not very familiar with it.", recentInterviewerContext: "participant: I regularly use it. (earlier message)", candidateQuestions: [{ id: "factors", question: "What matters most?", objective: "Priorities", module: "Baseline", allowedByIntent: true, alreadyAsked: false, routeKeywords: [], sourceContextRequirement: null }],
};
const output = { schemaVersion: 6, sourceRequest: null, answerStatus: "answered", asksSourceQuestion: false, answerEvidenceRanges: [{ startToken: 0, endToken: 4 }], kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false, suggestedQuestionIds: ["factors"], sourceDirective: null, rationale: "Explicit low familiarity.", understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidenceRanges: [{ startToken: 0, endToken: 4 }] } };
const gateway = (parse: ReturnType<typeof vi.fn>) => new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });

describe("indexed participant evidence", () => {
  it.each(["nubeqa", "brukinsa", "padcev", "data"] as const)("restricts the actual structured output topic enum to %s without substituting another brand", async (surveySlug) => {
    const schema = mvpTurnRouteModelSchemaForSurvey(surveySlug);
    const parse = vi.fn().mockResolvedValue({ output_parsed: output });
    await gateway(parse).analyzeMvpTurnRoute({ ...input, surveySlug, repairContext: { version: 1, validationCategory: "wrong_survey_topic" } });
    const request = parse.mock.calls[0][0];
    expect(request.text.format.name).toBe(`mvp_turn_route_analysis_result_v6_${surveySlug}`);
    expect(JSON.parse(request.input[0].content[0].text).repairContext).toEqual({ version: 1, validationCategory: "wrong_survey_topic" });
    for (const topic of schema.shape.topic.unwrap().options) expect(topic === "unknown_in_domain" || topic.startsWith(`${surveySlug}_`)).toBe(true);
    const otherTopic = surveySlug === "nubeqa" ? "padcev_safety_management" : "nubeqa_safety_dosing";
    expect(schema.safeParse({ ...output, topic: otherTopic }).success).toBe(false);
    expect(schema.safeParse({ ...output, topic: null }).success).toBe(true);
    expect(schema.safeParse({ ...output, topic: "unknown_in_domain" }).success).toBe(true);
  });
  it("preserves original typography and internal whitespace without copying or normalizing text", () => {
    const message = "  I’m\t not  very\nfamiliar.\u00a0🙂 ";
    expect(participantTokensForModel(message)).toEqual([{ index: 0, text: "I’m" }, { index: 1, text: "not" }, { index: 2, text: "very" }, { index: 3, text: "familiar." }, { index: 4, text: "🙂" }]);
    expect(evidenceFromTokenRange(message, { startToken: 0, endToken: 3 })).toBe("I’m\t not  very\nfamiliar.");
    expect(evidenceFromTokenRange(message, { startToken: 4, endToken: 4 })).toBe("🙂");
  });
  it.each([{ startToken: 4, endToken: 1 }, { startToken: 0, endToken: 5 }, { startToken: -1, endToken: 2 }, { startToken: 0.5, endToken: 2 }])("rejects invalid ranges without guessing: %j", (range) => {
    expect(() => evidenceFromTokenRange(input.participantMessage, range)).toThrow();
  });
  it("reconstructs the low-familiarity statement and canonical durable version through the real gateway", async () => {
    const parse = vi.fn().mockResolvedValue({ output_parsed: output });
    const routed = await gateway(parse).analyzeMvpTurnRoute(input);
    expect(routed.result).toMatchObject({ schemaVersion: 5, answerEvidence: [input.participantMessage], understandingUpdate: { productFamiliarity: "low", participantEvidence: [input.participantMessage] } });
    expect(mvpTurnRouteAnalysisResultSchema.parse(routed.result)).toEqual(routed.result);
    const request = parse.mock.calls[0][0];
    expect(request.text.format.name).toBe("mvp_turn_route_analysis_result_v6_nubeqa");
    expect(JSON.parse(request.input[0].content[0].text).participantTokens).toEqual(participantTokensForModel(input.participantMessage));
    expect(request.instructions).not.toContain("Return schemaVersion 4");
  });
  it("reconstructs a separate mixed-turn request while leaving the model's resolved query separate", async () => {
    const message = "Not very familiar with it. Can you explain DDI";
    const parse = vi.fn().mockResolvedValue({ output_parsed: { ...output, asksSourceQuestion: true, needsSource: true, kind: "source_question", sourceRequest: { kind: "explanation_request", participantEvidenceRange: { startToken: 5, endToken: 8 }, resolvedQuestion: "What drug interactions are described for NUBEQA?" } } });
    const routed = await gateway(parse).analyzeMvpTurnRoute({ ...input, participantMessage: message });
    expect(routed.result.answerEvidence).toEqual(["Not very familiar with it."]);
    expect(routed.result.sourceRequest).toEqual({ kind: "explanation_request", participantEvidence: "Can you explain DDI", resolvedQuestion: "What drug interactions are described for NUBEQA?" });
  });
  it.each(["answer", "understanding", "request"])("fails closed for an out-of-message %s range", async (field) => {
    const invalid = { startToken: 60, endToken: 63 };
    const candidate = field === "answer" ? { ...output, answerEvidenceRanges: [invalid] } : field === "understanding" ? { ...output, understandingUpdate: { ...output.understandingUpdate, participantEvidenceRanges: [invalid] } } : { ...output, asksSourceQuestion: true, needsSource: true, sourceRequest: { kind: "question", participantEvidenceRange: invalid, resolvedQuestion: "What does it mean?" } };
    await expect(gateway(vi.fn().mockResolvedValue({ output_parsed: candidate })).analyzeMvpTurnRoute(input)).rejects.toThrow("token range");
  });
  it("requires strict range-only model evidence and every wire field", () => {
    const schema = zodTextFormat(mvpTurnRouteAnalysisIndexedModelResultSchema, "route_v6").schema;
    expect(schema.additionalProperties).toBe(false);
    const shape = z.object({ required: z.array(z.string()), properties: z.record(z.unknown()) }).parse(schema);
    expect([...shape.required].sort()).toEqual(Object.keys(shape.properties).sort());
    expect(schema.properties).not.toHaveProperty("answerEvidence");
    expect(mvpTurnRouteAnalysisIndexedModelResultSchema.safeParse({ ...output, answerEvidence: ["I don't know the product"] }).success).toBe(false);
  });
});
