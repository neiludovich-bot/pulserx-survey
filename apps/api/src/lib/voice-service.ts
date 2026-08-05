import { createHash } from "node:crypto";
import { z } from "zod";
import {
  realtimeVoiceSessionResponseSchema,
  submitRespondentAnswerResponseSchema,
  submitRespondentVoiceAnswerResponseSchema,
  type GroundedReference,
  type RespondentSessionResponse,
  type SubmitRespondentVoiceAnswer,
  type SubmitRespondentVoiceAnswerResponse,
  type VoiceAnswerVoice,
} from "@interview/schemas";
import { env } from "../env";
import {
  getRespondentSession,
  submitRespondentAnswer,
} from "./interview-service";
import { transcriptLooksNonEnglishOrGarbled } from "./transcript-quality";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_TTS_INPUT_LENGTH = 4096;
const TRANSCRIPTION_PROMPT =
  "Transcribe this as English-language healthcare professional market research speech. The respondent may mention CLL, SLL, WM, MCL, MZL, FL, BRUKINSA, zanubrutinib, SEQUOIA, ALPINE, BTK inhibitors, oncology, hematology, practice setting, patient volume, evidence, safety, dosing, and access. Do not translate. Do not output non-English text. If speech is unclear or mostly silence, return an empty transcript.";
const TTS_INSTRUCTIONS =
  "Speak like a warm, natural medical market research interviewer. Conversational, lightly engaged, with varied intonation. Sound professional but human, not robotic or announcer-like. Keep a brisk, clear pace with short natural pauses.";

const transcriptionResponseSchema = z
  .object({
    text: z.string().optional().default(""),
  })
  .passthrough();

function getOpenAIKey() {
  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for voice interview mode.");
  }

  return env.OPENAI_API_KEY;
}

type CreateRealtimeVoiceSessionInput = {
  sessionId?: string;
};

function sessionSafetyIdentifier(sessionId: string | undefined) {
  if (!sessionId) {
    return null;
  }

  return createHash("sha256").update(sessionId).digest("base64url");
}

function compactInstructionText(value: string, maxLength = 1200) {
  const compact = value.replace(/\s+/gu, " ").trim();

  if (compact.length <= maxLength) {
    return compact;
  }

  return `${compact.slice(0, maxLength - 3)}...`;
}

function formatGroundedReferenceForInstructions(reference: GroundedReference) {
  return [
    reference.title ?? `Citation ${reference.citationId}`,
    reference.url,
    reference.description,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" | ");
}

function latestInterviewerGrounding(
  respondentSession: RespondentSessionResponse | null,
) {
  return (
    respondentSession?.transcript
      .slice()
      .reverse()
      .find((turn) => turn.role === "interviewer")?.grounding ?? null
  );
}

function buildRealtimeInstructions(input?: {
  currentQuestion?: string | null;
  currentAssetTitle?: string | null;
  remainingSeconds?: number | null;
  grounding?: RespondentSessionResponse["transcript"][number]["grounding"];
}) {
  const referenceLines =
    input?.grounding?.references
      .slice(0, 5)
      .map(formatGroundedReferenceForInstructions)
      .filter(Boolean) ?? [];
  const sessionContext = [
    input?.currentQuestion
      ? `Current survey question: ${input.currentQuestion}`
      : null,
    input?.grounding?.kind === "clinical_study_context"
      ? `Current source-grounded briefing shown to the respondent: ${compactInstructionText(
          input.grounding.answer,
        )}`
      : null,
    referenceLines.length > 0
      ? `Current source references: ${referenceLines.join("; ")}`
      : null,
    input?.currentAssetTitle
      ? `Current side-pane asset: ${input.currentAssetTitle}`
      : null,
    typeof input?.remainingSeconds === "number"
      ? `Approximate remaining survey time: ${input.remainingSeconds} seconds.`
      : null,
  ].filter(Boolean);

  return [
    "You are the voice interface for a structured medical market research survey.",
    "Do not choose survey questions on your own.",
    "The application server owns survey state, question selection, phrasing, and persistence.",
    "Use realtime voice only as a low-latency speech transport around the server-controlled interview loop.",
    "Keep spoken responses brief, warm, neutral, and non-leading.",
    "When asked to read a server-provided interviewer message, read only that message and do not add new content.",
    "If source-grounded context is present, treat it as already chosen by the server: do not expand, summarize, or invent citations beyond the displayed source context and references.",
    "If the participant asks for medical advice, diagnosis, treatment, or emergency guidance, refuse briefly and tell them to contact a clinician or emergency services for urgent concerns.",
    "Return the participant to the current survey question after brief clarifications.",
    ...sessionContext,
  ].join(" ");
}

