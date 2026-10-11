import { randomUUID } from "node:crypto";
import type { GroundedReference } from "@interview/schemas";
import { getOptionalOpenAIGateway } from "../model-gateway";
import { retrieveWebsiteCandidates } from "../controlled-rag-service";
import { answerFromWebsite, renderWebsiteAnswer } from "../website-answer-service";
import { withExplicitSourceAssets } from "../focused-source-evidence";
import { synthesizeSpeech } from "../voice-service";
import {
  canAnswerDetour, createInterview, narrationFor, currentQuestion, isFinished, markClarifying, parkedQuestions, progress, questionView,
  recordAnswer, recordDetour, recordFollowUp, SelectionError, skipOpenDetour, stopInterview, type QuestionView,
} from "./engine";
import { STRUCTURED_SURVEYS } from "./nubeqa";
import { matchFigures } from "./nubeqa-figures";
import { loadInterview, saveInterview, type InterviewMessage, type StoredInterview } from "./store";
import type { AnswerSource, InterviewState, ReplyInterpretation, StructuredSurvey } from "./types";

export type StructuredTurnRequest = {
  sessionId: string;
  action: "select" | "text" | "skip" | "stop";
  optionIds?: string[];
  text?: string;
  source?: AnswerSource;
};

export type StructuredPrompt =
  | { type: "question"; question: QuestionView; clarifying: boolean; returning: boolean }
  | { type: "follow_up"; questionId: string; prompt: string }
  | { type: "open_question"; questionId: string; prompt: string }
  | { type: "end"; reason: "completed" | "declined" | "stopped" };

export type StructuredResponse = {
  sessionId: string;
  surveySlug: StructuredSurvey["slug"];
  title: string;
  brand: string;
  messages: InterviewMessage[];
  prompt: StructuredPrompt;
  progress: { answered: number; total: number; position: number };
};

const DETOUR_TIMEOUT_MS = 30_000;

export class StructuredInterviewError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

export function structuredSurveyFor(slug: string) {
  return Object.hasOwn(STRUCTURED_SURVEYS, slug) ? STRUCTURED_SURVEYS[slug as StructuredSurvey["slug"]] ?? null : null;
}

const nowDate = () => new Date();
const message = (input: Omit<InterviewMessage, "id" | "createdAt">): InterviewMessage =>
  ({ ...input, id: randomUUID(), createdAt: new Date().toISOString() });

/** One turn at a time per session, so two quick taps cannot race. */
const locks = new Map<string, Promise<unknown>>();
async function withSessionLock<T>(sessionId: string, run: () => Promise<T>) {
  const previous = locks.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  locks.set(sessionId, next);
  try { return await next; } finally { if (locks.get(sessionId) === next) locks.delete(sessionId); }
}

function promptFor(survey: StructuredSurvey, state: InterviewState, returning = false): StructuredPrompt {
  if (state.phase === "declined") return { type: "end", reason: "declined" };
  if (state.phase === "complete") return { type: "end", reason: state.endReason === "stopped" ? "stopped" : "completed" };
  if (state.phase === "follow_up" && state.pendingFollowUp) return { type: "follow_up", ...state.pendingFollowUp };
  if (state.phase === "detour_open" && state.pendingFollowUp) return { type: "open_question", ...state.pendingFollowUp };
  return { type: "question", question: questionView(survey, state)!, clarifying: state.clarifying, returning };
}

/** Interviewer messages that introduce whatever the participant is now being asked. */
function promptMessages(survey: StructuredSurvey, state: InterviewState, returning = false): InterviewMessage[] {
  if (state.phase === "declined") return [message({ role: "interviewer", kind: "closing", content: survey.declined, questionId: null })];
  if (state.phase === "complete") return [message({ role: "interviewer", kind: "closing", content: state.endReason === "stopped" ? survey.stopped : survey.closing, questionId: null })];
  if ((state.phase === "follow_up" || state.phase === "detour_open") && state.pendingFollowUp) {
    return [message({ role: "interviewer", kind: "follow_up", content: state.pendingFollowUp.prompt, questionId: state.pendingFollowUp.questionId })];
  }
  const question = currentQuestion(survey, state)!;
  // The narration is said once; a re-ask after a side question or a clarification goes straight to the question.
  const narration = state.clarifying || returning ? null : narrationFor(survey, state);
  const content = state.clarifying ? `So I record this accurately, which of these is closest? ${question.prompt}`
    : returning ? `Back to where we were: ${question.prompt.charAt(0).toLowerCase()}${question.prompt.slice(1)}`
    : [narration, question.prompt].filter(Boolean).join("\n\n");
  return [message({ role: "interviewer", kind: "question", content, questionId: question.id,
    payload: question.card ? { cardId: question.card.id, cardTitle: question.card.title } : undefined })];
}

