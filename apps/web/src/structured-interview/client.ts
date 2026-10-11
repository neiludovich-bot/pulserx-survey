import { webEnv } from "../env";

export type EvidenceCard = {
  id: string; title: string; subtitle: string; body: string;
  figures: Array<{ url: string; alt: string; caption?: string }>;
  context?: string[];
  sourceUrl: string; sourceLabel: string;
};

export type QuestionView = {
  id: string; section: string; prompt: string; narration?: string | null; kind: "single" | "multi"; maxSelect: number | null;
  options: Array<{ id: string; label: string; exclusive: boolean }>;
  card: EvidenceCard | null;
};

export type ReferenceAsset = { title: string; url: string; description: string | null; assetKind: string };
export type Reference = { citationId: string; title: string | null; url: string | null; assets?: ReferenceAsset[] };

export type InterviewMessage = {
  id: string;
  role: "interviewer" | "participant";
  kind: "question" | "follow_up" | "answer" | "detour_question" | "detour_answer" | "notice" | "closing";
  content: string;
  questionId: string | null;
  createdAt: string;
  payload?: { references?: Reference[]; figures?: Array<{ url: string; alt: string; caption?: string }>; source?: string; optionIds?: string[]; cardId?: string; cardTitle?: string };
};

export type Prompt =
  | { type: "question"; question: QuestionView; clarifying: boolean; returning: boolean }
  | { type: "follow_up"; questionId: string; prompt: string }
  | { type: "open_question"; questionId: string; prompt: string }
  | { type: "end"; reason: "completed" | "declined" | "stopped" };

export type InterviewResponse = {
  sessionId: string; surveySlug: string; title: string; brand: string;
  messages: InterviewMessage[]; prompt: Prompt;
  progress: { answered: number; total: number; position: number };
};

export type TurnInput = {
  action: "select" | "text" | "skip" | "stop";
  optionIds?: string[]; text?: string; source?: "tap" | "text" | "voice";
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}${path}`, {
    ...init, cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!response.ok) {
    let message = "The connection dropped. Check your network and try again.";
    try { const body = (await response.json()) as { message?: string }; if (body.message) message = body.message; } catch { /* keep default */ }
    throw Object.assign(new Error(message), { status: response.status });
  }
  return (await response.json()) as T;
}

export const startInterview = (surveySlug: string) =>
  call<InterviewResponse>("/survey/structured/start", { method: "POST", body: JSON.stringify({ surveySlug }) });

export const resumeInterview = (sessionId: string) =>
  call<InterviewResponse>(`/survey/structured/sessions/${encodeURIComponent(sessionId)}`);

export const sendTurn = (sessionId: string, input: TurnInput) =>
  call<InterviewResponse>("/survey/structured/turn", { method: "POST", body: JSON.stringify({ sessionId, ...input }) });

export const speakLatest = (sessionId: string) =>
  call<{ spokenText: string | null; audio: { mimeType: string; base64: string } | null }>("/survey/structured/speech", {
    method: "POST", body: JSON.stringify({ sessionId }),
  });

export const transcribe = (audioBase64: string, mimeType: string) =>
  call<{ transcript: string }>("/mvp/customgpt-survey/voice-transcribe", {
    method: "POST", body: JSON.stringify({ audioBase64, mimeType }),
  });

export type ResultsSummary = {
  surveySlug: string; title: string; surveyVersion: string;
  totals: { started: number; completed: number; declined: number; stopped: number; medianMinutes: number | null };
  detours: Array<{ sessionId: string; questionId: string | null; question: string; answered: boolean }>;
  questions: Array<{
    id: string; section: string; prompt: string; label: string; kind: "single" | "multi"; responses: number;
    options: Array<{ id: string; label: string; count: number; share: number }>;
    verbatims: Array<{ sessionId: string; optionLabels: string; text: string }>;
  }>;
};
