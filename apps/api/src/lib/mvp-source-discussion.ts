import type { ModeratorState, ModeratorEvidencePacket } from "@interview/schemas";

type Discussion = NonNullable<ModeratorState["sourceDiscussion"]>;
type ReturnTarget = NonNullable<Discussion["returnTarget"]>;

export function isSourceRetryCue(content: string) {
  return /^(?:please\s+)?(?:retry|try again|try (?:that|it) again)(?:\s+please)?[.!]?$/i.test(content.trim());
}

export function sourceRequestForTurn(state: ModeratorState, content: string) {
  const discussion = state.sourceDiscussion;
  return discussion && isSourceRetryCue(content)
    ? discussion.pendingQuestion ?? discussion.query
    : content;
}

export function sourceDiscussionContextForTurn(discussion: Discussion | undefined, clarifiesPriorAnswer: boolean) {
  const pendingQuestion = clarifiesPriorAnswer && discussion?.status === "failed" ? discussion.pendingQuestion : undefined;
  return {
    sourceTopicContext: pendingQuestion
      ? `Previously discussed source topic: ${discussion!.query}\nUnanswered participant question: ${pendingQuestion}`
      : discussion?.query ?? null,
    // Keep the last successful packet in canonical state, but retrieve support
    // for the unanswered question instead of simplifying that older packet.
    evidencePacket: pendingQuestion ? undefined : discussion?.evidencePacket,
    pendingQuestion,
  };
}

export function beginSourceDiscussion(state: ModeratorState, question: string, returnTarget: ReturnTarget | null, pendingQuestion?: string) {
  const previous = state.sourceDiscussion;
  state.sourceDiscussion = {
    ...previous,
    query: previous?.query ?? question,
    pendingQuestion: pendingQuestion ?? question,
    status: "open",
    returnTarget: returnTarget ?? previous?.returnTarget ?? null,
    navigationHintShown: previous?.navigationHintShown ?? false,
    failure: null,
  };
  return previous;
}

export function completeSourceDiscussion(state: ModeratorState, query: string, evidencePacket?: ModeratorEvidencePacket | null) {
  const discussion = state.sourceDiscussion;
  if (!discussion) return;
  state.sourceDiscussion = {
    ...discussion, query, status: "open", failure: null,
    ...(evidencePacket ? { evidencePacket: structuredClone(evidencePacket) } : {}),
  };
  if (!evidencePacket) delete state.sourceDiscussion.evidencePacket;
  delete state.sourceDiscussion.pendingQuestion;
}

export function failSourceDiscussion(state: ModeratorState, failure: NonNullable<Discussion["failure"]>) {
  if (state.sourceDiscussion) {
    state.sourceDiscussion.status = "failed";
    state.sourceDiscussion.failure = { ...failure, message: failure.message.slice(0, 1000) };
  }
}

export function sourceDiscussionFailure(outcome: { status: string } | null | undefined, message: string) {
  const stage = outcome?.status === "grounding_rejected" ? "grounding" as const
    : outcome?.status === "composition_failure" ? "composition" as const
    : outcome?.status === "no_evidence" ? "retrieval" as const
    : "unavailable" as const;
  return { stage, message: message.slice(0, 1000) };
}

export function sourceFailureParticipantMessage(outcome?: { attempts: Array<{ code: string }> } | null) {
  return outcome?.attempts.some(({ code }) => ["rate_limited", "provider_timeout", "authentication_failed"].includes(code))
    ? "I can't access the source information right now. I've kept our place in the interview."
    : "I couldn't produce a supported answer to that question. I've kept our place in the interview.";
}

export function withSourceNavigationHint(state: ModeratorState, content: string) {
  const discussion = state.sourceDiscussion;
  if (!discussion || discussion.navigationHintShown) return content;
  discussion.navigationHintShown = true;
  const hint = discussion.status === "failed"
    ? 'You can say "retry", ask a different question, or say "continue" to return to the interview.'
    : 'What else would you like to know? When you\'re ready, say "continue" to return to the survey.';
  return `${content}\n\n${hint}`;
}
