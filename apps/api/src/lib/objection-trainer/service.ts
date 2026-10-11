import { randomUUID } from "node:crypto";
import { SessionStatus, TurnRole, type Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { getOptionalOpenAIGateway } from "../model-gateway";
import { synthesizeSpeech } from "../voice-service";
import { objectionById, TRAINER_PROGRAMS, type TrainerProgram } from "./nubeqa-objections";
import { advance, createTrainerSession, currentObjection, recordAttempt, scorecard, TrainerError, type TrainerState } from "./session";

export { TrainerError };

const RUNTIME = "objection-trainer";
const memory = new Map<string, TrainerState>();
const dbEnabled = () => Boolean(process.env.DATABASE_URL);
const json = (value: unknown) => JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
const studyIds = new Map<string, string>();

export function trainerProgramFor(slug: string) {
  return Object.hasOwn(TRAINER_PROGRAMS, slug) ? TRAINER_PROGRAMS[slug] ?? null : null;
}

async function ensureStudy(program: TrainerProgram) {
  const slug = `trainer-${program.slug}`;
  const cached = studyIds.get(slug);
  if (cached) return cached;
  const config = json({ runtime: RUNTIME, slug: program.slug });
  const upsert = () => prisma.study.upsert({ where: { slug },
    create: { slug, name: program.title, description: "Sales objection practice.", status: "ACTIVE", config },
    update: { name: program.title, status: "ACTIVE", config } });
  const study = await upsert().catch(() => upsert());
  studyIds.set(slug, study.id);
  return study.id;
}

/** Save the session; each reply and its coaching is also kept as a turn for audit. */
async function save(program: TrainerProgram, state: TrainerState, turn?: { reply: string; coaching: unknown }) {
  memory.set(state.sessionId, state);
  if (!dbEnabled()) return;
  try {
    const studyId = await ensureStudy(program);
    const status = state.phase === "complete" ? SessionStatus.COMPLETED : SessionStatus.ACTIVE;
    const metadata = json({ runtime: RUNTIME, slug: program.slug, repName: state.repName, team: state.team, state });
    await prisma.session.upsert({ where: { id: state.sessionId },
      create: { id: state.sessionId, studyId, status, metadata, startedAt: new Date(state.startedAt) },
      update: { status, metadata, completedAt: state.completedAt ? new Date(state.completedAt) : null } });
    if (turn) {
      // One turn per attempt; the attempt count is the sequence, so a retry of the save cannot collide.
      const sequence = Object.values(state.attempts).reduce((n, attempts) => n + attempts.length, 0);
      const data = { studyId, sessionId: state.sessionId, sequence, role: TurnRole.PARTICIPANT, content: turn.reply,
        payload: json({ runtime: RUNTIME, objectionId: state.order[state.index], coaching: turn.coaching }) };
      await prisma.turn.upsert({ where: { sessionId_sequence: { sessionId: state.sessionId, sequence } }, create: data, update: data });
    }
  } catch (error) {
    console.warn(JSON.stringify({ event: "trainer_persist_failed", sessionId: state.sessionId, message: error instanceof Error ? error.message : "Unknown" }));
  }
}

async function load(sessionId: string): Promise<TrainerState | null> {
  const cached = memory.get(sessionId);
  if (cached) return cached;
  if (!dbEnabled()) return null;
  try {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    const metadata = session?.metadata as { runtime?: string; state?: TrainerState } | null;
    if (metadata?.runtime !== RUNTIME || !metadata.state) return null;
    memory.set(sessionId, metadata.state);
    return metadata.state;
  } catch { return null; }
}

function view(program: TrainerProgram, state: TrainerState) {
  const objection = currentObjection(program, state);
  const attempts = objection ? state.attempts[objection.id] ?? [] : [];
  const latest = state.phase === "feedback" ? attempts.at(-1) ?? null : null;
  return {
    sessionId: state.sessionId, title: program.title, brand: program.brand, persona: program.persona, repName: state.repName,
    phase: state.phase, position: Math.min(state.index + 1, state.order.length), total: state.order.length,
    objection: objection && { id: objection.id, title: objection.title, setting: objection.setting, hcpLine: objection.hcpLine, figures: objection.figures,
      criteria: objection.criteria.map(({ id, label }) => ({ id, label })), attemptNumber: attempts.length + (state.phase === "objection" ? 1 : 0) },
    feedback: latest && objection && { ...latest, modelAnswer: objection.modelAnswer,
      criteria: latest.criteria.map(item => ({ ...item, label: objection.criteria.find(c => c.id === item.id)?.label ?? item.id })),
      previousScore: attempts.length > 1 ? attempts.at(-2)!.score : null },
    summary: state.phase === "complete" ? scorecard(program, state) : null,
  };
}

export type TrainerView = ReturnType<typeof view>;

export async function startTrainer(slug: string, repName: string, team: string | null) {
  const program = trainerProgramFor(slug);
  if (!program) throw new TrainerError("This practice program is not available.", 404);
  if (!repName.trim()) throw new TrainerError("Enter your name to start.");
  const state = createTrainerSession(program, randomUUID(), repName, team, new Date());
  await save(program, state);
  return view(program, state);
}

export async function getTrainer(sessionId: string) {
  const state = await load(sessionId);
  if (!state) throw new TrainerError("Practice session not found.", 404);
  return view(trainerProgramFor(state.slug)!, state);
}

export async function replyToObjection(sessionId: string, reply: string, source: "text" | "voice") {
  const state = await load(sessionId);
  if (!state) throw new TrainerError("Practice session not found.", 404);
  const program = trainerProgramFor(state.slug)!;
  const objection = currentObjection(program, state);
  if (!objection || state.phase !== "objection") throw new TrainerError("There is no objection waiting for a reply.");
  const text = reply.trim();
  if (text.length < 3) throw new TrainerError("Type or say your response to the doctor.");
  const gateway = getOptionalOpenAIGateway();
  if (!gateway) throw new TrainerError("Coaching is unavailable right now.", 503);
  const call = await gateway.coachObjectionReply({ brand: program.brand, persona: `${program.persona.name}, a ${program.persona.role}`,
    objection: objection.hcpLine, setting: objection.setting, criteria: objection.criteria, rules: program.rules,
    approvedFacts: program.approvedFacts, reply: text });
  recordAttempt(program, state, { reply: text, source, result: call.result, now: new Date() });
  await save(program, state, { reply: text, coaching: call.result });
  return view(program, state);
}

export async function moveTrainer(sessionId: string, action: "retry" | "next" | "finish") {
  const state = await load(sessionId);
  if (!state) throw new TrainerError("Practice session not found.", 404);
  const program = trainerProgramFor(state.slug)!;
  advance(state, action, new Date());
  await save(program, state);
  return view(program, state);
}

/** Speak the doctor's objection (never arbitrary text). */
export async function speakObjection(sessionId: string) {
  const state = await load(sessionId);
  if (!state) throw new TrainerError("Practice session not found.", 404);
  const objection = currentObjection(trainerProgramFor(state.slug)!, state);
  if (!objection) return { audio: null };
  return { audio: await synthesizeSpeech(objection.hcpLine, "onyx") };
}

/** Per-rep scores for managers. */
export async function trainerResults(slug: string) {
  const program = trainerProgramFor(slug);
  if (!program) throw new TrainerError("Program not found.", 404);
  let states: TrainerState[];
  if (dbEnabled()) {
    const sessions = await prisma.session.findMany({ where: { study: { slug: `trainer-${program.slug}` } }, orderBy: { createdAt: "desc" }, take: 5000 });
    states = sessions.flatMap(session => {
      const metadata = session.metadata as { runtime?: string; state?: TrainerState } | null;
      return metadata?.runtime === RUNTIME && metadata.state ? [metadata.state] : [];
    });
  } else {
    states = [...memory.values()].filter(state => state.slug === program.slug).reverse();
  }
  const sessions = states.map(state => ({ sessionId: state.sessionId, repName: state.repName, team: state.team, startedAt: state.startedAt,
    completedAt: state.completedAt, ...scorecard(program, state),
    replies: state.order.flatMap(id => (state.attempts[id] ?? []).map(attempt => ({ objectionId: id, title: objectionById(program, id).title,
      reply: attempt.reply, score: attempt.score, compliance: attempt.compliance, improvements: attempt.improvements, at: attempt.at }))) }));
  const reps = [...new Set(states.map(state => state.repName.toLowerCase()))].map(key => {
    const mine = sessions.filter(session => session.repName.toLowerCase() === key);
    const best = mine.flatMap(session => session.rows.map(row => row.best));
    return { repName: mine[0]!.repName, team: mine[0]!.team, sessions: mine.length,
      averageScore: best.length ? Math.round((best.reduce((a, b) => a + b, 0) / best.length) * 10) / 10 : null,
      complianceFlags: mine.reduce((sum, session) => sum + session.rows.reduce((s, row) => s + row.complianceFlags, 0), 0),
      byObjection: program.objections.map(objection => {
        const scores = mine.flatMap(session => session.rows.filter(row => row.id === objection.id).map(row => row.best));
        return { id: objection.id, title: objection.title, average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null };
      }),
      lastActive: mine[0]!.startedAt };
  }).sort((a, b) => (a.averageScore ?? 9) - (b.averageScore ?? 9));
  const objections = program.objections.map(objection => {
    const scores = sessions.flatMap(session => session.rows.filter(row => row.id === objection.id).map(row => row.best));
    return { id: objection.id, title: objection.title, attempts: scores.length,
      average: scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null };
  });
  return { title: program.title, reps, objections, sessions };
}
