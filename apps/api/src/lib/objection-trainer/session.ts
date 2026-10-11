import { seededRandom } from "../structured-interview/engine";
import { objectionById, type TrainerProgram } from "./nubeqa-objections";

export type CoachingResult = {
  criteria: Array<{ id: string; status: "met" | "partial" | "missed"; note: string }>;
  compliance: Array<{ issue: string; quote: string; explanation: string }>;
  score: number;
  strengths: string[];
  improvements: string[];
  hcpReaction: string;
};

export type Attempt = CoachingResult & { reply: string; source: "text" | "voice"; at: string; seconds: number };

export type TrainerState = {
  version: 1;
  sessionId: string;
  slug: TrainerProgram["slug"];
  repName: string;
  team: string | null;
  order: string[];
  index: number;
  phase: "objection" | "feedback" | "complete";
  attempts: Record<string, Attempt[]>;
  presentedAt: string;
  startedAt: string;
  completedAt: string | null;
};

export class TrainerError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

export function createTrainerSession(program: TrainerProgram, sessionId: string, repName: string, team: string | null, now: Date): TrainerState {
  const random = seededRandom(`${program.slug}:${sessionId}`);
  const ids = program.objections.map(objection => objection.id);
  for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [ids[i], ids[j]] = [ids[j]!, ids[i]!]; }
  return { version: 1, sessionId, slug: program.slug, repName: repName.trim().slice(0, 80), team: team?.trim().slice(0, 80) || null,
    order: ids.slice(0, Math.min(program.roundSize, ids.length)), index: 0, phase: "objection", attempts: {},
    presentedAt: now.toISOString(), startedAt: now.toISOString(), completedAt: null };
}

export function currentObjection(program: TrainerProgram, state: TrainerState) {
  const id = state.order[state.index];
  return id && state.phase !== "complete" ? objectionById(program, id) : null;
}

export function recordAttempt(program: TrainerProgram, state: TrainerState, input: { reply: string; source: "text" | "voice"; result: CoachingResult; now: Date }) {
  const objection = currentObjection(program, state);
  if (!objection || state.phase !== "objection") throw new TrainerError("There is no objection waiting for a reply.");
  const seconds = Math.max(0, Math.round((input.now.getTime() - Date.parse(state.presentedAt)) / 1000));
  (state.attempts[objection.id] ??= []).push({ ...input.result, reply: input.reply.slice(0, 6000), source: input.source, at: input.now.toISOString(), seconds });
  state.phase = "feedback";
}

/** After feedback: try the same objection again, move to the next, or finish. */
export function advance(state: TrainerState, action: "retry" | "next" | "finish", now: Date) {
  if (state.phase !== "feedback" && action !== "finish") throw new TrainerError("Reply to the objection first.");
  if (action === "retry") { state.phase = "objection"; state.presentedAt = now.toISOString(); return; }
  if (action === "next" && state.index + 1 < state.order.length) {
    state.index += 1; state.phase = "objection"; state.presentedAt = now.toISOString(); return;
  }
  state.phase = "complete"; state.completedAt = now.toISOString();
}

/** Best and first score per objection, for the end-of-round summary and manager view. */
export function scorecard(program: TrainerProgram, state: TrainerState) {
  const rows = state.order.filter(id => state.attempts[id]?.length).map(id => {
    const attempts = state.attempts[id]!;
    return { id, title: objectionById(program, id).title, first: attempts[0]!.score, best: Math.max(...attempts.map(a => a.score)),
      attempts: attempts.length, complianceFlags: attempts.reduce((sum, a) => sum + a.compliance.length, 0) };
  });
  const average = rows.length ? Math.round((rows.reduce((sum, row) => sum + row.best, 0) / rows.length) * 10) / 10 : null;
  return { rows, average };
}
