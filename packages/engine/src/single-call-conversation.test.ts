import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { conversationInterpretationInputSchema, conversationInterpretationResultSchema, type ModeratorEvidenceSelectionInput } from "@interview/schemas";
import { OpenAIResponsesGateway } from "./openai-workflows";
import { participantTokensForModel } from "./evidence-ranges";

function fixture(surveySlug: "nubeqa" | "brukinsa" | "padcev") {
  const participantMessage = "What did Study A report?";
  const input = conversationInterpretationInputSchema.parse({ version: 1, surveySlug, sourceBrand: surveySlug.toUpperCase(),
    activeIntentSlug: null, activeIntentLabel: null, activeIntentSteeringRule: null,
    currentQuestionId: "factors", currentQuestion: "What matters most?", currentQuestionObjective: "Understand decision factors",
    participantMessage, participantTokens: participantTokensForModel(participantMessage), candidateQuestions: [{ id: "fit", question: "What matters for fit?", objective: "Understand fit", module: "Research", allowedByIntent: true, alreadyAsked: false }],
    state: { version: 1, runtime: "single_call_v1", priorities: [], activePriorityId: null }, isPriorityQuestion: true, isResumeCue: false });
  const interpretation = conversationInterpretationResultSchema.parse({ version: 1, answerStatus: "not_answered", answerEvidenceRanges: [],
    sourceRequest: { kind: "question", resolvedQuestion: participantMessage, participantEvidenceRange: { startToken: 0, endToken: input.participantTokens.length - 1 } },
    sourceQuestionPlan: { version: 1, interpretedQuestion: participantMessage, retrievalQueries: [participantMessage], usesSourceContext: false,
      answerApproach: "direct", contextBoundary: null, rationale: "Study result" },
    understandingUpdate: null, isOutOfScope: false, topic: null, suggestedQuestionIds: [], rationale: "Answer the request",
    reactionStatus: "not_answered", reactionTargetPriorityId: null, reactionEvidenceRanges: [], priorityMentions: [] });
  const evidence: ModeratorEvidenceSelectionInput = { surveySlug, query: participantMessage, sourceTopicContext: null, priorSourceIds: [], sourceQuestionPlan: null, evidenceFocus: "all",
    candidates: [{ id: "study", title: "Study A", url: "https://example.test/study", description: "Synthetic fixture", tags: [], assets: [], text: "Study A reported 12 months in population X." }] };
  const answer = { version: 1, selections: [{ sourceId: "study", supportSpanRange: { startSpan: 0, endSpan: 0 }, assetIds: [], evidenceRole: "direct", contribution: "answer" }],
    paragraphs: [{ text: evidence.candidates[0].text, sourceIds: ["study"] }], unavailableReason: null, rationale: "Study result" };
  const parse = vi.fn().mockResolvedValue({ id: "test-response", model: "gpt-5.4-mini", output_parsed: { interpretation, answer } });
  const gateway = new OpenAIResponsesGateway("test", { analysisModel: "gpt-5.4-mini", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
  const { version: _version, participantTokens: _tokens, ...request } = input;
  return { request, interpretation, answer, evidence, parse, gateway };
}

describe("single-call conversation boundary", () => {
  it("presents application-selected evidence without requiring a participant request", async () => {
    const f = fixture("nubeqa");
    f.parse.mockResolvedValue({ id: "presentation", output_parsed: f.answer });
    const result = await f.gateway.presentConversationEvidence({ ...f.evidence, query: "Efficacy" });
    expect(f.parse).toHaveBeenCalledOnce();
    expect(result.answer.paragraphs[0].text).toContain("12 months");
    expect(result.traces).toHaveLength(1);
  });
  it("repairs an unsupported number once without reinterpreting the respondent", async () => {
    const f = fixture("nubeqa");
    const observation = { answerStatus: "not_answered", answerEvidenceRanges: [], reactionEvidenceRanges: [], priorities: [], familiarity: null, familiarityEvidenceRange: null, outOfScope: false };
    const source = { request: { text: f.request.participantMessage, evidenceRange: { startToken: 0, endToken: 4 } }, answer: { ...f.answer, paragraphs: [{ text: "Study A reported 99 months.", sourceIds: ["study"] }] } };
    f.parse.mockResolvedValueOnce({ id: "initial", output_parsed: { observation, source } }).mockResolvedValueOnce({ id: "repair", output_parsed: f.answer });
    const result = await f.gateway.conversationTurn({ version: 2, brand: "nubeqa", participantMessage: f.request.participantMessage, question: null, discussionQuery: null, recentTurns: [], topics: [] }, f.evidence);
    expect(f.parse).toHaveBeenCalledTimes(2); expect(result.repairTrace?.response.id).toBe("repair");
    expect(JSON.parse(f.parse.mock.calls[1][0].input[0].content[0].text).repairDetail).toMatchObject({ unsupportedNumbers: ["99"] });
    expect(result.observation.answerEvidence).toEqual([]); expect(result.answer?.paragraphs[0].text).toContain("12 months");
  });
  it("represents familiarity without an unsolicited answer in the v2 source envelope", async () => {
    const f = fixture("nubeqa");
    f.parse.mockResolvedValue({ id: "v2", output_parsed: { observation: { answerStatus: "answered", answerEvidenceRanges: [{ startToken: 0, endToken: 4 }], reactionEvidenceRanges: [], priorities: [], familiarity: "low", familiarityEvidenceRange: { startToken: 0, endToken: 4 }, outOfScope: false }, source: null } });
    const result = await f.gateway.conversationTurn({ version: 2, brand: "nubeqa", participantMessage: "Not very familiar with it.", question: { id: "familiarity", text: "How familiar are you?", kind: "guide" }, discussionQuery: null, recentTurns: [], topics: [] }, f.evidence);
    expect(result.answer).toBeNull(); expect(result.observation.request).toBeNull(); expect(result.observation.familiarityEvidence).toBe("Not very familiar with it.");
  });
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("uses the v2 contract for a mixed %s response without legacy routing", async brand => {
    const f = fixture(brand);
    const message = "That sounds useful. What did Study A report?";
    f.parse.mockResolvedValue({ id: "v2", model: "gpt-5.4-mini", output_parsed: {
      observation: { answerStatus: "answered", answerEvidenceRanges: [{ startToken: 0, endToken: 2 }], reactionEvidenceRanges: [{ startToken: 0, endToken: 2 }], priorities: [], familiarity: null, familiarityEvidenceRange: null, outOfScope: false },
      source: { request: { text: "What did Study A report?", evidenceRange: { startToken: 3, endToken: 7 } }, answer: f.answer },
    } });
    const result = await f.gateway.conversationTurn({ version: 2, brand, participantMessage: message,
      question: { id: "reaction", text: "What is your reaction?", kind: "reaction" }, discussionQuery: "Study A", recentTurns: [], topics: [] }, f.evidence);
    expect(f.parse).toHaveBeenCalledOnce();
    expect(result.observation.answerEvidence).toEqual(["That sounds useful."]);
    expect(result.answer?.selections[0].supportExcerpt).toBe(f.evidence.candidates[0].text);
  });
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("interprets and answers %s with one call while retaining source validation", async brand => {
    const f = fixture(brand);
    const result = await f.gateway.interpretAndAnswerConversation(f.request, f.evidence);
    expect(f.parse).toHaveBeenCalledOnce();
    expect(f.parse.mock.calls[0][0]).toMatchObject({ reasoning: { effort: "none" } });
    expect(result.result.sourceRequest?.participantEvidence).toBe(f.request.participantMessage);
    expect(result.answer?.selections[0].supportExcerpt).toBe(f.evidence.candidates[0].text);
    expect(result.interpretation.reactionStatus).toBe("not_answered");
  });
  it("does not generate unsolicited evidence for an answer-only research turn", async () => {
    const f = fixture("nubeqa");
    f.parse.mockResolvedValue({ output_parsed: { interpretation: { ...f.interpretation, sourceRequest: null, sourceQuestionPlan: null }, answer: null } });
    expect((await f.gateway.interpretAndAnswerConversation(f.request, f.evidence)).answer).toBeNull();
  });
  it.each(["missing_answer", "unsolicited_answer", "unknown_source", "unsupported_number"])("rejects %s without a hidden extra model call", async defect => {
    const f = fixture("nubeqa");
    const output = { interpretation: f.interpretation, answer: f.answer as typeof f.answer | null };
    if (defect === "missing_answer") output.answer = null;
    if (defect === "unsolicited_answer") output.interpretation = { ...f.interpretation, sourceRequest: null, sourceQuestionPlan: null };
    if (defect === "unknown_source") output.answer!.selections[0].sourceId = "other";
    if (defect === "unsupported_number") output.answer!.paragraphs[0].text = "Study A reported 24 months.";
    f.parse.mockResolvedValue({ output_parsed: output });
    await expect(f.gateway.interpretAndAnswerConversation(f.request, f.evidence)).rejects.toThrow();
    expect(f.parse).toHaveBeenCalledOnce();
  });
  it("rejects evidence prepared for another bot before calling the model", async () => {
    const f = fixture("nubeqa");
    await expect(f.gateway.interpretAndAnswerConversation(f.request, { ...f.evidence, surveySlug: "padcev" })).rejects.toThrow("another bot");
    expect(f.parse).not.toHaveBeenCalled();
  });
});