function toRealtimeExpiry(value: unknown) {
  if (typeof value === "number") {
    return new Date(value * 1000).toISOString();
  }

  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return null;
}

const realtimeClientSecretResponseSchema = z
  .object({
    client_secret: z
      .object({
        value: z.string().min(1),
        expires_at: z.union([z.number(), z.string()]).optional(),
      })
      .optional(),
    session: z
      .object({
        client_secret: z
          .object({
            value: z.string().min(1),
            expires_at: z.union([z.number(), z.string()]).optional(),
          })
          .optional(),
      })
      .passthrough()
      .optional(),
    value: z.string().min(1).optional(),
    expires_at: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

export async function createRealtimeVoiceSession(
  input: CreateRealtimeVoiceSessionInput = {},
) {
  if (!env.OPENAI_API_KEY) {
    return realtimeVoiceSessionResponseSchema.parse({
      enabled: false,
      model: env.OPENAI_MODEL_REALTIME,
      clientSecret: null,
      expiresAt: null,
      instructions: null,
      reason: "OPENAI_API_KEY is required for realtime voice mode.",
    });
  }

  const respondentSession = input.sessionId
    ? await getRespondentSession(input.sessionId)
    : null;

  if (
    respondentSession &&
    !respondentSession.capabilities.realtimeVoice.enabled
  ) {
    return realtimeVoiceSessionResponseSchema.parse({
      enabled: false,
      model: env.OPENAI_MODEL_REALTIME,
      clientSecret: null,
      expiresAt: null,
      instructions: null,
      reason:
        respondentSession.capabilities.realtimeVoice.reason ??
        "Realtime voice is disabled for this study.",
    });
  }

  const instructions = buildRealtimeInstructions({
    currentQuestion: respondentSession?.currentQuestion?.prompt ?? null,
    currentAssetTitle: respondentSession?.currentAsset?.title ?? null,
    remainingSeconds: respondentSession?.timing.remainingSeconds ?? null,
    grounding: latestInterviewerGrounding(respondentSession),
  });
  const safetyIdentifier = sessionSafetyIdentifier(input.sessionId);
  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getOpenAIKey()}`,
        "Content-Type": "application/json",
        ...(safetyIdentifier
          ? { "OpenAI-Safety-Identifier": safetyIdentifier }
          : {}),
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model: env.OPENAI_MODEL_REALTIME,
          instructions,
          audio: {
            input: {
              noise_reduction: {
                type: "near_field",
              },
              transcription: {
                model: env.OPENAI_MODEL_TRANSCRIPTION,
                language: env.VOICE_LANGUAGE,
                prompt:
                  "Transcribe medical market research survey answers, clarification questions, and short respondent utterances accurately.",
              },
              turn_detection: {
                type: "server_vad",
                threshold: 0.5,
                prefix_padding_ms: 300,
                silence_duration_ms: 650,
                create_response: false,
                interrupt_response: false,
              },
            },
            output: {
              voice: "nova",
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Realtime session creation failed with ${response.status}: ${details}`,
    );
  }

  const body = realtimeClientSecretResponseSchema.parse(await response.json());
  const clientSecret =
    body.client_secret?.value ??
    body.session?.client_secret?.value ??
    body.value ??
    null;
  const expiresAt = toRealtimeExpiry(
    body.client_secret?.expires_at ??
      body.session?.client_secret?.expires_at ??
      body.expires_at,
  );

  return realtimeVoiceSessionResponseSchema.parse({
    enabled: true,
    model: env.OPENAI_MODEL_REALTIME,
    clientSecret,
    expiresAt,
    instructions,
    reason: null,
  });
}

