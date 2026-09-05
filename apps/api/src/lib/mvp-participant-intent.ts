import type { MvpTurnRouteAnalysisResult } from "@interview/schemas";

export type MvpParticipantIntent = Pick<
  MvpTurnRouteAnalysisResult,
  "answerStatus" | "asksSourceQuestion" | "answerEvidence"
>;

export type MvpParticipantIntentInput = {
  participantContent: string;
  currentQuestionId?: string | null;
  currentQuestion?: string | null;
  currentQuestionObjective?: string | null;
  currentQuestionKeywords?: string[];
  currentQuestionCompletionSignals?: string[];
  sourceConversationActive?: boolean;
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// Topic words are not speech acts: "DDI" can name a priority without asking
// the interviewer for a drug-interaction explanation.
const requestOpening = /^(?:(?:well|so|also|and|but|actually|please|okay|ok)\s+)*(?:(?:what|why|how|which|who|when|where)\b|(?:can|could|would|will)\s+(?:you|we|i|it|this|that|there)\b|(?:do|does|did|is|are|was|were|has|have|should)\b|explain\b|tell me\b|show me\b|walk me through\b|remind me\b|clarify\b|describe\b|compare\b|summarize\b|give me\b|provide\b|help me understand\b|i (?:want|need|would like|d like) (?:to know|to understand|to learn|to hear|information|details|more information|more detail|a link)\b)/i;

function isRequestClause(clause: string) {
  if (clause.includes("?")) return true;
  const text = normalize(clause);
  // Declarative "what" clauses state the answer: "What would help is a
  // checklist" is different from the question "What would help?".
  if (/^what (?:(?:would|could|will) help(?: (?:me|us))?(?: most| the most)?|matters?(?: most| the most| to me| to us)?|(?:i|we) (?:would )?(?:need|want|prefer|value|care about)) (?:is|are|would be)\b/.test(text)) {
    return false;
  }
  return requestOpening.test(text) || isInSituRequestClause(clause);
}

// Spoken questions can leave the interrogative in the object position:
// "Those patients are at risk for what complications". Keep these separate
// from reported knowledge or relative clauses such as "I know which...".
function isInSituRequestClause(clause: string) {
  const text = normalize(clause).replace(/^(?:(?:well|so|also|and|but|actually|please|okay|ok)\s+)+/, "");
  if (/\b(?:know|knows|knew|understand|understands|understood|depends?|depending|aware|unsure|uncertain|worried|concerned|explain|explains|explained)\b/.test(text)) return false;
  if (/\b(?:what|which)\s+(?:i|we|you|they|he|she|it|this|that|the|works?|seems?|happens?|follows?|comes?|matters?|helps?|makes?|is|are|was|were|would|could|will|might|should)\b/.test(text)) return false;
  return /\S.+\b(?:for|from|with|about|to|at|on|of|by|in)\s+(?:what|which)\s+\S/.test(text);
}

export function participantHasInSituQuestion(content: string) {
  return participantClauses(content).some(isInSituRequestClause);
}

function participantClauses(content: string) {
  return content
    .split(/(?<=[.!?;])\s+|\n+|\s*[,;]\s*(?=(?:(?:and|but|also)\s+)?(?:what|why|how|which|can|could|tell|explain|show)\b)|\s+(?:and|but|also)\s+(?=(?:what|why|how|which|can|could|tell|explain|show)\b)/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

export function participantRequestsInformation(content: string) {
  return participantClauses(content).some(isRequestClause);
}

function isDiscourseOnlyClause(clause: string) {
  return /^(?:well|so|also|and|but|actually|please|thanks|thank you|ok|okay|got it|understood|that helps|continue|thanks continue|thank you continue|i have a question|one more question|let me ask)(?: now| again)?$/.test(normalize(clause));
}

/** Exact quotations cannot turn an information request into research evidence. */
export function participantOnlyRequestsInformation(content: string) {
  const clauses = participantClauses(content);
  return clauses.some(isRequestClause) &&
    clauses.every((clause) => isRequestClause(clause) || isDiscourseOnlyClause(clause));
}

/** An explicit statement of priorities satisfies an authored priorities question. */
export function participantExplicitlyStatesPriority(input: MvpParticipantIntentInput) {
  const question = normalize([input.currentQuestion, input.currentQuestionObjective,
    ...(input.currentQuestionCompletionSignals ?? [])].filter(Boolean).join(" "));
  if (!/\b(?:factors?|priorities|priority|drivers?|matters?|most important)\b/.test(question)) return false;
  return participantClauses(input.participantContent).some((clause) => {
    if (isRequestClause(clause)) return false;
    const statement = normalize(clause);
    if (/\b(?:not sure|don t know|do not know|unsure)\b/.test(statement)) return false;
    return /\S.+\b(?:matter most|matters most|are most important|is most important|is my priority|are my priorities)\b/.test(statement)
      || /\b(?:i|we) prioriti[sz]e\s+\S+/.test(statement);
  });
}

function answerStatusForClause(
  clause: string,
  input: MvpParticipantIntentInput,
): MvpParticipantIntent["answerStatus"] {
  const text = normalize(clause);
  const context = normalize([
    input.currentQuestion ?? "",
    input.currentQuestionObjective ?? "",
    ...(input.currentQuestionCompletionSignals ?? []),
  ].join(" "));
  if (!context || !text || !/[a-z0-9]/i.test(clause)) return "not_answered";
  if (isDiscourseOnlyClause(clause)) return "not_answered";

  if (input.currentQuestionId === "intro_consent") {
    return /^(?:yes|yeah|yep|sure|okay|ok|i agree|no|no thanks)\b/.test(text) ? "answered" : "not_answered";
  }
  if (/\b(?:familiar|familiarity|know about|awareness)\b/.test(context)) {
    return /\b(?:familiar|unfamiliar|heard|know|known|used|use|somewhat|moderate|very|not much|not really|little|new to|never)\b/.test(text) ? "answered" : "not_answered";
  }
  if (/\b(?:how many|number of|patient volume)\b/.test(context) && /\b(?:\d+|none|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(text)) return "answered";
  if (/^(?:i don t know|i do not know|not sure|unsure|maybe)$/.test(text)) return "partial";
  if (/^(?:yes|no|sure|okay|ok)$/.test(text)) {
    return /^(?:do|does|did|would|could|can|is|are|have|has|will)\b/.test(normalize(input.currentQuestion ?? "")) ? "answered" : "not_answered";
  }

  // Authored priorities and barriers invite noun phrases. Their validity must
  // not depend on whether the author happened to list an acronym as a route keyword.
  if (/\b(?:factors?|priorities|priority|drivers?|concerns?|barriers?|challenges?|friction|matters?|influence|influences|comfort|practical|role|setting)\b/.test(context)) return "answered";
  if ((input.currentQuestionKeywords ?? []).some((keyword) => {
    const term = normalize(keyword);
    return term.length >= 3 && text.includes(term);
  })) return "answered";
  if (/\b(?:i|we) (?:would|will|use|prefer|think|believe|consider|avoid|worry|am|are)\b/.test(text)) return "answered";
  if (/\b(?:favorable|unfavorable|positive|negative|convincing|unconvincing|unchanged|reassuring|concerning)\b/.test(text)) return "answered";
  return text.split(" ").filter((word) => word.length > 2).length >= 3 ? "answered" : "not_answered";
}

/** Conservative local fallback; the validated model may interpret richer context. */
export function interpretMvpParticipantIntent(input: MvpParticipantIntentInput): MvpParticipantIntent {
  const clauses = participantClauses(input.participantContent);
  const answerClauses = clauses.filter((clause) => !isRequestClause(clause));
  const answers = answerClauses.map((clause) => ({ clause, status: answerStatusForClause(clause, input) }));
  const answerStatus = answers.some(({ status }) => status === "answered")
    ? "answered"
    : answers.some(({ status }) => status === "partial") ? "partial" : "not_answered";
  return {
    answerStatus,
    asksSourceQuestion: clauses.some(isRequestClause),
    answerEvidence: answers.filter(({ status }) => status !== "not_answered").map(({ clause }) => clause),
  };
}
