import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { sourceRequestSchema, mvpTurnRouteAnalysisIndexedModelResultSchema, mvpTurnRouteAnalysisResultSchema, type MvpTurnRouteAnalysisInput } from "../../schemas/src/index";
import { zodTextFormat } from "openai/helpers/zod";
import { OpenAIResponsesGateway } from "./openai-workflows";

const reaction = "The efficacy results would be one part of my assessment; I would also weigh interaction concerns.";
const question = "So someone on those medications is at risk for what adverse reactions";
const input: MvpTurnRouteAnalysisInput = {
  surveySlug: "nubeqa", sourceBrand: "NUBEQA", activeIntentSlug: null, activeIntentLabel: null, activeIntentSteeringRule: null,
  currentQuestionId: "reaction", currentQuestion: "What about PFS would you most want clarified?", currentQuestionObjective: "Capture a reaction to the evidence.",
  currentQuestionKeywords: [], currentQuestionCompletionSignals: [], sourceConversationActive: true, participantMessage: reaction,
  recentInterviewerContext: "Interviewer: PFS evidence was presented.", candidateQuestions: [{ id: "ddi", question: "What about DDI?", objective: "Capture interaction reaction.", module: "Priorities", allowedByIntent: true, alreadyAsked: false, routeKeywords: [], sourceContextRequirement: null }],
};
const result = { schemaVersion: 5, sourceRequest: null, understandingUpdate: null, answerStatus: "answered", asksSourceQuestion: false, answerEvidence: [reaction], kind: "planned_answer", topic: null, needsSource: false, isOutOfScope: false, isUnanticipated: false, suggestedQuestionIds: ["ddi"], sourceDirective: null, rationale: "A substantive reaction mentioning the next priority, without an information request." };
const { answerEvidence: _answerEvidence, ...resultFields } = result;
const reactionTokenCount = reaction.split(/\s+/).length;
const wireResult = { ...resultFields, schemaVersion: 6, answerEvidenceRanges: [{ startToken: 0, endToken: reactionTokenCount - 1 }] };
const gateway = (output: unknown) => new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse: vi.fn().mockResolvedValue({ output_parsed: output }) });

describe("typed participant source requests", () => {
  it("requires a strict nullable speech-act record in new model output while preserving older application records", () => {
    const format = zodTextFormat(mvpTurnRouteAnalysisIndexedModelResultSchema, "route");
    expect(format.schema.required).toContain("sourceRequest");
    expect(mvpTurnRouteAnalysisIndexedModelResultSchema.safeParse({ ...wireResult, sourceRequest: undefined }).success).toBe(false);
    expect(mvpTurnRouteAnalysisResultSchema.safeParse({ ...result, schemaVersion: 4, sourceRequest: undefined }).success).toBe(true);
    expect(sourceRequestSchema.safeParse({ kind: "question", participantEvidence: question, resolvedQuestion: question, inferredConcern: true }).success).toBe(false);
  });

  it("retains a declarative reaction and rejects a positive source flag without an actual request record", async () => {
    expect((await gateway(wireResult).analyzeMvpTurnRoute(input)).result).toMatchObject({ asksSourceQuestion: false, sourceRequest: null, answerEvidence: [reaction] });
    await expect(gateway({ ...wireResult, asksSourceQuestion: true, needsSource: true }).analyzeMvpTurnRoute(input)).rejects.toThrow("source request");
  });

  it("retains exact mixed-turn reaction and embedded question without requiring punctuation", async () => {
    const sourceRequest = { kind: "question", participantEvidence: question, resolvedQuestion: "What adverse reactions are described for the interacting medications just discussed?" };
    const routed = await gateway({ ...wireResult, asksSourceQuestion: true, needsSource: true, kind: "source_question", sourceRequest: { kind: sourceRequest.kind, resolvedQuestion: sourceRequest.resolvedQuestion, participantEvidenceRange: { startToken: reactionTokenCount, endToken: reactionTokenCount + question.split(/\s+/).length - 1 } }, sourceDirective: "Answer the participant's follow-up." }).analyzeMvpTurnRoute({ ...input, participantMessage: `${reaction} ${question}` });
    expect(routed.result.sourceRequest).toEqual(sourceRequest);
    expect(routed.result.answerEvidence).toEqual([reaction]);
  });

  it("rejects an invented source question excerpt instead of fabricating a request from a concern", async () => {
    await expect(gateway({ ...wireResult, asksSourceQuestion: true, needsSource: true, sourceRequest: { kind: "question", participantEvidenceRange: { startToken: 50, endToken: 55 }, resolvedQuestion: "What are the interactions?" } }).analyzeMvpTurnRoute(input)).rejects.toThrow("token range");
  });
});
