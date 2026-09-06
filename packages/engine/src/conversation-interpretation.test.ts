import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
vi.mock("@interview/prompts", async () => import("../../prompts/src/index"));
import { conversationInterpretationInputSchema, conversationInterpretationResultSchema, type ConversationInterpretationInput, type ConversationInterpretationResult, type ModeratorPlanInput } from "@interview/schemas";
import { conversationModeratorPlan, conversationRouteResult, validateConversationInterpretation } from "./conversation-interpretation";
import { participantTokensForModel, tokenizeParticipantMessage } from "./evidence-ranges";
import { OpenAIResponsesGateway } from "./openai-workflows";

function range(message: string, excerpt: string) {
  const start = message.indexOf(excerpt);
  const tokens = tokenizeParticipantMessage(message);
  return { startToken: tokens.find(t => t.start === start)!.index, endToken: tokens.find(t => t.end === start + excerpt.length)!.index };
}
function context(surveySlug: "nubeqa" | "padcev" | "brukinsa", message: string): ConversationInterpretationInput {
  return conversationInterpretationInputSchema.parse({ version: 1, surveySlug, sourceBrand: surveySlug.toUpperCase(),
    activeIntentSlug: null, activeIntentLabel: null, activeIntentSteeringRule: null,
    currentQuestionId: "factors", currentQuestion: "Which factors matter most?", currentQuestionObjective: "Capture priorities",
    participantMessage: message, participantTokens: participantTokensForModel(message),
    state: { version: 1, priorities: [], activePriorityId: null }, isPriorityQuestion: true, isResumeCue: false,
    candidateQuestions: [{ id: "fit", question: "What matters for fit?", objective: "Understand fit", module: "Research", allowedByIntent: true, alreadyAsked: false }],
  });
}
function result(overrides: Partial<ConversationInterpretationResult> = {}): ConversationInterpretationResult {
  return conversationInterpretationResultSchema.parse({ version: 1, answerStatus: "not_answered", answerEvidenceRanges: [],
    sourceRequest: null, sourceQuestionPlan: null, understandingUpdate: null, isOutOfScope: false, topic: null,
    suggestedQuestionIds: [], rationale: "Interpret the current response.",
    reactionStatus: "not_answered", reactionTargetPriorityId: null, reactionEvidenceRanges: [], priorityMentions: [], ...overrides });
}
function moderatorInput(input: ConversationInterpretationInput, wire: ConversationInterpretationResult): ModeratorPlanInput {
  const route = conversationRouteResult(input.participantMessage, wire);
  return { brand: input.sourceBrand, currentQuestion: input.currentQuestion, participantMessage: input.participantMessage,
    state: input.state, recentTurns: [], isPriorityQuestion: input.isPriorityQuestion, isResumeCue: input.isResumeCue,
    asksSourceQuestion: route.asksSourceQuestion, answerStatus: route.answerStatus, sourceRequest: route.sourceRequest };
}

