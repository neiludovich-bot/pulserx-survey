import { emptyConversationState, selectConversationAction } from "@interview/engine";
import { conversationStateSchema, type ConversationState, type ConversationTurnContext, type ConversationObservation, type GroundedReference } from "@interview/schemas";
import type { MvpGuideQuestion } from "./mvp-brukinsa-guide";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { retrieveWebsiteCandidates } from "./controlled-rag-service";
import { websiteCandidatesForModel, websiteAnswerChunks, renderWebsiteAnswer } from "./website-answer-service";
import { withExplicitSourceAssets } from "./focused-source-evidence";

type Input = {
  brand: string; surveySlug: "nubeqa" | "brukinsa" | "padcev";
  state?: ConversationState; question: MvpGuideQuestion | null;
  history: ConversationTurnContext["recentTurns"]; message: string; resume: boolean; stop: boolean;
  selectGuide: (state: ConversationState, observation: ConversationObservation | null) => MvpGuideQuestion | null;
};
const syntheticQuestion = (id: string, text: string): MvpGuideQuestion => ({ id, canonicalQuestion: text, module: "Conversation", objective: "Capture the participant's perspective without leading them.", sourceContextRequirement: null, routeKeywords: [], completionSignals: [], adaptiveProbes: [], analyzableOutputs: ["conversation_response"] });
function questionKind(question: MvpGuideQuestion | null): NonNullable<ConversationTurnContext["question"]>["kind"] {
  if (question?.id.startsWith("conversation-reaction:")) return "reaction";
  if (question?.id.startsWith("conversation-clarification:")) return "clarification";
  if (question?.id === "conversation-information-need") return "information_need";
  return /\b(priorities|decision drivers|top factors)\b/i.test(`${question?.canonicalQuestion} ${question?.objective}`) ? "priorities" : "guide";
}