function respond(survey: StructuredSurvey, interview: StoredInterview, messages: InterviewMessage[], returning = false): StructuredResponse {
  return { sessionId: interview.state.sessionId, surveySlug: survey.slug, title: survey.title, brand: survey.brand,
    messages, prompt: promptFor(survey, interview.state, returning), progress: progress(interview.state) };
}

export async function startStructuredInterview(slug: string): Promise<StructuredResponse> {
  const survey = structuredSurveyFor(slug);
  if (!survey) throw new StructuredInterviewError("This survey is not available.", 404);
  const state = createInterview(survey, randomUUID(), nowDate());
  const messages = [message({ role: "interviewer", kind: "notice", content: survey.welcome, questionId: null }), ...promptMessages(survey, state)];
  const interview = { state, messages };
  await saveInterview(survey, interview, messages);
  return respond(survey, interview, messages);
}

/** Resume: the full transcript plus the current prompt. */
export async function getStructuredInterview(sessionId: string): Promise<StructuredResponse> {
  const interview = await loadInterview(sessionId);
  if (!interview) throw new StructuredInterviewError("Interview not found.", 404);
  const survey = structuredSurveyFor(interview.state.surveySlug)!;
  return respond(survey, interview, interview.messages);
}

async function interpret(survey: StructuredSurvey, state: InterviewState, reply: string, context: string | null): Promise<ReplyInterpretation> {
  const gateway = getOptionalOpenAIGateway();
  const question = currentQuestion(survey, state);
  if (!gateway || !question) return { intent: "unclear", optionIds: [], question: null, givesReason: false };
  const view = questionView(survey, state)!;
  const call = await gateway.interpretStructuredReply({ brand: survey.brand, question: question.prompt, questionKind: question.kind,
    maxSelect: question.kind === "multi" ? question.maxSelect ?? null : null,
    options: view.options.map(({ id, label }) => ({ id, label })), context, reply });
  return call.result;
}

type DetourResult = { text: string | null; references: GroundedReference[]; sourceIds: string[] };