function extensionForMimeType(mimeType: string) {
  const normalized = mimeType.toLowerCase();

  if (normalized.includes("wav")) {
    return "wav";
  }

  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }

  if (normalized.includes("mp4") || normalized.includes("m4a")) {
    return "m4a";
  }

  return "webm";
}

export function decodeAudio(input: Pick<SubmitRespondentVoiceAnswer, "audioBase64">) {
  const audioBuffer = Buffer.from(input.audioBase64, "base64");

  if (audioBuffer.byteLength === 0) {
    throw new Error("Voice answer did not include any audio bytes.");
  }

  if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
    throw new Error(
      "Voice answer audio is too large. Please keep clips under 25 MB.",
    );
  }

  return audioBuffer;
}

export async function transcribeAudio(params: {
  audioBuffer: Buffer;
  mimeType: string;
  promptContext?: string | null;
}) {
  const formData = new FormData();
  const extension = extensionForMimeType(params.mimeType);
  const prompt = [
    TRANSCRIPTION_PROMPT,
    params.promptContext
      ? `Current survey context: ${compactInstructionText(
          params.promptContext,
          900,
        )}`
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  formData.append(
    "file",
    new Blob([params.audioBuffer], { type: params.mimeType }),
    `answer.${extension}`,
  );
  formData.append("model", env.OPENAI_MODEL_TRANSCRIPTION);
  formData.append("language", "en");
  formData.append("prompt", prompt);
  formData.append("response_format", "json");

  const response = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${getOpenAIKey()}`,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Voice transcription failed with ${response.status}: ${details}`,
    );
  }

  const body = await response.json();
  const parsed = transcriptionResponseSchema.safeParse(body);

  if (!parsed.success) {
    throw new Error("Voice transcription response did not include text.");
  }

  const text = parsed.data.text.trim();

  if (!text) {
    throw new Error(
      "I couldn't detect speech in that recording. Try again and speak after the Record button changes to Stop.",
    );
  }

  if (transcriptLooksNonEnglishOrGarbled(text)) {
    throw new Error(
      "The recording transcribed as non-English or unclear speech. Please try again in English, or type the answer.",
    );
  }

  return text;
}

function textForSpeech(text: string) {
  if (text.length <= MAX_TTS_INPUT_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_TTS_INPUT_LENGTH - 3)}...`;
}

export async function synthesizeSpeech(text: string, voice: VoiceAnswerVoice) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getOpenAIKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL_TTS,
      input: textForSpeech(text),
      voice,
      instructions: TTS_INSTRUCTIONS,
      response_format: "mp3",
      speed: env.OPENAI_TTS_SPEED,
    }),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `Voice synthesis failed with ${response.status}: ${details}`,
    );
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());

  return {
    mimeType: "audio/mpeg" as const,
    base64: audioBuffer.toString("base64"),
  };
}

function getSpokenInterviewerText(
  answer: SubmitRespondentVoiceAnswerResponse["answer"],
) {
  if (answer.session.status === "completed") {
    return answer.session.thankYouMessage ?? "Thanks for your time.";
  }

  const latestInterviewerTurn = [...answer.session.transcript]
    .reverse()
    .find((turn) => turn.role === "interviewer");

  return latestInterviewerTurn?.content ?? null;
}

export async function submitRespondentVoiceAnswer(
  sessionId: string,
  input: SubmitRespondentVoiceAnswer,
) {
  const audioBuffer = decodeAudio(input);
  const transcript = await transcribeAudio({
    audioBuffer,
    mimeType: input.mimeType,
  });

  const answer = submitRespondentAnswerResponseSchema.parse(
    await submitRespondentAnswer(sessionId, transcript, {
      participantPayload: {
        inputMode: "voice",
        voice: input.voice,
        audio: {
          mimeType: input.mimeType,
          byteLength: audioBuffer.byteLength,
        },
        transcription: {
          model: env.OPENAI_MODEL_TRANSCRIPTION,
          language: env.VOICE_LANGUAGE,
        },
      },
    }),
  );

  const spokenText = getSpokenInterviewerText(answer);
  const audio = spokenText
    ? await synthesizeSpeech(spokenText, input.voice)
    : null;

  return submitRespondentVoiceAnswerResponseSchema.parse({
    transcript,
    spokenText,
    audio,
    answer,
  });
}
