import { webEnv } from "../env";

export type TrainerFigure = { url: string; alt: string; caption?: string };
export type CriterionResult = { id: string; label: string; status: "met" | "partial" | "missed"; note: string };
export type ComplianceFlag = { issue: string; quote: string; explanation: string };

export type TrainerView = {
  sessionId: string; title: string; brand: string; persona: { name: string; role: string }; repName: string;
  phase: "objection" | "feedback" | "complete"; position: number; total: number;
  objection: null | { id: string; title: string; setting: string; hcpLine: string; figures: TrainerFigure[];
    criteria: Array<{ id: string; label: string }>; attemptNumber: number };
  feedback: null | { score: number; previousScore: number | null; criteria: CriterionResult[]; compliance: ComplianceFlag[];
    strengths: string[]; improvements: string[]; hcpReaction: string; modelAnswer: string; reply: string };
  summary: null | { average: number | null; rows: Array<{ id: string; title: string; first: number; best: number; attempts: number; complianceFlags: number }> };
};

export type TrainerResults = {
  title: string;
  reps: Array<{ repName: string; team: string | null; sessions: number; averageScore: number | null; complianceFlags: number;
    byObjection: Array<{ id: string; title: string; average: number | null }>; lastActive: string }>;
  objections: Array<{ id: string; title: string; attempts: number; average: number | null }>;
  sessions: Array<{ sessionId: string; repName: string; team: string | null; startedAt: string; completedAt: string | null; average: number | null;
    replies: Array<{ objectionId: string; title: string; reply: string; score: number; compliance: ComplianceFlag[]; improvements: string[]; at: string }> }>;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init, cache: "no-store", headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) {
    let message = "The connection dropped. Check your network and try again.";
    try { const body = (await response.json()) as { message?: string }; if (body.message) message = body.message; } catch { /* keep default */ }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return (await response.json()) as T;
}

const post = <T,>(path: string, body: unknown) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export const startTrainer = (program: string, repName: string, team?: string) => post<TrainerView>("/trainer/start", { program, repName, team: team || undefined });
export const resumeTrainer = (sessionId: string) => call<TrainerView>(`/trainer/sessions/${encodeURIComponent(sessionId)}`);
export const replyTrainer = (sessionId: string, text: string, source: "text" | "voice") => post<TrainerView>("/trainer/reply", { sessionId, text, source });
export const moveTrainer = (sessionId: string, action: "retry" | "next" | "finish") => post<TrainerView>("/trainer/move", { sessionId, action });
export const speakTrainer = (sessionId: string) => post<{ audio: { mimeType: string; base64: string } | null }>("/trainer/speech", { sessionId });
