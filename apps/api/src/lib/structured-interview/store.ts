import { SessionStatus, TurnRole, type Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import type { InterviewState, StructuredSurvey } from "./types";

export type InterviewMessage = {
  id: string;
  role: "interviewer" | "participant";
  /** What kind of turn this was, for the transcript and exports. */
  kind: "question" | "follow_up" | "answer" | "detour_question" | "detour_answer" | "notice" | "closing";
  content: string;
  questionId: string | null;
  createdAt: string;
  payload?: Record<string, unknown>;
};

export type StoredInterview = { state: InterviewState; messages: InterviewMessage[] };

const RUNTIME = "structured-interview";
const memory = new Map<string, StoredInterview>();
const MAX_MEMORY_SESSIONS = 2000;

const dbEnabled = () => Boolean(process.env.DATABASE_URL);
const json = (value: unknown) => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const studySlug = (survey: StructuredSurvey) => `structured-${survey.slug}`;

function remember(id: string, interview: StoredInterview) {
  memory.delete(id);
  memory.set(id, interview);
  if (memory.size > MAX_MEMORY_SESSIONS) memory.delete(memory.keys().next().value!);
}

async function ensureStudy(survey: StructuredSurvey) {
  const config = json({ runtime: RUNTIME, surveySlug: survey.slug, surveyVersion: survey.version, brand: survey.brand });
  return prisma.study.upsert({
    where: { slug: studySlug(survey) },
    create: { slug: studySlug(survey), name: survey.title, description: "Structured HCP interview.", status: "ACTIVE", config },
    update: { name: survey.title, status: "ACTIVE", config },
  });
}

/** Save state and any new messages. The respondent never waits on a failed audit write. */
export async function saveInterview(survey: StructuredSurvey, interview: StoredInterview, newMessages: InterviewMessage[]) {
  const { state } = interview;
  remember(state.sessionId, interview);
  if (!dbEnabled()) return;
  try {
    const study = await ensureStudy(survey);
    const status = state.phase === "complete" || state.phase === "declined" ? SessionStatus.COMPLETED : SessionStatus.ACTIVE;
    const metadata = json({ runtime: RUNTIME, surveySlug: survey.slug, surveyVersion: survey.version, state });
    const firstSequence = interview.messages.length - newMessages.length + 1;
    await prisma.$transaction([
      prisma.session.upsert({
        where: { id: state.sessionId },
        create: { id: state.sessionId, studyId: study.id, status, metadata, startedAt: new Date(state.startedAt),
          completedAt: state.completedAt ? new Date(state.completedAt) : null },
        update: { status, metadata, completedAt: state.completedAt ? new Date(state.completedAt) : null },
      }),
      ...newMessages.map((message, offset) => prisma.turn.upsert({
        where: { sessionId_sequence: { sessionId: state.sessionId, sequence: firstSequence + offset } },
        create: { studyId: study.id, sessionId: state.sessionId, sequence: firstSequence + offset,
          role: message.role === "interviewer" ? TurnRole.INTERVIEWER : TurnRole.PARTICIPANT,
          content: message.content, payload: json({ runtime: RUNTIME, ...message }) },
        update: { content: message.content, payload: json({ runtime: RUNTIME, ...message }) },
      })),
    ]);
  } catch (error) {
    console.warn(JSON.stringify({ event: "structured_interview_persist_failed", sessionId: state.sessionId,
      message: error instanceof Error ? error.message : "Unknown error" }));
  }
}

/** Memory first; fall back to the database so a restart does not lose an interview. */
export async function loadInterview(sessionId: string): Promise<StoredInterview | null> {
  const cached = memory.get(sessionId);
  if (cached) return cached;
  if (!dbEnabled()) return null;
  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId }, include: { turns: { orderBy: { sequence: "asc" } } } });
    const metadata = session?.metadata as { runtime?: string; state?: InterviewState } | null;
    if (!session || metadata?.runtime !== RUNTIME || !metadata.state) return null;
    const messages = session.turns.map(turn => {
      const payload = (turn.payload ?? {}) as Partial<InterviewMessage>;
      return { id: payload.id ?? turn.id, role: payload.role ?? (turn.role === TurnRole.INTERVIEWER ? "interviewer" : "participant"),
        kind: payload.kind ?? "notice", content: turn.content, questionId: payload.questionId ?? null,
        createdAt: payload.createdAt ?? turn.createdAt.toISOString(), payload: payload.payload } as InterviewMessage;
    });
    const interview = { state: metadata.state, messages };
    remember(sessionId, interview);
    return interview;
  } catch {
    return null;
  }
}

/** All stored interviews for a survey, newest first, for the export. */
export async function listInterviews(survey: StructuredSurvey, limit = 5000): Promise<StoredInterview[]> {
  if (!dbEnabled()) {
    return [...memory.values()].filter(i => i.state.surveySlug === survey.slug).reverse().slice(0, limit);
  }
  const sessions = await prisma.session.findMany({
    where: { study: { slug: studySlug(survey) } }, orderBy: { createdAt: "desc" }, take: limit,
    include: { turns: { orderBy: { sequence: "asc" } } },
  });
  return sessions.flatMap(session => {
    const metadata = session.metadata as { runtime?: string; state?: InterviewState } | null;
    if (metadata?.runtime !== RUNTIME || !metadata.state) return [];
    return [{ state: metadata.state, messages: session.turns.map(turn => ({ ...(turn.payload as InterviewMessage), content: turn.content })) }];
  });
}

export function resetStructuredInterviewMemory() {
  memory.clear();
}
