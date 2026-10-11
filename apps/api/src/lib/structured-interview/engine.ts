import type {
  AnswerSource, EvidenceCard, InterviewState, StructuredOption, StructuredQuestion, StructuredSurvey,
} from "./types";

/** Deterministic PRNG so a session's rotation and shuffles can be reproduced from its id. */
export function seededRandom(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = h >>> 0;
  return () => { a += 0x6d2b79f5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function shuffle<T>(items: T[], random: () => number) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; }
  return copy;
}

/** Shuffle only the options that are not anchored; anchored ones keep their slot. */
function shuffleUnanchored(options: StructuredOption[], random: () => number) {
  const free = shuffle(options.filter(o => !o.anchored), random);
  return options.map(o => (o.anchored ? o : free.shift()!));
}

export function questionById(survey: StructuredSurvey, id: string) {
  const question = survey.questions.find(q => q.id === id);
  if (!question) throw new Error(`Unknown question ${id}.`);
  return question;
}

export function createInterview(survey: StructuredSurvey, sessionId: string, now: Date): InterviewState {
  const random = seededRandom(`${survey.version}:${sessionId}`);
  // Rotate each block in place: same slots in the guide, random order within them.
  let order = survey.questions.map(q => q.id);
  for (const block of survey.rotationBlocks) {
    const rotated = shuffle(block, random);
    order = order.map(id => (block.includes(id) ? rotated.shift()! : id));
  }
  const optionOrder: Record<string, string[]> = {};
  for (const question of survey.questions) {
    let options = question.options;
    if (question.shuffleOptions) options = shuffleUnanchored(options, random);
    if (question.optionsFollowRotation) {
      const rank = (o: StructuredOption) => (o.ref ? order.indexOf(o.ref) : Number.MAX_SAFE_INTEGER);
      const linked = options.filter(o => o.ref).sort((a, b) => rank(a) - rank(b));
      options = options.map(o => (o.ref ? linked.shift()! : o));
    }
    optionOrder[question.id] = options.map(o => o.id);
  }
  return {
    version: 1, sessionId, surveySlug: survey.slug, surveyVersion: survey.version, order, optionOrder,
    index: 0, phase: "question", pendingFollowUp: null, presentedAt: now.toISOString(),
    answers: {}, detours: [], startedAt: now.toISOString(), completedAt: null, endReason: null, clarifying: false, pendingVerbatim: null,
  };
}

export function isFinished(state: InterviewState) {
  return state.phase === "complete" || state.phase === "declined";
}

export function currentQuestion(survey: StructuredSurvey, state: InterviewState): StructuredQuestion | null {
  if (isFinished(state)) return null;
  const id = state.order[state.index];
  return id ? questionById(survey, id) : null;
}

export function orderedOptions(question: StructuredQuestion, state: InterviewState) {
  const ids = state.optionOrder[question.id] ?? question.options.map(o => o.id);
  return ids.map(id => question.options.find(o => o.id === id)!).filter(Boolean);
}

/** Number of guide questions, and how many have been answered, for the progress bar. */
export function progress(state: InterviewState) {
  return { answered: Object.keys(state.answers).length, total: state.order.length, position: Math.min(state.index + 1, state.order.length) };
}

export type QuestionView = {
  id: string; section: string; prompt: string; kind: "single" | "multi"; maxSelect: number | null;
  options: Array<{ id: string; label: string; exclusive: boolean }>;
  card: EvidenceCard | null;
};

export function questionView(survey: StructuredSurvey, state: InterviewState): QuestionView | null {
  const question = currentQuestion(survey, state);
  if (!question) return null;
  return {
    id: question.id, section: question.section, prompt: question.prompt, kind: question.kind,
    maxSelect: question.kind === "multi" ? question.maxSelect ?? null : null,
    options: orderedOptions(question, state).map(o => ({ id: o.id, label: o.label, exclusive: Boolean(o.exclusive) })),
    card: question.card ?? null,
  };
}

export class SelectionError extends Error {}

/** Validate and normalise chosen option ids for the current question. */
export function validateSelection(question: StructuredQuestion, optionIds: string[]) {
  const known = new Set(question.options.map(o => o.id));
  const chosen = [...new Set(optionIds)].filter(id => known.has(id));
  if (!chosen.length) throw new SelectionError("Choose an option, or type or say your answer.");
  if (question.kind === "single" && chosen.length > 1) throw new SelectionError("Choose one option.");
  const exclusive = chosen.find(id => question.options.find(o => o.id === id)?.exclusive);
  if (exclusive && chosen.length > 1) return [exclusive];
  if (question.kind === "multi" && question.maxSelect && chosen.length > question.maxSelect) {
    throw new SelectionError(`Choose up to ${question.maxSelect}.`);
  }
  return chosen;
}

/** The follow-up to ask after an answer, or null. One per question at most. */
export function followUpFor(question: StructuredQuestion, optionIds: string[], hasOwnReason: boolean) {
  if (hasOwnReason) return null;
  const chosen = optionIds.map(id => question.options.find(o => o.id === id)!).filter(Boolean);
  // An "Other"-style option always needs its specifics captured.
  const anchoredWithFollowUp = chosen.find(o => o.anchored && o.followUp);
  if (anchoredWithFollowUp) return anchoredWithFollowUp.followUp!;
  if (question.kind === "single" && chosen[0]?.followUp) return chosen[0].followUp;
  if (!question.followUp) return null;
  if (question.followUpOnlyIfSingleChoice && chosen.length !== 1) return null;
  return question.followUp;
}