describe("shared conversation interpretation", () => {
  it("credits a familiarity answer and leaves orientation selection to application policy", () => {
    const input = context("nubeqa", "Not very familiar with it.");
    input.currentQuestionId = "familiarity";
    input.currentQuestion = "How familiar are you with this product?";
    input.isPriorityQuestion = false;
    const evidence = range(input.participantMessage, input.participantMessage);
    const wire = result({ answerStatus: "answered", answerEvidenceRanges: [evidence], understandingUpdate: {
      version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidenceRanges: [evidence],
    } });
    const validated = validateConversationInterpretation(input, wire);
    expect(conversationRouteResult(input.participantMessage, validated)).toMatchObject({ answerStatus: "answered", asksSourceQuestion: false });
    expect(conversationModeratorPlan(moderatorInput(input, validated), validated).action).toBe("resume_guide");
  });
  it("makes one structured call and exposes both route and moderator interpretation", async () => {
    const input = context("nubeqa", "Not very familiar with it.");
    input.isPriorityQuestion = false;
    const wire = result({ understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null, participantEvidenceRanges: [range(input.participantMessage, input.participantMessage)] } });
    const parse = vi.fn().mockResolvedValue({ output_parsed: wire });
    const gateway = new OpenAIResponsesGateway("test", { analysisModel: "test", decisionModel: "test", phrasingModel: "test" }, undefined, { parse });
    const { version: _version, participantTokens: _tokens, ...request } = input;
    const call = await gateway.interpretConversation(request);
    expect(parse).toHaveBeenCalledOnce();
    expect(call.result).toMatchObject({ answerStatus: "not_answered", understandingUpdate: { productFamiliarity: "low" } });
    expect(call.interpretation).toEqual(wire);
    expect(call.trace.callType).toBe("conversation_interpretation");
  });
  it.each(["nubeqa", "brukinsa", "padcev"] as const)("retains two %s priorities and selects their first presentation without another model decision", surveySlug => {
    const input = context(surveySlug, "PFS and DDI");
    const wire = result({ answerStatus: "answered", answerEvidenceRanges: [range(input.participantMessage, input.participantMessage)],
      priorityMentions: ["PFS", "DDI"].map(label => ({ label, participantEvidenceRange: range(input.participantMessage, label),
        sourceQuestion: `What ${label} information is described for ${input.sourceBrand}?`, existingPriorityId: null, kind: "initial_priority", additionEvidenceRange: null })) });
    const validated = validateConversationInterpretation(input, wire);
    expect(conversationRouteResult(input.participantMessage, validated)).toMatchObject({ answerStatus: "answered", asksSourceQuestion: false });
    const plan = conversationModeratorPlan(moderatorInput(input, validated), validated);
    expect(plan.newPriorities.map(p => p.label)).toEqual(["PFS", "DDI"]);
    expect(plan.action).toBe("present_priority");
  });

  it.each(["nubeqa", "brukinsa", "padcev"] as const)("preserves a %s reaction and embedded question without a question mark", surveySlug => {
    const opinion = "It's something I need to track but not terribly concerning.";
    const question = "So someone on those medications is at risk for what adverse reactions";
    const input = context(surveySlug, `${opinion}  ${question}`);
    input.isPriorityQuestion = false;
    input.state = { version: 1, activePriorityId: "ddi", priorities: [{ id: "ddi", label: "DDI", participantEvidence: "DDI", sourceQuestion: "What drug interactions are described?", status: "presented", reactionEvidence: [], referenceIds: [], probeCount: 0 }] };
    const wire = result({ reactionStatus: "answered", reactionTargetPriorityId: "ddi", reactionEvidenceRanges: [range(input.participantMessage, opinion)],
      sourceRequest: { kind: "question", participantEvidenceRange: range(input.participantMessage, question), resolvedQuestion: question },
      sourceQuestionPlan: { version: 1, interpretedQuestion: question, retrievalQueries: [question], usesSourceContext: true,
        answerApproach: "contextual_explanation", contextBoundary: "Keep general safety separate from interaction-specific causality.", rationale: "Seek practical context." } });
    const validated = validateConversationInterpretation(input, wire);
    const plan = conversationModeratorPlan(moderatorInput(input, validated), validated);
    expect(plan).toMatchObject({ action: "answer_source", reactionStatus: "answered", reactionEvidence: [opinion], sourceRequest: { participantEvidence: question } });
    // Reconcile against the current state, including a separately parked topic.
    const reloaded = structuredClone(moderatorInput(input, validated));
    reloaded.state.priorities.unshift({ ...reloaded.state.priorities[0], id: "pfs", label: "PFS" });
    reloaded.state.activePriorityId = "pfs";
    expect(conversationModeratorPlan(reloaded, validated)).toMatchObject({ action: "answer_source", reactionStatus: "not_answered", reactionEvidence: [] });
  });

  it("does not credit a clinical-role answer from volunteered unfamiliarity", () => {
    const input = context("nubeqa", "Not very familiar with it.");
    input.currentQuestionId = "role"; input.currentQuestion = "What is your clinical role?";
    const wire = result({ understandingUpdate: { version: 1, productFamiliarity: "low", preferredDepth: null,
      participantEvidenceRanges: [range(input.participantMessage, input.participantMessage)] } });
    expect(conversationRouteResult(input.participantMessage, validateConversationInterpretation(input, wire)))
      .toMatchObject({ answerStatus: "not_answered", answerEvidence: [], understandingUpdate: { productFamiliarity: "low" } });
  });

  it("rejects out-of-bounds evidence and other-bot topics before research credit", () => {
    const input = context("nubeqa", "PFS and DDI");
    expect(() => validateConversationInterpretation(input, result({ answerStatus: "answered", answerEvidenceRanges: [{ startToken: 0, endToken: 99 }] }))).toThrow();
    expect(() => validateConversationInterpretation(input, result({ topic: "padcev_safety_management" }))).toThrow();
  });

  it("requires retrieval planning to belong to a current request", () => {
    const input = context("nubeqa", "What interactions are noted?");
    const wire = result({ sourceRequest: { kind: "question", resolvedQuestion: input.participantMessage, participantEvidenceRange: range(input.participantMessage, input.participantMessage) } });
    expect(() => validateConversationInterpretation(input, wire)).toThrow("requires its question plan");
  });
});
