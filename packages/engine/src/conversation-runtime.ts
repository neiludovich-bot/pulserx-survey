import { conversationObservationSchema, conversationStateSchema, type ConversationObservation, type ConversationState, type ConversationTurnContext } from "@interview/schemas";

export function validateConversationObservation(context: ConversationTurnContext, output: unknown) {
  const value = conversationObservationSchema.parse(output);
  const excerpts = [...value.answerEvidence, ...value.reactionEvidence, ...value.priorities.map(p => p.evidence), ...(value.request ? [value.request.evidence] : []), ...(value.familiarityEvidence ? [value.familiarityEvidence] : [])];
  if (excerpts.some(text => !context.participantMessage.includes(text))) throw new Error("Observation evidence must be an exact current-message excerpt.");
  if (value.closingResponse && !context.participantMessage.includes(value.closingResponse.evidence)) throw new Error("Closing response requires current-message evidence.");
  if (!context.closing || value.request) value.closingResponse = null;
  if ((value.answerStatus !== "not_answered") !== Boolean(value.answerEvidence.length)) throw new Error("Answer credit requires evidence and vice versa.");
  if (value.answerEvidence.length && !context.question) throw new Error("No active question may receive answer credit.");
  // Asking for another explanation also answers a clarification check. It
  // remains separate from clinical reaction evidence and authored research.
  if (value.request) {
    // Conflicting extraction cannot earn research credit, but need not discard
    // an otherwise valid medical question/answer. Keep independently supported clauses.
    const overlaps = (text: string) => text.includes(value.request!.evidence) || value.request!.evidence.includes(text);
    if (!["information_need", "clarification"].includes(context.question?.kind ?? "")) {
      const priorCount = value.answerEvidence.length;
      value.answerEvidence = value.answerEvidence.filter(text => !overlaps(text));
      if (value.answerEvidence.length < priorCount) value.answerStatus = value.answerEvidence.length ? "partial" : "not_answered";
    }
    value.reactionEvidence = value.reactionEvidence.filter(text => !overlaps(text));
    value.priorities = value.priorities.filter(priority => !overlaps(priority.evidence));
    value.researchSignals = value.researchSignals?.filter(signal => !overlaps(signal.evidence));
  }
  if (value.priorities.length && context.question?.kind !== "priorities") throw new Error("Only a priorities question may establish initial priorities.");
  if (Boolean(value.familiarity) !== Boolean(value.familiarityEvidence)) throw new Error("Familiarity requires participant evidence.");
  return value;
}

export const emptyConversationState = (): ConversationState => conversationStateSchema.parse({ version: 2, parkedGuideId: null, topics: [], activeTopicId: null, discussion: null, reactionPending: false });
export type ConversationAction = "answer_request" | "present_topic" | "advance_guide" | "resume_guide" | "clarify" | "ask_information_need" | "ask_reaction";

/** Select independently of wording, after validated participant evidence. */
export function selectConversationAction(original: ConversationState, observation: ConversationObservation | null, resume: boolean, clinicalReaction = true) {
  const state = conversationStateSchema.parse(structuredClone(original));
  if (resume) {
    // Resume finishes the discussion, not the unanswered parked research question.
    for (const topic of state.topics) if (topic.status === "pending" || topic.status === "presented") topic.status = "skipped";
    state.activeTopicId = null; state.discussion = null; state.reactionPending = false;
    return { state, action: "resume_guide" as ConversationAction };
  }
  if (!observation || observation.outOfScope) return { state, action: "clarify" as ConversationAction };
  const active = state.topics.find(t => t.id === state.activeTopicId);
  if (state.reactionPending && clinicalReaction && (observation.reactionEvidence.length || observation.answerStatus === "answered")) {
    if (active) { active.status = "discussed"; active.evidence.push(...(observation.reactionEvidence.length ? observation.reactionEvidence : observation.answerEvidence)); }
    state.reactionPending = false;
  }
  for (const priority of observation.priorities) {
    if (state.topics.length < 64 && !state.topics.some(t => t.label.toLowerCase() === priority.label.toLowerCase())) {
      state.topics.push({ id: `topic-${state.topics.length + 1}`, label: priority.label, query: priority.query, evidence: [priority.evidence], status: "pending" });
    }
  }
  if (observation.request) return { state, action: "answer_request" as ConversationAction };
  if (state.reactionPending && observation.answerStatus === "answered" && !clinicalReaction) return { state, action: "ask_reaction" as ConversationAction };
  if (state.reactionPending) return { state, action: "clarify" as ConversationAction };
  const pending = state.topics.find(t => t.status === "pending");
  if (pending) { state.activeTopicId = pending.id; return { state, action: "present_topic" as ConversationAction }; }
  if (observation.familiarity === "low") return { state, action: "ask_information_need" as ConversationAction };
  return { state, action: observation.answerStatus === "answered" ? "advance_guide" as ConversationAction : "clarify" as ConversationAction };
}