function advance(state: InterviewState, now: Date) {
  state.index += 1;
  state.pendingFollowUp = null;
  state.clarifying = false;
  state.pendingVerbatim = null;
  if (state.index >= state.order.length) {
    state.phase = "complete"; state.endReason = "completed"; state.completedAt = now.toISOString(); state.presentedAt = null;
  } else {
    state.phase = "question"; state.presentedAt = now.toISOString();
  }
}

export type AnswerInput = {
  optionIds: string[];
  verbatim: string | null;
  source: AnswerSource;
  /** The options came from interpreting free text, not from a tap. */
  inferred: boolean;
  /** The participant's own words already explain why. */
  givesReason: boolean;
  now: Date;
};

export type AnswerOutcome = { kind: "advanced" } | { kind: "follow_up"; prompt: string } | { kind: "detour_open"; prompt: string } | { kind: "ended" };

export function recordAnswer(survey: StructuredSurvey, state: InterviewState, input: AnswerInput): AnswerOutcome {
  const question = currentQuestion(survey, state);
  if (!question || state.phase !== "question") throw new SelectionError("There is no open question to answer.");
  const optionIds = validateSelection(question, input.optionIds);
  const verbatim = input.verbatim?.trim() || state.pendingVerbatim || null;
  state.answers[question.id] = {
    questionId: question.id, optionIds, verbatim, source: input.source, inferred: input.inferred, followUp: null,
    presentedAt: state.presentedAt ?? input.now.toISOString(), answeredAt: input.now.toISOString(),
    displayedOptionIds: state.optionOrder[question.id] ?? question.options.map(o => o.id),
  };
  state.clarifying = false;
  state.pendingVerbatim = null;
  if (optionIds.some(id => question.options.find(o => o.id === id)?.ends)) {
    state.phase = "declined"; state.endReason = "declined"; state.completedAt = input.now.toISOString(); state.presentedAt = null;
    return { kind: "ended" };
  }
  if (question.detourOnOptions?.some(id => optionIds.includes(id)) && !verbatim) {
    state.phase = "detour_open";
    state.pendingFollowUp = { questionId: question.id, prompt: question.detourPrompt ?? "What would you like to know?" };
    return { kind: "detour_open", prompt: state.pendingFollowUp.prompt };
  }
  // A tap that came with the participant's own words counts as explained.
  const explained = input.givesReason || (!input.inferred && Boolean(verbatim));
  const prompt = followUpFor(question, optionIds, explained);
  if (prompt) {
    state.phase = "follow_up";
    state.pendingFollowUp = { questionId: question.id, prompt };
    state.answers[question.id]!.followUp = { prompt, response: null, source: null, skipped: false };
    return { kind: "follow_up", prompt };
  }
  advance(state, input.now);
  return isFinished(state) ? { kind: "ended" } : { kind: "advanced" };
}

export function recordFollowUp(state: InterviewState, input: { text: string | null; source: AnswerSource; now: Date }) {
  if (state.phase !== "follow_up" || !state.pendingFollowUp) throw new SelectionError("There is no follow-up to answer.");
  const answer = state.answers[state.pendingFollowUp.questionId];
  const text = input.text?.trim() || null;
  if (answer?.followUp) answer.followUp = { ...answer.followUp, response: text, source: text ? input.source : null, skipped: !text };
  advance(state, input.now);
  return isFinished(state) ? { kind: "ended" as const } : { kind: "advanced" as const };
}

/** How many detours have been answered while this question was open. */
export function detoursOnQuestion(state: InterviewState, questionId: string | null) {
  return state.detours.filter(d => d.questionId === questionId && d.answered).length;
}

export function canAnswerDetour(survey: StructuredSurvey, state: InterviewState) {
  const id = state.order[state.index] ?? null;
  // The closing open question is itself a detour and always gets its answer.
  if (state.phase === "detour_open") return true;
  return detoursOnQuestion(state, id) < survey.maxDetoursPerQuestion;
}

export function recordDetour(state: InterviewState, input: { question: string; answer: string | null; sourceIds: string[]; parked: boolean; now: Date }) {
  const questionId = state.order[state.index] ?? null;
  state.detours.push({ questionId, question: input.question.slice(0, 2000), answer: input.answer, sourceIds: input.sourceIds,
    answered: Boolean(input.answer) && !input.parked, parked: input.parked, at: input.now.toISOString() });
  // The closing "Yes, I have a question" path ends once its question is answered.
  if (state.phase === "detour_open") {
    const answer = questionId ? state.answers[questionId] : undefined;
    if (answer && !answer.verbatim) answer.verbatim = input.question;
    advance(state, input.now);
  }
}

export function markClarifying(state: InterviewState, verbatim: string) {
  state.clarifying = true;
  state.pendingVerbatim = [state.pendingVerbatim, verbatim.trim()].filter(Boolean).join(" / ").slice(0, 4000) || null;
}

/** "Yes, I have a question" followed by nothing: move on. */
export function skipOpenDetour(state: InterviewState, now: Date) {
  if (state.phase !== "detour_open") throw new SelectionError("There is no open question to skip.");
  advance(state, now);
}

export function stopInterview(state: InterviewState, now: Date) {
  state.phase = "complete"; state.endReason = "stopped"; state.completedAt = now.toISOString(); state.presentedAt = null; state.pendingFollowUp = null;
}

export function parkedQuestions(state: InterviewState) {
  return state.detours.filter(d => d.parked && !d.answered);
}
