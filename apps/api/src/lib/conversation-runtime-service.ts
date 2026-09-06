import { emptyConversationState, selectConversationAction, updateResearchCoverage, objectiveForQuestion, selectObjectiveFollowUp } from "@interview/engine";
import { conversationStateSchema, type ConversationState, type ConversationTurnContext, type ConversationObservation, type GroundedReference } from "@interview/schemas";
import type { MvpGuideQuestion } from "./mvp-brukinsa-guide";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { retrieveWebsiteCandidates } from "./controlled-rag-service";
import { websiteCandidatesForModel, websiteAnswerChunks, renderWebsiteAnswer } from "./website-answer-service";
import { withExplicitSourceAssets } from "./focused-source-evidence";
import { conversationRecap } from "./conversation-closing";

type Input = {
  brand: string; surveySlug: "nubeqa" | "brukinsa" | "padcev";
  state?: ConversationState; question: MvpGuideQuestion | null;
  history: ConversationTurnContext["recentTurns"]; message: string; resume: boolean; stop: boolean;
  timeExpired?: boolean;
  selectGuide: (state: ConversationState, observation: ConversationObservation | null) => MvpGuideQuestion | null;
};
const syntheticQuestion = (id: string, text: string): MvpGuideQuestion => ({ id, canonicalQuestion: text, module: "Conversation", objective: "Capture the participant's perspective without leading them.", sourceContextRequirement: null, routeKeywords: [], completionSignals: [], adaptiveProbes: [], analyzableOutputs: ["conversation_response"] });
function questionKind(question: MvpGuideQuestion | null): NonNullable<ConversationTurnContext["question"]>["kind"] {
  if (question?.id.startsWith("conversation-reaction:")) return "reaction";
  if (question?.id.startsWith("conversation-clarification:")) return "clarification";
  if (question?.id === "conversation-information-need") return "information_need";
  if (question?.id === "conversation-final-questions") return "information_need";
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
  const finish = () => { action = "end"; return done(conversationRecap(state), null, [], true); };
  const remember = (labels: (string | null)[]) => { state.coveredTopics = [...new Set([...state.coveredTopics, ...labels.filter((label): label is string => Boolean(label)).map(label => label.slice(0, 500))])].slice(0, 100); };
  function invite(reason: "time" | "guide", text = "", references: GroundedReference[] = []) {
    const first = !state.closing;
    state.closing ??= { reason };
    state.reactionPending = false;
    action = "final_questions";
    const preface = first ? reason === "time"
      ? "We've reached the planned time, but we can keep going with your questions."
      : "We've reached the end of the planned discussion." : "";
    const question = syntheticQuestion("conversation-final-questions", "Do you have any other questions? If you're all set, let me know and I'll wrap up with a brief recap.");
    return done([text, preface, question.canonicalQuestion].filter(Boolean).join("\n\n"), question, references);
  }
  if (input.stop) return finish();

  async function understand(message: string, question: MvpGuideQuestion | null) {
    const gateway = getOptionalOpenAIGateway();
    if (!gateway) throw new Error("Conversation model unavailable.");
    const candidates = await retrieveWebsiteCandidates({ surveySlug: input.surveySlug, participantMessage: message,
      surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
      sourceTopicContext: state.discussion?.query ?? null, responseMode: "answer_only" });
    if (candidates.some(source => source.surveySlug !== input.surveySlug)) throw new Error("Evidence crossed bot boundaries.");
    const context: ConversationTurnContext = { version: 2, brand: input.brand, participantMessage: message, closing: Boolean(state.closing),
      researchObjectives: state.research?.objectives.filter(objective => objective.status !== "covered").map(objective => ({ id: objective.id, objective: objective.objective,
        missingCriteria: objective.criteria.filter(criterion => !objective.evidence.some(item => item.criterionId === criterion.id)).map(({ id, description }) => ({ id, description })) })),
      question: question ? { id: question.id, text: question.canonicalQuestion, kind: questionKind(question) } : null,
      discussionQuery: state.discussion?.query ?? null, recentTurns: input.history.slice(-8),
      topics: state.topics.map(({ id, label, status }) => ({ id, label, status })) };
    const call = await gateway.conversationTurn(context, { surveySlug: input.surveySlug, query: message.slice(0, 4000),
      candidates: websiteCandidatesForModel(candidates), sourceTopicContext: state.discussion?.query ?? null,
      priorSourceIds: state.discussion?.sourceIds ?? [], sourceQuestionPlan: null, evidenceFocus: "all" });
    trace.push(call.trace);
    if (call.repairTrace) trace.push(call.repairTrace);
    const chunks = call.answer ? websiteAnswerChunks(candidates, call.answer) : [];
    return { ...call, text: call.answer && !call.answer.unavailableReason ? renderWebsiteAnswer(call.answer.paragraphs, chunks) : null,
      references: chunks.map(chunk => withExplicitSourceAssets({ citationId: `rag:${chunk.id}`, title: chunk.title, url: chunk.url || null, description: chunk.description || null, assets: chunk.assets ?? [] })), sourceIds: chunks.map(s => s.id) };
  }

  async function present(query: string) {
    const gateway = getOptionalOpenAIGateway();
    if (!gateway) throw new Error("Conversation model unavailable.");
    const candidates = await retrieveWebsiteCandidates({ surveySlug: input.surveySlug, participantMessage: query,
      surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null,
      sourceTopicContext: null, responseMode: "answer_only" });
    if (candidates.some(source => source.surveySlug !== input.surveySlug)) throw new Error("Evidence crossed bot boundaries.");
    const call = await gateway.presentConversationEvidence({ surveySlug: input.surveySlug, query: query.slice(0, 4000),
      candidates: websiteCandidatesForModel(candidates), sourceTopicContext: null, priorSourceIds: [], sourceQuestionPlan: null, evidenceFocus: "all" });
    trace.push(...call.traces);
    const chunks = websiteAnswerChunks(candidates, call.answer);
    return { text: !call.answer.unavailableReason ? renderWebsiteAnswer(call.answer.paragraphs, chunks) : null,
      references: chunks.map(chunk => withExplicitSourceAssets({ citationId: `rag:${chunk.id}`, title: chunk.title, url: chunk.url || null, description: chunk.description || null, assets: chunk.assets ?? [] })), sourceIds: chunks.map(s => s.id) };
  }

  try {
    let prepared: Awaited<ReturnType<typeof present>> | null = null;
    if (!input.resume) {
      const understood = await understand(input.message, input.question);
      prepared = understood;
      observation = understood.observation;
      if (state.research) state.research = updateResearchCoverage(state.research, observation, input.message);
      if (observation.answerEvidence.length && input.question && !input.question.id.startsWith("conversation-") && !input.question.id.startsWith("objective-probe:")) remember([input.question.module]);
    }
    // The final-Q&A phase has no guide advancement or clinical reaction probes.
    // A current question always wins over a simultaneous signal to finish.
    if (state.closing) {
      if (observation?.request) {
        if (prepared?.text) {
          remember(prepared.references.map(reference => reference.title));
          state.discussion = { query: observation.request.text, lastAnswer: prepared.text, sourceIds: prepared.sourceIds };
        }
        return invite(state.closing.reason, prepared?.text ?? "I don't have enough information in the available material to answer that reliably. You can rephrase it or ask about another topic.", prepared?.references ?? []);
      }
      if (observation?.closingResponse?.intent === "finish") return finish();
      return invite(state.closing.reason, observation?.closingResponse?.intent === "continue" || input.resume ? "Of course—we can keep going." : "");
    }
    // Process the just-submitted response before moving into optional Q&A.
    if (input.timeExpired) {
      if (prepared?.text && observation?.request) {
        remember(prepared.references.map(reference => reference.title));
        state.discussion = { query: observation.request.text, lastAnswer: prepared.text, sourceIds: prepared.sourceIds };
      }
      return invite("time", observation?.request ? prepared?.text ?? "I don't have enough information in the available material to answer that reliably." : "", prepared?.references ?? []);
    }
    const selection = selectConversationAction(state, observation, input.resume, Boolean(observation?.reactionEvidence?.length));
    state = selection.state; action = selection.action;
    if (action === "answer_request" || action === "present_topic") {
      if (!state.parkedGuideId && input.question && !["reaction", "clarification"].includes(questionKind(input.question)) && observation?.answerStatus !== "answered") state.parkedGuideId = input.question.id;
      const topic = state.topics.find(t => t.id === state.activeTopicId);
      const query = action === "present_topic" ? topic!.query : observation!.request!.text;
      if (action === "present_topic") prepared = await present(`${input.brand}: ${query}`);
      if (!prepared?.text) return done("I don't have enough information in the available material to answer that reliably. Could you narrow the question, or would you like to move on?", input.question);
      const wasDiscussing = Boolean(initialState.discussion);
      state.discussion = { query, lastAnswer: prepared.text, sourceIds: prepared.sourceIds };
      remember(prepared.references.map(reference => reference.title));
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
    const activeObjective = objectiveForQuestion(state.research, input.question?.id);
    if (!input.resume && !observation?.outOfScope && state.research && activeObjective && ["advance_guide", "clarify"].includes(action)) {
      const followUp = selectObjectiveFollowUp(state.research, input.question?.id);
      if (followUp) {
        followUp.objective.followUpsAsked++;
        action = "objective_follow_up";
        const question = syntheticQuestion(`objective-probe:${activeObjective.id}`, followUp.criterion.followUp);
        question.objective = activeObjective.objective;
        return done(question.canonicalQuestion, question);
      }
      if (input.question?.id.startsWith("objective-probe:") && activeObjective.status !== "covered") {
        activeObjective.status = "deferred";
        action = "advance_guide";
      }
      if (activeObjective.status === "covered") action = "advance_guide";
    }
    if (action === "clarify") {
      const text = observation?.outOfScope ? `Let's keep this focused on ${input.brand}.` : "Could you say a little more about your perspective?";
      return done(text, input.question);
    }
    if (input.resume && !state.parkedGuideId && input.question && questionKind(input.question) === "guide") {
      state.skippedGuideIds.push(input.question.id);
      if (activeObjective && activeObjective.status !== "covered") activeObjective.status = "deferred";
    }
    const question = input.selectGuide(state, observation);
    state.parkedGuideId = null; state.discussion = null; state.reactionPending = false; state.activeTopicId = null;
    if (!question) return invite("guide");
    const nextObjective = objectiveForQuestion(state.research, question.id);
    const transition = nextObjective && nextObjective.module !== activeObjective?.module ? `${nextObjective.transition} ` : initialState.discussion ? "Let's return to your perspective. " : observation?.answerStatus === "answered" ? "Thank you. " : "";
    // A detour or earlier volunteered answer may already supply half this
    // objective. Ask the missing part instead of presenting the whole question again.
    if (state.research && nextObjective?.status === "partial") {
      const followUp = selectObjectiveFollowUp(state.research, question.id);
      if (followUp) {
        followUp.objective.followUpsAsked++;
        action = "objective_follow_up";
        const probe = syntheticQuestion(`objective-probe:${nextObjective.id}`, followUp.criterion.followUp);
        probe.objective = nextObjective.objective;
        const priorView = nextObjective.evidence.find(item => item.criterionId === "perspective")?.evidence;
        const anchor = priorView ? `You mentioned: “${priorView.slice(0, 240)}${priorView.length > 240 ? "…" : ""}” ` : "";
        return done(`${transition}${anchor}${probe.canonicalQuestion}`, probe);
      }
    }
    if (question.sourceContextRequirement && !question.captureBeforeSourceContext) {
      const presentationQuery = nextObjective
        ? `${input.brand}. Give a focused 60-90 word evidence summary for this discussion: ${question.canonicalQuestion} Research purpose: ${nextObjective.objective} Present only the key source-supported finding needed for that topic, keeping its study, population, regimen, comparator and necessary limitations accurate. Do not catalogue every endpoint or add unrelated context. Do not mention the research purpose, the next question, or instructions to the interviewer in the answer. Do not give a clinical recommendation.`
        : `Briefly explain the clinical information needed to consider this question: ${question.canonicalQuestion}. ${question.sourceContextRequirement}`;
      const result = await present(presentationQuery);
      if (result.text) {
        remember(result.references.map(reference => reference.title));
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