/** New dispatch path: no legacy router, moderator, source planner or fallback cascade. */
export async function runConversationRuntime(input: Input) {
  let state = conversationStateSchema.parse(input.state ?? emptyConversationState());
  const initialState = structuredClone(state);
  let observation: ConversationObservation | null = null;
  const trace: unknown[] = [];
  let action = "end";
  const done = (content: string, question: MvpGuideQuestion | null, references: GroundedReference[] = [], completed = false) => ({ state, observation, trace, action, content, question, references, completed, initialState });
  if (input.stop) return done("Thank you for sharing your perspective. That completes the interview.", null, [], true);

  async function understand(message: string, question: MvpGuideQuestion | null) {
    const gateway = getOptionalOpenAIGateway();
    if (!gateway) throw new Error("Conversation model unavailable.");
    const candidates = await retrieveWebsiteCandidates({ surveySlug: input.surveySlug, participantMessage: message,
      surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
      sourceTopicContext: state.discussion?.query ?? null, responseMode: "answer_only" });
    if (candidates.some(source => source.surveySlug !== input.surveySlug)) throw new Error("Evidence crossed bot boundaries.");
    const context: ConversationTurnContext = { version: 2, brand: input.brand, participantMessage: message,
      question: question ? { id: question.id, text: question.canonicalQuestion, kind: questionKind(question) } : null,
      discussionQuery: state.discussion?.query ?? null, recentTurns: input.history.slice(-8),
      topics: state.topics.map(({ id, label, status }) => ({ id, label, status })) };
    const call = await gateway.conversationTurn(context, { surveySlug: input.surveySlug, query: message.slice(0, 4000),
      candidates: websiteCandidatesForModel(candidates), sourceTopicContext: state.discussion?.query ?? null,
      priorSourceIds: state.discussion?.sourceIds ?? [], sourceQuestionPlan: null, evidenceFocus: "all" });
    trace.push(call.trace);
    const chunks = call.answer ? websiteAnswerChunks(candidates, call.answer) : [];
    return { ...call, text: call.answer && !call.answer.unavailableReason ? renderWebsiteAnswer(call.answer.paragraphs, chunks) : null,
      references: chunks.map(chunk => withExplicitSourceAssets({ citationId: `rag:${chunk.id}`, title: chunk.title, url: chunk.url || null, description: chunk.description || null, assets: chunk.assets ?? [] })), sourceIds: chunks.map(s => s.id) };
  }

  try {
    let prepared: Awaited<ReturnType<typeof understand>> | null = null;
    if (!input.resume) {
      prepared = await understand(input.message, input.question);
      observation = prepared.observation;
    }
    const selection = selectConversationAction(state, observation, input.resume, Boolean(observation?.reactionEvidence?.length));
    state = selection.state; action = selection.action;
    if (action === "answer_request" || action === "present_topic") {
      if (!state.parkedGuideId && input.question && !["reaction", "clarification"].includes(questionKind(input.question)) && observation?.answerStatus !== "answered") state.parkedGuideId = input.question.id;
      const topic = state.topics.find(t => t.id === state.activeTopicId);
      const query = action === "present_topic" ? topic!.query : observation!.request!.text;
      if (action === "present_topic") prepared = await understand(query, null);
      if (!prepared?.text) return done("I don't have enough information in the available material to answer that reliably. Could you narrow the question, or would you like to move on?", input.question);
      const wasDiscussing = Boolean(initialState.discussion);
      state.discussion = { query, lastAnswer: prepared.text, sourceIds: prepared.sourceIds };
      if (!wasDiscussing || action === "present_topic") state.reactionPending = true;
      if (topic && action === "present_topic") topic.status = "presented";
      const question = syntheticQuestion(`${wasDiscussing && action !== "present_topic" ? "conversation-clarification" : "conversation-reaction"}:${topic?.id ?? "discussion"}`,
        action === "present_topic" ? `What, if anything, stands out to you about ${topic!.label}?` : wasDiscussing ? "Does that address what you wanted to clarify?" : "What is your reaction to that?");
      const transition = action === "present_topic" && initialState.topics.some(t => t.status === "presented" || t.status === "discussed") ? `Turning to ${topic!.label}:\n\n` : "";
      return done(`${transition}${prepared.text}\n\n${question.canonicalQuestion}`, question, prepared.references);
    }
    if (action === "ask_reaction") {
      const topic = state.topics.find(t => t.id === state.activeTopicId);
      const question = syntheticQuestion(`conversation-reaction:${topic?.id ?? "discussion"}`, topic ? `What, if anything, stands out to you about ${topic.label}?` : "Having clarified that, what is your reaction to the information?");
      return done(question.canonicalQuestion, question);
    }
    if (action === "ask_information_need") {
      if (input.question && observation?.answerStatus !== "answered") state.parkedGuideId ??= input.question.id;
      const question = syntheticQuestion("conversation-information-need", `What would you most like to understand about ${input.brand}?`);
      return done(question.canonicalQuestion, question);
    }
    if (action === "clarify") {
      const text = observation?.outOfScope ? `Let's keep this focused on ${input.brand}.` : "Could you say a little more about your perspective?";
      return done(text, input.question);
    }
    if (input.resume && !state.parkedGuideId && input.question && questionKind(input.question) === "guide") state.skippedGuideIds.push(input.question.id);
    const question = input.selectGuide(state, observation);
    state.parkedGuideId = null; state.discussion = null; state.reactionPending = false; state.activeTopicId = null;
    if (!question) return done("Thank you for sharing your perspective. That completes the interview.", null, [], true);
    const transition = initialState.discussion ? "Let's return to your perspective. " : observation?.answerStatus === "answered" ? "Thank you. " : "";
    if (question.sourceContextRequirement && !question.captureBeforeSourceContext) {
      const result = await understand(`Briefly explain the clinical information needed to consider this question: ${question.canonicalQuestion}. ${question.sourceContextRequirement}`, null);
      if (result.text) {
        state.discussion = { query: question.canonicalQuestion, lastAnswer: result.text, sourceIds: result.sourceIds };
        return done(`${transition}${result.text}\n\n${question.canonicalQuestion}`, question, result.references);
      }
      return done("I couldn't retrieve the information for that discussion. We can retry, or you can say continue to move on.", question);
    }
    return done(`${transition}${question.canonicalQuestion}`, question);
  } catch (error) {
    state = initialState; observation = null; action = "unavailable";
    trace.push({ failure: error instanceof Error ? error.message : "Conversation validation failed." });
    console.warn(JSON.stringify({ event: "conversation_v2_failure", surveySlug: input.surveySlug, message: error instanceof Error ? error.message : "Unknown failure" }));
    return done("I couldn't complete that response. Please try again, or say continue to move on.", input.question);
  }
}
