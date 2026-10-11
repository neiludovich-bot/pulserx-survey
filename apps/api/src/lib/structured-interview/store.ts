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
  /** Position in the stored transcript; assigned when first saved. */
  sequence?: number;
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

const studyIds = new Map<string, string>();

async function ensureStudy(survey: StructuredSurvey) {
  const slug = studySlug(survey);
  const cached = studyIds.get(slug);
  if (cached) return cached;
  const config = json({ runtime: RUNTIME, surveySlug: survey.slug, surveyVersion: survey.version, brand: survey.brand });
  const upsert = () => prisma.study.upsert({
    where: { slug },
    create: { slug, name: survey.title, description: "Structured HCP interview.", status: "ACTIVE", config },
    update: { name: survey.title, status: "ACTIVE", config },
  });
  // Two first interviews at once can race on the unique slug; the second simply retries.
  const study = await upsert().catch(() => upsert());
  studyIds.set(slug, study.id);
  return study.id;
}

/** Save state and any new messages. The respondent never waits on a failed audit write. */
export async function saveInterview(survey: StructuredSurvey, interview: StoredInterview, newMessages: InterviewMessage[]) {
  const { state } = interview;
  // Number new messages after the highest earlier one, so a failed save or a restart never overwrites turns.
  let next = Math.max(0, ...interview.messages.filter(m => !newMessages.includes(m)).map(m => m.sequence ?? 0)) + 1;
  for (const message of newMessages) message.sequence ??= next++;
  remember(state.sessionId, interview);
  if (!dbEnabled()) return;
  try {
    const studyId = await ensureStudy(survey);
    const status = state.phase === "complete" || state.phase === "declined" ? SessionStatus.COMPLETED : SessionStatus.ACTIVE;
    const metadata = json({ runtime: RUNTIME, surveySlug: survey.slug, surveyVersion: survey.version, state });
    await prisma.$transaction([
      prisma.session.upsert({
        where: { id: state.sessionId },
        create: { id: state.sessionId, studyId, status, metadata, startedAt: new Date(state.startedAt),
          completedAt: state.completedAt ? new Date(state.completedAt) : null },
        update: { status, metadata, completedAt: state.completedAt ? new Date(state.completedAt) : null },
      }),
      ...newMessages.map(message => prisma.turn.upsert({
        where: { sessionId_sequence: { sessionId: state.sessionId, sequence: message.sequence! } },
        create: { studyId, sessionId: state.sessionId, sequence: message.sequence!,
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
        createdAt: payload.createdAt ?? turn.createdAt.toISOString(), payload: payload.payload, sequence: turn.sequence } as InterviewMessage;
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