async function answerFromSite(survey: StructuredSurvey, question: string): Promise<DetourResult> {
  const work = (async () => {
    const candidates = await retrieveWebsiteCandidates({ surveySlug: survey.slug, participantMessage: question, surveyContext: "",
      currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only" });
    if (!candidates.length) return { text: null, references: [], sourceIds: [] };
    const result = await answerFromWebsite({ surveySlug: survey.slug, query: question.slice(0, 4000), candidates,
      sourceTopicContext: null, priorSourceIds: [], sourceQuestionPlan: null, evidenceFocus: "all" });
    if (!result || result.unavailableReason) return { text: null, references: [], sourceIds: [] };
    return {
      text: renderWebsiteAnswer(result.paragraphs, result.chunks),
      references: result.chunks.map(chunk => withExplicitSourceAssets({ citationId: `rag:${chunk.id}`, title: chunk.title,
        url: chunk.url || null, description: chunk.description || null, assets: chunk.assets ?? [] })),
      sourceIds: result.chunks.map(chunk => chunk.id),
    };
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<DetourResult>(resolve => { timer = setTimeout(() => resolve({ text: null, references: [], sourceIds: [] }), DETOUR_TIMEOUT_MS); });
  try { return await Promise.race([work, timeout]); }
  catch (error) {
    console.warn(JSON.stringify({ event: "structured_detour_failed", surveySlug: survey.slug, message: error instanceof Error ? error.message : "Unknown" }));
    return { text: null, references: [], sourceIds: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Answer a participant's question (or park it), and return the messages to show. */
async function handleDetour(survey: StructuredSurvey, state: InterviewState, question: string): Promise<InterviewMessage[]> {
  const questionId = state.order[state.index] ?? null;
  if (!canAnswerDetour(survey, state)) {
    recordDetour(state, { question, answer: null, sourceIds: [], parked: true, now: nowDate() });
    return [message({ role: "interviewer", kind: "detour_answer", questionId,
      content: "Good question. I've noted it, and I'll answer it before we finish." })];
  }
  const result = await answerFromSite(survey, question);
  recordDetour(state, { question, answer: result.text, sourceIds: result.sourceIds, parked: false, now: nowDate() });
  const content = result.text
    ?? `I couldn't find a supported answer to that on the ${survey.brand} prescribing site, so I won't speculate. Your question has been recorded for the research team.`;
  return [message({ role: "interviewer", kind: "detour_answer", questionId, content,
    payload: detourPayload(survey, question, result) })];
}

/** References plus the site's own figures that match the question, so answers show evidence. */
function detourPayload(survey: StructuredSurvey, question: string, result: DetourResult) {
  const cited = result.references.flatMap(reference => reference.assets.map(asset => asset.url));
  const imageCount = result.references.flatMap(reference => reference.assets)
    .filter(asset => ["IMAGE", "CHART", "TABLE"].includes(asset.assetKind.toUpperCase()) && /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(asset.url)).length;
  // Only add library figures when there is an answer to illustrate, and only for the brand that has a library.
  const figures = result.text && survey.slug === "nubeqa"
    ? matchFigures(question, Math.max(0, 3 - imageCount), cited).map(({ url, alt, caption }) => ({ url, alt, caption }))
    : [];
  if (!result.references.length && !figures.length) return undefined;
  return { ...(result.references.length ? { references: result.references } : {}), ...(figures.length ? { figures } : {}) };
}

/** Before the closing question, answer anything parked earlier. */
async function answerParked(survey: StructuredSurvey, state: InterviewState): Promise<InterviewMessage[]> {
  if (currentQuestion(survey, state)?.detourOnOptions === undefined) return [];
  const out: InterviewMessage[] = [];
  for (const parked of parkedQuestions(state)) {
    const result = await answerFromSite(survey, parked.question);
    parked.answered = Boolean(result.text); parked.answer = result.text; parked.sourceIds = result.sourceIds;
    out.push(message({ role: "interviewer", kind: "detour_answer", questionId: parked.questionId,
      content: `Earlier you asked: "${parked.question}"\n\n${result.text ?? "I couldn't find a supported answer to that on the prescribing site. It has been recorded for the research team."}`,
      payload: detourPayload(survey, parked.question, result) }));
  }
  return out;
}

const looksLikeQuestion = (text: string) => /\?\s*$/.test(text.trim());

export async function submitStructuredTurn(input: StructuredTurnRequest): Promise<StructuredResponse> {
  return withSessionLock(input.sessionId, async () => {
    const interview = await loadInterview(input.sessionId);
    if (!interview) throw new StructuredInterviewError("Interview not found. Please start again.", 404);
    const survey = structuredSurveyFor(interview.state.surveySlug)!;
    const { state } = interview;
    if (isFinished(state)) return respond(survey, interview, []);
    const source: AnswerSource = input.source ?? (input.action === "select" ? "tap" : "text");
    const text = input.text?.trim().slice(0, 4000) || null;
    const added: InterviewMessage[] = [];
    const participant = (content: string, kind: InterviewMessage["kind"], payload?: Record<string, unknown>) =>
      added.push(message({ role: "participant", kind, content, questionId: state.order[state.index] ?? null, payload: { source, ...payload } }));
    let returning = false;
    const before = state.index;

    try {
      if (input.action === "stop") {
        participant("I'd like to stop here.", "answer");
        stopInterview(state, nowDate());
      } else if (input.action === "skip") {
        if (state.phase === "follow_up") { participant("(skipped)", "answer"); recordFollowUp(state, { text: null, source, now: nowDate() }); }
        else if (state.phase === "detour_open") { participant("(no question)", "answer"); skipOpenDetour(state, nowDate()); }
        else throw new SelectionError("Only a follow-up can be skipped.");
      } else if (input.action === "select") {
        const question = currentQuestion(survey, state);
        if (!question || state.phase !== "question") throw new SelectionError("There is no open question to answer.");
        const labels = (input.optionIds ?? []).map(id => question.options.find(o => o.id === id)?.label).filter(Boolean).join("; ");
        participant([labels, text].filter(Boolean).join(" — "), "answer", { optionIds: input.optionIds ?? [] });
        recordAnswer(survey, state, { optionIds: input.optionIds ?? [], verbatim: text, source, inferred: false, givesReason: Boolean(text), now: nowDate() });
        // "Yes, I have a question" typed together with the question: answer it now.
        if (state.phase === "detour_open" && text) added.push(...await handleDetour(survey, state, text));
      } else {
        if (!text) throw new SelectionError("Type or say your answer.");
        if (state.phase === "detour_open") {
          participant(text, "detour_question");
          added.push(...await handleDetour(survey, state, text));
        } else if (state.phase === "follow_up") {
          if (looksLikeQuestion(text)) {
            participant(text, "detour_question");
            added.push(...await handleDetour(survey, state, text));
            returning = true;
          } else {
            participant(text, "answer");
            recordFollowUp(state, { text, source, now: nowDate() });
          }
        } else {
          const previous = [...interview.messages].reverse().find(m => m.role === "interviewer" && m.kind === "question");
          const reading = await interpret(survey, state, text, previous?.content ?? null);
          if (reading.intent === "stop") {
            participant(text, "answer");
            stopInterview(state, nowDate());
          } else if ((reading.intent === "answer" || reading.intent === "answer_and_question") && reading.optionIds.length) {
            participant(text, "answer", { optionIds: reading.optionIds, inferred: true });
            const closingQuestion = Boolean(currentQuestion(survey, state)?.detourOnOptions?.some(id => reading.optionIds.includes(id)));
            // Answer a side question while its own question is still current, so it counts there.
            if (reading.intent === "answer_and_question" && reading.question && !closingQuestion) {
              added.push(...await handleDetour(survey, state, reading.question));
            }
            recordAnswer(survey, state, { optionIds: reading.optionIds, verbatim: text, source, inferred: true, givesReason: reading.givesReason, now: nowDate() });
            if (state.phase === "detour_open" && reading.question) added.push(...await handleDetour(survey, state, reading.question));
          } else if ((reading.intent === "question" || reading.intent === "answer_and_question") && reading.question) {
            participant(text, "detour_question");
            added.push(...await handleDetour(survey, state, reading.question));
            returning = true;
          } else {
            participant(text, "answer", { unmapped: true });
            markClarifying(state, text);
          }
        }
      }
    } catch (error) {
      if (error instanceof SelectionError) throw new StructuredInterviewError(error.message, 400);
      throw error;
    }

    // Show the next prompt only when it changed, or when returning from a detour.
    const moved = state.index !== before || isFinished(state) || state.phase === "follow_up" || state.phase === "detour_open";
    if (!isFinished(state) && state.index !== before) added.push(...await answerParked(survey, state));
    if (moved || state.clarifying || returning) {
      const intro = promptMessages(survey, state, returning);
      // A follow-up already shown before a detour is re-asked as-is.
      added.push(...intro);
    }
    interview.messages.push(...added);
    await saveInterview(survey, interview, added);
    return respond(survey, interview, added, returning);
  });
}

/** Speak the interviewer's latest messages for this session (never arbitrary text). */
export async function speakStructuredInterview(sessionId: string) {
  const interview = await loadInterview(sessionId);
  if (!interview) throw new StructuredInterviewError("Interview not found.", 404);
  const lastParticipant = interview.messages.map(m => m.role).lastIndexOf("participant");
  const spoken = interview.messages.slice(lastParticipant + 1)
    .filter(m => m.role === "interviewer")
    .map(m => m.content.replace(/\s*\[\d+\](?:\s*\[\d+\])*/g, ""))
    .join(" ")
    .slice(0, 3500)
    .trim();
  const audio = spoken ? await synthesizeSpeech(spoken, "nova") : null;
  return { spokenText: spoken || null, audio };
}
