"use client";

import type {
  AssetReactionKind,
  RespondentSessionResponse,
} from "@interview/schemas";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createRealtimeVoiceSession,
  submitAssetReaction,
  submitRespondentAnswer,
  submitRespondentRealtimeAnswer,
  submitRespondentVoiceAnswer,
} from "../api";
import { webEnv } from "../env";
import {
  getGroundingAnswerDisplayText,
  getTurnQuestionDisplayText,
} from "../grounding";
import { getLiveTimingSnapshot } from "../timing";

const OPENAI_REALTIME_CALL_URL = "https://api.openai.com/v1/realtime/calls";

type RealtimeServerEvent = {
  type?: string;
  transcript?: string;
  delta?: string;
  item_id?: string;
  item?: {
    id?: string;
  };
  error?: {
    message?: string;
  };
  response?: {
    status?: string;
    status_details?: {
      error?: {
        message?: string;
      };
    };
  };
};

type TranscriptTurn = RespondentSessionResponse["transcript"][number];

const ASSET_REACTION_OPTIONS: Array<{
  kind: AssetReactionKind;
  label: string;
}> = [
  { kind: "COMPREHENSION", label: "Reviewed" },
  { kind: "APPEAL", label: "Helpful" },
  { kind: "CONCERN", label: "Confusing" },
];

function formatAssetReactionKind(kind: AssetReactionKind) {
  const option = ASSET_REACTION_OPTIONS.find((item) => item.kind === kind);
  if (option) {
    return option.label;
  }

  return kind
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function resolveAssetUrl(asset: RespondentSessionResponse["currentAsset"]) {
  if (!asset) {
    return null;
  }

  const { storageKey } = asset;

  if (storageKey === "seed://assets/pricing-storyboard.pdf") {
    return "/assets/pricing-storyboard/index.html";
  }

  if (storageKey === "seed://assets/medical-concept-guide.pdf") {
    return "/assets/medical-concept-guide.pdf";
  }

  if (storageKey.startsWith("/")) {
    return storageKey;
  }

  if (/^https?:\/\//i.test(storageKey)) {
    return storageKey;
  }

  if (/^data:/i.test(storageKey)) {
    return storageKey;
  }

  if (storageKey.startsWith("db://study-assets/")) {
    return `${webEnv.NEXT_PUBLIC_API_BASE_URL}/assets/${asset.id}/content`;
  }

  return null;
}

function getAssetRenderKind(
  asset: RespondentSessionResponse["currentAsset"],
  assetUrl: string | null,
) {
  if (!asset || !assetUrl) {
    return "none";
  }

  if (asset.displayMode === "DOWNLOAD_LINK") {
    return "link";
  }

  const mimeType = asset.mimeType?.toLowerCase() ?? "";
  const source = `${assetUrl} ${asset.storageKey}`.toLowerCase();
  const isHtmlSource =
    mimeType === "text/html" || /\.(html?|xhtml)(?:[?#]|$)/i.test(source);

  if (
    asset.assetType === "IMAGE" ||
    mimeType.startsWith("image/") ||
    /\.(png|jpe?g|webp|gif|svg)(?:[?#]|$)/i.test(source)
  ) {
    return "image";
  }

  if (
    asset.assetType === "VIDEO" ||
    mimeType.startsWith("video/") ||
    /\.(mp4|webm|mov)(?:[?#]|$)/i.test(source)
  ) {
    return "video";
  }

  if (
    isHtmlSource ||
    (/^https?:\/\//i.test(assetUrl) &&
      !/\.[a-z0-9]{2,6}(?:[?#]|$)/i.test(assetUrl))
  ) {
    return "frame";
  }

  if (
    asset.assetType === "TEXT" ||
    (mimeType.startsWith("text/") && mimeType !== "text/html") ||
    mimeType === "application/markdown" ||
    /\.(txt|md|markdown)(?:[?#]|$)/i.test(source)
  ) {
    return "text";
  }

  return "frame";
}

function TextAssetViewer({
  asset,
  assetUrl,
  className,
}: {
  asset: NonNullable<RespondentSessionResponse["currentAsset"]>;
  assetUrl: string;
  className: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadText() {
      setText(null);
      setError(null);

      try {
        const response = await fetch(assetUrl);
        if (!response.ok) {
          throw new Error(`Unable to load asset (${response.status}).`);
        }

        const loadedText = await response.text();
        if (!cancelled) {
          setText(loadedText);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Unable to load asset.",
          );
        }
      }
    }

    void loadText();

    return () => {
      cancelled = true;
    };
  }, [assetUrl]);

  return (
    <div className={`${className} asset-text-frame`}>
      <div className="asset-text-toolbar">
        <span>{asset.mimeType ?? "text"}</span>
        <a href={assetUrl} rel="noreferrer" target="_blank">
          Open
        </a>
      </div>
      {error ? (
        <p className="inline-error">{error}</p>
      ) : text === null ? (
        <p className="muted-copy">Loading source text...</p>
      ) : (
        <pre>{text}</pre>
      )}
    </div>
  );
}

function AssetViewer({
  asset,
  assetUrl,
  variant,
}: {
  asset: NonNullable<RespondentSessionResponse["currentAsset"]>;
  assetUrl: string;
  variant: "inline" | "modal";
}) {
  const renderKind = getAssetRenderKind(asset, assetUrl);
  const className = variant === "modal" ? "asset-modal-frame" : "asset-frame";

  if (renderKind === "link") {
    return (
      <div className={`${className} asset-link-panel`}>
        <div className="stack-sm">
          <span className="label">Approved Source</span>
          <strong>{asset.title}</strong>
          {asset.description ? (
            <p className="muted-copy">{asset.description}</p>
          ) : null}
        </div>
        <a
          className="button-secondary"
          href={assetUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open Source
        </a>
      </div>
    );
  }

  if (renderKind === "image") {
    return (
      <Image
        alt={asset.title}
        className={`${className} asset-media asset-media-image`}
        height={800}
        src={assetUrl}
        unoptimized
        width={1200}
      />
    );
  }

  if (renderKind === "video") {
    return (
      <video
        className={`${className} asset-media`}
        controls
        src={assetUrl}
        title={asset.title}
      />
    );
  }

  if (renderKind === "text") {
    return (
      <TextAssetViewer
        asset={asset}
        assetUrl={assetUrl}
        className={className}
      />
    );
  }

  return <iframe className={className} src={assetUrl} title={asset.title} />;
}

function getPreferredAudioMimeType() {
  if (typeof MediaRecorder === "undefined") {
    return "";
  }

  return (
    [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/mpeg",
      "audio/wav",
    ].find((mimeType) => MediaRecorder.isTypeSupported(mimeType)) ?? ""
  );
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
}

async function playBase64Audio(audio: { mimeType: string; base64: string }) {
  const player = new Audio(`data:${audio.mimeType};base64,${audio.base64}`);
  await player.play();
}

function formatSeconds(value: number) {
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getLatestInterviewerText(session: RespondentSessionResponse) {
  if (session.status === "completed") {
    return session.thankYouMessage ?? "Thanks for your time.";
  }

  return (
    [...session.transcript]
      .reverse()
      .find((turn) => turn.role === "interviewer")?.content ??
    session.currentQuestion?.prompt ??
    null
  );
}

function combineVoiceUnavailableReasons(
  recordedReason: string | null,
  realtimeReason: string | null,
) {
  if (!recordedReason) {
    return realtimeReason;
  }

  if (!realtimeReason || recordedReason === realtimeReason) {
    return recordedReason;
  }

  if (
    recordedReason.includes("OPENAI_API_KEY") &&
    realtimeReason.includes("OPENAI_API_KEY")
  ) {
    return "OPENAI_API_KEY is required for voice mode.";
  }

  return `${recordedReason} ${realtimeReason}`;
}

function ReferenceList({
  references,
}: {
  references: NonNullable<TranscriptTurn["grounding"]>["references"];
}) {
  if (references.length === 0) {
    return null;
  }

  return (
    <ol className="source-reference-list">
      {references.map((reference, index) => {
        const label = reference.title ?? `Citation ${reference.citationId}`;

        return (
          <li key={`${reference.citationId}-${index}`}>
            {reference.url ? (
              <a href={reference.url} rel="noreferrer" target="_blank">
                {label}
              </a>
            ) : (
              <span>{label}</span>
            )}
            {reference.description ? (
              <p className="micro-copy">{reference.description}</p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function SourceGroundingCard({
  grounding,
}: {
  grounding: NonNullable<TranscriptTurn["grounding"]>;
}) {
  if (grounding.kind === "clinical_study_context") {
    return (
      <div className="source-reference-card source-context-card">
        <span className="chat-role">Source Context</span>
        {grounding.assetTitle ? (
          <p className="micro-copy">From {grounding.assetTitle}</p>
        ) : null}
        <p className="source-context-answer">
          {getGroundingAnswerDisplayText(grounding)}
        </p>
        {grounding.references.length > 0 ? (
          <ReferenceList references={grounding.references} />
        ) : (
          <p className="micro-copy">No references were returned.</p>
        )}
      </div>
    );
  }

  if (grounding.references.length === 0) {
    return null;
  }

  return (
    <div className="source-reference-card">
      <span className="chat-role">Grounded Answer Sources</span>
      <ReferenceList references={grounding.references} />
    </div>
  );
}

function ChatTurn({ turn }: { turn: TranscriptTurn }) {
  return (
    <article className={`chat-bubble chat-bubble-${turn.role}`} key={turn.id}>
      <span className="chat-role">
        {turn.role === "interviewer" ? "Interviewer" : "You"}
      </span>
      {turn.grounding ? (
        <SourceGroundingCard grounding={turn.grounding} />
      ) : null}
      <p className="chat-content-text">{getTurnQuestionDisplayText(turn)}</p>
    </article>
  );
}

export function RespondentInterview({
  initialSession,
}: {
  initialSession: RespondentSessionResponse;
}) {
  const [session, setSession] = useState(initialSession);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [assetReactionError, setAssetReactionError] = useState<string | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmittingAssetReaction, setIsSubmittingAssetReaction] =
    useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceSupportKnown, setVoiceSupportKnown] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState<string | null>(null);
  const [realtimeTranscriptPreview, setRealtimeTranscriptPreview] = useState<
    string | null
  >(null);
  const [isRealtimeConnecting, setIsRealtimeConnecting] = useState(false);
  const [isRealtimeActive, setIsRealtimeActive] = useState(false);
  const [lastVoiceTranscript, setLastVoiceTranscript] = useState<string | null>(
    null,
  );
  const [showTyping, setShowTyping] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [isAssetModalOpen, setIsAssetModalOpen] = useState(false);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const stopRecordingResolveRef = useRef<((blob: Blob) => void) | null>(null);
  const sessionRef = useRef(session);
  const realtimePeerRef = useRef<RTCPeerConnection | null>(null);
  const realtimeDataChannelRef = useRef<RTCDataChannel | null>(null);
  const realtimeStreamRef = useRef<MediaStream | null>(null);
  const realtimeAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeProcessingRef = useRef(false);
  const queuedRealtimeTranscriptRef = useRef<string | null>(null);
  const realtimeSessionExpiresAtRef = useRef<string | null>(null);
  const assetUrl = session.currentAsset
    ? resolveAssetUrl(session.currentAsset)
    : null;
  const currentAssetReaction = session.currentAsset?.reaction ?? null;
  const isDownloadLinkAsset =
    session.currentAsset?.displayMode === "DOWNLOAD_LINK";
  const archivedTurns = useMemo(
    () =>
      session.transcript.slice(0, Math.max(0, session.transcript.length - 3)),
    [session.transcript],
  );
  const recentTurns = useMemo(
    () => session.transcript.slice(-Math.min(session.transcript.length, 3)),
    [session.transcript],
  );

  const canSubmit = useMemo(
    () =>
      draft.trim().length > 0 &&
      !isSubmitting &&
      !isRecording &&
      session.status === "active",
    [draft, isRecording, isSubmitting, session.status],
  );
  const canRecord =
    session.status === "active" &&
    !isSubmitting &&
    voiceSupported &&
    session.capabilities.recordedVoice.enabled;
  const canStartRealtime =
    session.status === "active" &&
    !isSubmitting &&
    !isRecording &&
    !isRealtimeConnecting &&
    voiceSupported &&
    session.capabilities.realtimeVoice.enabled;
  const browserVoiceUnavailableReason =
    voiceSupportKnown && !voiceSupported
      ? "Voice is unavailable in this browser."
      : null;
  const recordedVoiceUnavailableReason =
    browserVoiceUnavailableReason ??
    (session.capabilities.recordedVoice.enabled
      ? null
      : session.capabilities.recordedVoice.reason);
  const realtimeVoiceUnavailableReason =
    browserVoiceUnavailableReason ??
    (session.capabilities.realtimeVoice.enabled
      ? null
      : session.capabilities.realtimeVoice.reason);
  const voiceAvailabilityMessage = combineVoiceUnavailableReasons(
    recordedVoiceUnavailableReason,
    realtimeVoiceUnavailableReason,
  );
  const liveTiming = useMemo(
    () => getLiveTimingSnapshot(session.timing, clockNow),
    [clockNow, session.timing],
  );

  useEffect(() => {
    setVoiceSupported(
      typeof navigator !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia) &&
        typeof MediaRecorder !== "undefined",
    );
    setVoiceSupportKnown(true);
  }, []);

  useEffect(() => {
    sessionRef.current = session;
    setClockNow(Date.now());
  }, [session]);

  useEffect(() => {
    setAssetReactionError(null);
  }, [session.currentAsset?.id]);

  useEffect(() => {
    if (session.status !== "active" || !session.timing.startedAt) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [session.status, session.timing.startedAt]);

  useEffect(() => {
    if (!isSubmitting) {
      setShowTyping(false);
      return;
    }

    const timeout = window.setTimeout(() => setShowTyping(true), 240);
    return () => window.clearTimeout(timeout);
  }, [isSubmitting]);

  useEffect(() => {
    return () => {
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      disconnectRealtimeVoice();
    };
  }, []);

  async function submitTextAnswer(
    answer: string,
    options: { intent?: "answer" | "skip" } = {},
  ) {
    setDraft("");
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await submitRespondentAnswer(
        session.sessionId,
        answer,
        options,
      );
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setSession(response.session);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to submit your answer.",
      );
      setDraft(answer);
    } finally {
      setIsSubmitting(false);
      setShowTyping(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }

    await submitTextAnswer(draft.trim());
  }

  async function handleSkipQuestion() {
    if (
      isSubmitting ||
      isRecording ||
      session.status !== "active" ||
      !session.currentQuestion
    ) {
      return;
    }

    await submitTextAnswer("Not sure", { intent: "skip" });
  }

  async function handleAssetReaction(kind: AssetReactionKind) {
    if (
      !session.currentAsset ||
      currentAssetReaction ||
      isSubmittingAssetReaction
    ) {
      return;
    }

    setAssetReactionError(null);
    setIsSubmittingAssetReaction(true);

    try {
      const response = await submitAssetReaction(
        session.sessionId,
        session.currentAsset.id,
        {
          kind,
          status: "COMPLETED",
        },
      );
      setSession(response.session);
    } catch (caughtError) {
      setAssetReactionError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to capture the asset reaction.",
      );
    } finally {
      setIsSubmittingAssetReaction(false);
    }
  }

  function stopMediaStream() {
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
  }

  async function startVoiceRecording() {
    if (!canRecord) {
      setError(
        recordedVoiceUnavailableReason ??
          "Voice recording is not available right now.",
      );
      return;
    }

    try {
      setError(null);
      setVoiceStatus("Recording...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );

      mediaStreamRef.current = stream;
      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        stopMediaStream();
        stopRecordingResolveRef.current?.(audioBlob);
        stopRecordingResolveRef.current = null;
      });

      recorder.start();
      setIsRecording(true);
    } catch (caughtError) {
      stopMediaStream();
      setIsRecording(false);
      setVoiceStatus(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to start voice recording.",
      );
    }
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve(null);
    }

    return new Promise<Blob>((resolve) => {
      stopRecordingResolveRef.current = resolve;
      recorder.stop();
      setIsRecording(false);
      setVoiceStatus("Transcribing...");
    });
  }

  async function submitVoiceBlob(audioBlob: Blob) {
    setError(null);
    setIsSubmitting(true);

    try {
      const audioBase64 = await blobToBase64(audioBlob);
      const response = await submitRespondentVoiceAnswer(session.sessionId, {
        audioBase64,
        mimeType: audioBlob.type || "audio/webm",
        voice: "coral",
      });

      setLastVoiceTranscript(response.transcript);
      setVoiceStatus("Preparing response...");
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      setSession(response.answer.session);

      if (response.audio) {
        try {
          await playBase64Audio(response.audio);
          setVoiceStatus("Response played.");
        } catch {
          setVoiceStatus("Response ready. Browser playback was blocked.");
        }
      } else {
        setVoiceStatus("Voice answer submitted.");
      }
    } catch (caughtError) {
      setVoiceStatus(null);
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to submit your voice answer.",
      );
    } finally {
      setIsSubmitting(false);
      setShowTyping(false);
    }
  }

  async function handleVoiceButton() {
    if (isRecording) {
      const audioBlob = await stopVoiceRecording();
      if (audioBlob) {
        await submitVoiceBlob(audioBlob);
      }
      return;
    }

    await startVoiceRecording();
  }

  function sendRealtimeEvent(payload: unknown) {
    const dataChannel = realtimeDataChannelRef.current;
    if (!dataChannel || dataChannel.readyState !== "open") {
      return false;
    }

    dataChannel.send(JSON.stringify(payload));
    return true;
  }

  function speakWithRealtime(text: string | null) {
    if (!text) {
      return;
    }

    setRealtimeStatus("Speaking...");
    sendRealtimeEvent({
      type: "response.create",
      response: {
        conversation: "none",
        output_modalities: ["audio", "text"],
        instructions:
          "Read the provided survey interviewer message aloud in a warm, natural voice. Do not add, remove, summarize, or answer questions.",
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Read this exact interviewer message:\n${text}`,
              },
            ],
          },
        ],
      },
    });
  }

  async function submitRealtimeTranscript(
    transcript: string,
    options: {
      sourceEventType?:
        | "conversation.item.input_audio_transcription.completed"
        | "manual_realtime_transcript";
      transcriptItemId?: string | null;
    } = {},
  ) {
    const cleanedTranscript = transcript.trim();
    if (!cleanedTranscript) {
      return;
    }

    if (realtimeProcessingRef.current) {
      queuedRealtimeTranscriptRef.current = cleanedTranscript;
      setRealtimeStatus("Queued your latest voice answer...");
      return;
    }

    realtimeProcessingRef.current = true;
    setLastVoiceTranscript(cleanedTranscript);
    setRealtimeTranscriptPreview(null);
    setRealtimeStatus("Heard you. Selecting the next question...");
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await submitRespondentRealtimeAnswer(
        sessionRef.current.sessionId,
        {
          content: cleanedTranscript,
          sourceEventType:
            options.sourceEventType ??
            "conversation.item.input_audio_transcription.completed",
          transcriptItemId: options.transcriptItemId ?? null,
          realtimeSessionExpiresAt: realtimeSessionExpiresAtRef.current,
          transport: "openai_realtime_webrtc",
        },
      );
      setSession(response.session);
      sessionRef.current = response.session;

      const interviewerText = getLatestInterviewerText(response.session);
      if (interviewerText) {
        speakWithRealtime(interviewerText);
      } else {
        setRealtimeStatus("Live voice is listening.");
      }
    } catch (caughtError) {
      setRealtimeStatus("Live voice is still connected.");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to process the live voice answer.",
      );
    } finally {
      setIsSubmitting(false);
      setShowTyping(false);
      realtimeProcessingRef.current = false;

      const queuedTranscript = queuedRealtimeTranscriptRef.current;
      queuedRealtimeTranscriptRef.current = null;
      if (queuedTranscript) {
        window.setTimeout(() => {
          void submitRealtimeTranscript(queuedTranscript, {
            sourceEventType: "manual_realtime_transcript",
          });
        }, 0);
      }
    }
  }

  function handleRealtimeServerEvent(event: RealtimeServerEvent) {
    if (event.type === "error") {
      setError(event.error?.message ?? "Live voice returned an error.");
      setRealtimeStatus("Live voice error.");
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      setRealtimeStatus("Listening...");
      setRealtimeTranscriptPreview(null);
      return;
    }

    if (event.type === "input_audio_buffer.speech_stopped") {
      setRealtimeStatus("Processing speech...");
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.delta") {
      if (event.delta) {
        setRealtimeTranscriptPreview(
          (current) => `${current ?? ""}${event.delta}`,
        );
      }
      return;
    }

    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      event.transcript
    ) {
      void submitRealtimeTranscript(event.transcript, {
        sourceEventType: event.type,
        transcriptItemId: event.item_id ?? event.item?.id ?? null,
      });
      return;
    }

    if (event.type === "conversation.item.input_audio_transcription.failed") {
      setRealtimeStatus("I couldn't catch that. Please try again.");
      return;
    }

    if (event.type === "response.done") {
      const responseError = event.response?.status_details?.error?.message;
      if (event.response?.status === "failed" && responseError) {
        setError(responseError);
        setRealtimeStatus("Live voice response failed.");
        return;
      }

      if (isRealtimeActive) {
        setRealtimeStatus("Live voice is listening.");
      }
    }
  }

  function disconnectRealtimeVoice() {
    realtimeDataChannelRef.current?.close();
    realtimeDataChannelRef.current = null;
    realtimePeerRef.current?.close();
    realtimePeerRef.current = null;
    realtimeStreamRef.current?.getTracks().forEach((track) => track.stop());
    realtimeStreamRef.current = null;
    realtimeAudioRef.current?.remove();
    realtimeAudioRef.current = null;
    realtimeSessionExpiresAtRef.current = null;
    realtimeProcessingRef.current = false;
    queuedRealtimeTranscriptRef.current = null;
    setIsRealtimeActive(false);
    setIsRealtimeConnecting(false);
    setRealtimeTranscriptPreview(null);
    setRealtimeStatus(null);
  }

  async function startRealtimeVoice() {
    if (!canStartRealtime) {
      setError(
        realtimeVoiceUnavailableReason ??
          "Live voice is not available right now.",
      );
      return;
    }

    setIsRealtimeConnecting(true);
    setRealtimeStatus("Preparing live voice...");
    setError(null);

    let peer: RTCPeerConnection | null = null;
    let stream: MediaStream | null = null;

    try {
      const response = await createRealtimeVoiceSession(session.sessionId);
      if (!response.enabled || !response.clientSecret) {
        setRealtimeStatus(response.reason ?? "Live voice is not configured.");
        return;
      }
      realtimeSessionExpiresAtRef.current = response.expiresAt;

      peer = new RTCPeerConnection();
      realtimePeerRef.current = peer;

      const audioElement = document.createElement("audio");
      audioElement.autoplay = true;
      audioElement.setAttribute("aria-hidden", "true");
      audioElement.style.display = "none";
      document.body.appendChild(audioElement);
      realtimeAudioRef.current = audioElement;

      peer.ontrack = (event) => {
        audioElement.srcObject = event.streams[0];
      };

      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      realtimeStreamRef.current = stream;
      const microphoneStream = stream;
      microphoneStream
        .getAudioTracks()
        .forEach((track) => peer?.addTrack(track, microphoneStream));

      const dataChannel = peer.createDataChannel("oai-events");
      realtimeDataChannelRef.current = dataChannel;

      dataChannel.addEventListener("open", () => {
        setIsRealtimeActive(true);
        setRealtimeStatus("Live voice connected.");
        speakWithRealtime(getLatestInterviewerText(sessionRef.current));
      });

      dataChannel.addEventListener("message", (event) => {
        try {
          handleRealtimeServerEvent(
            JSON.parse(event.data) as RealtimeServerEvent,
          );
        } catch {
          // Ignore non-JSON data channel messages.
        }
      });

      dataChannel.addEventListener("close", () => {
        setIsRealtimeActive(false);
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      const sdpResponse = await fetch(OPENAI_REALTIME_CALL_URL, {
        method: "POST",
        body: offer.sdp ?? "",
        headers: {
          Authorization: `Bearer ${response.clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });

      if (!sdpResponse.ok) {
        throw new Error(
          `Realtime connection failed with ${sdpResponse.status}: ${await sdpResponse.text()}`,
        );
      }

      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
    } catch (caughtError) {
      peer?.close();
      stream?.getTracks().forEach((track) => track.stop());
      disconnectRealtimeVoice();
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to start live voice.",
      );
    } finally {
      setIsRealtimeConnecting(false);
    }
  }

  async function handleRealtimeVoiceButton() {
    if (isRealtimeActive || isRealtimeConnecting) {
      disconnectRealtimeVoice();
      return;
    }

    await startRealtimeVoice();
  }

  return (
    <div className="chat-shell">
      <header className="chat-header">
        <p className="eyebrow">Respondent View</p>
        <h1>{session.studyName}</h1>
        <p className="lede chat-lede">
          One question at a time. Your responses are stored with an audit trail
          for the researcher console.
        </p>
        <div
          className={`timing-strip ${
            liveTiming.isOverTime ? "timing-strip-overtime" : ""
          }`}
          aria-label="Survey time remaining"
        >
          <div className="timing-copy">
            <span className="label">
              {liveTiming.isOverTime ? "Time Limit" : "Time Remaining"}
            </span>
            <strong>{formatSeconds(liveTiming.remainingSeconds)}</strong>
          </div>
          <div className="timing-meter" aria-hidden="true">
            <span style={{ width: `${liveTiming.elapsedPercent}%` }} />
          </div>
          {liveTiming.isOverTime && session.status === "active" ? (
            <p className="micro-copy">
              The target time has been reached. Submit your current answer to
              finish the survey.
            </p>
          ) : null}
        </div>
      </header>

      <div className="respondent-layout">
        <section className="stack-md">
          {archivedTurns.length > 0 ? (
            <section className="transcript-archive">
              <div className="transcript-archive-header">
                <div className="stack-sm">
                  <span className="label">Earlier Conversation</span>
                  <p className="muted-copy">
                    {archivedTurns.length} earlier turns hidden so you can stay
                    focused on the current exchange.
                  </p>
                </div>
                <button
                  className="button-secondary"
                  onClick={() => setShowArchive((current) => !current)}
                  type="button"
                >
                  {showArchive ? "Collapse History" : "Show History"}
                </button>
              </div>

              {showArchive ? (
                <div className="transcript-archive-list">
                  {archivedTurns.map((turn) => (
                    <div className="chat-bubble-archived" key={turn.id}>
                      <ChatTurn turn={turn} />
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          <section className="chat-thread">
            <div className="chat-thread-header">
              <div className="stack-sm">
                <span className="label">Live Interview</span>
                <p className="muted-copy">
                  The newest exchange stays expanded while older turns collapse
                  above.
                </p>
              </div>
            </div>

            {recentTurns.map((turn) => (
              <ChatTurn key={turn.id} turn={turn} />
            ))}

            {showTyping && session.status === "active" ? (
              <article className="chat-bubble chat-bubble-interviewer chat-bubble-typing">
                <span className="chat-role">Interviewer</span>
                <p>Typing the next question...</p>
              </article>
            ) : null}
          </section>

          {session.status === "completed" ? (
            <section className="thank-you-card">
              <h2>Thanks for your time.</h2>
              <p>{session.thankYouMessage}</p>
            </section>
          ) : (
            <form className="composer" onSubmit={handleSubmit}>
              <label className="composer-label" htmlFor="response">
                {session.currentQuestion?.title ?? "Your response"}
                {session.currentQuestion &&
                session.currentQuestion.maxAttempts > 1 &&
                session.currentQuestion.attemptCount > 0 ? (
                  <span className="attempt-count">
                    Attempt {session.currentQuestion.attemptCount + 1} of{" "}
                    {session.currentQuestion.maxAttempts}
                  </span>
                ) : null}
              </label>
              <textarea
                id="response"
                className="composer-input"
                disabled={isSubmitting || isRecording}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type your answer here..."
                rows={4}
                value={draft}
              />
              <div className="composer-footer">
                <p className="composer-hint">
                  {session.currentQuestion?.prompt ?? "Interview complete"}
                </p>
                <div className="composer-actions">
                  <button
                    className="button-secondary"
                    disabled={
                      isSubmitting ||
                      isRecording ||
                      session.status !== "active" ||
                      !session.currentQuestion
                    }
                    onClick={handleSkipQuestion}
                    type="button"
                  >
                    Skip / Not sure
                  </button>
                  <button
                    className={`button-secondary voice-button ${
                      isRecording ? "voice-button-recording" : ""
                    }`}
                    disabled={!isRecording && !canRecord}
                    onClick={handleVoiceButton}
                    title={recordedVoiceUnavailableReason ?? undefined}
                    type="button"
                  >
                    {isRecording ? "Stop Recording" : "Record Answer"}
                  </button>
                  <button
                    className={`button-secondary live-voice-button ${
                      isRealtimeActive ? "live-voice-button-active" : ""
                    }`}
                    disabled={
                      (!isRealtimeActive && !canStartRealtime) || isRecording
                    }
                    onClick={handleRealtimeVoiceButton}
                    title={realtimeVoiceUnavailableReason ?? undefined}
                    type="button"
                  >
                    {isRealtimeActive
                      ? "End Live Voice"
                      : isRealtimeConnecting
                        ? "Connecting..."
                        : "Live Voice"}
                  </button>
                  <button
                    className="button-primary"
                    disabled={!canSubmit}
                    type="submit"
                  >
                    {isSubmitting ? "Sending..." : "Send Answer"}
                  </button>
                </div>
              </div>
              {voiceStatus ? (
                <p className="composer-voice-status">{voiceStatus}</p>
              ) : null}
              {voiceAvailabilityMessage ? (
                <p className="composer-voice-status">
                  {voiceAvailabilityMessage}
                </p>
              ) : null}
              {lastVoiceTranscript ? (
                <p className="composer-voice-status">
                  Heard: {lastVoiceTranscript}
                </p>
              ) : null}
              {realtimeTranscriptPreview ? (
                <p className="composer-voice-status">
                  Hearing: {realtimeTranscriptPreview}
                </p>
              ) : null}
              {realtimeStatus ? (
                <p className="composer-voice-status">{realtimeStatus}</p>
              ) : null}
              {error ? <p className="inline-error">{error}</p> : null}
            </form>
          )}
        </section>

        <aside className="asset-pane">
          <div className="asset-pane-header">
            <div className="stack-sm">
              <span className="label">Current Interview Action</span>
              <strong>
                {session.currentAction?.actionType ?? "ASK_QUESTION"}
              </strong>
            </div>
          </div>

          {session.currentAsset ? (
            <article className="asset-card">
              <div className="stack-sm">
                <span className="label">Staged Asset</span>
                <h2>{session.currentAsset.title}</h2>
                <p className="muted-copy">
                  {session.currentAsset.description ??
                    "This interview step is paired with a staged research asset."}
                </p>
              </div>

              <div className="asset-preview">
                <div className="asset-preview-header">
                  <p className="asset-preview-title">
                    {session.currentAsset.assetType}
                  </p>
                  <div className="asset-preview-actions">
                    {assetUrl ? (
                      <>
                        {isDownloadLinkAsset ? null : (
                          <button
                            className="button-secondary"
                            onClick={() => setIsAssetModalOpen(true)}
                            type="button"
                          >
                            Enlarge Asset
                          </button>
                        )}
                        <a
                          className="text-link"
                          href={assetUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open Asset
                        </a>
                      </>
                    ) : null}
                  </div>
                </div>
                {assetUrl ? (
                  <AssetViewer
                    asset={session.currentAsset}
                    assetUrl={assetUrl}
                    variant="inline"
                  />
                ) : (
                  <p className="muted-copy">
                    {session.currentAsset.storageKey}
                  </p>
                )}
              </div>

              <div className="asset-reaction-panel">
                <div className="stack-sm">
                  <span className="label">Material Reaction</span>
                  {currentAssetReaction ? (
                    <p className="micro-copy">
                      Captured:{" "}
                      {formatAssetReactionKind(currentAssetReaction.kind)}
                    </p>
                  ) : null}
                </div>
                <div className="asset-reaction-actions">
                  {ASSET_REACTION_OPTIONS.map((option) => (
                    <button
                      className={`button-secondary asset-reaction-button ${
                        currentAssetReaction?.kind === option.kind
                          ? "asset-reaction-button-selected"
                          : ""
                      }`}
                      disabled={
                        Boolean(currentAssetReaction) ||
                        isSubmittingAssetReaction ||
                        session.status !== "active"
                      }
                      key={option.kind}
                      onClick={() => handleAssetReaction(option.kind)}
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                {assetReactionError ? (
                  <p className="inline-error">{assetReactionError}</p>
                ) : null}
              </div>

              <dl className="asset-meta">
                <dt>Key</dt>
                <dd>{session.currentAsset.key}</dd>
                <dt>Source</dt>
                <dd>{session.currentAsset.storageKey}</dd>
                <dt>Display</dt>
                <dd>{session.currentAsset.displayMode ?? "inline pane"}</dd>
                <dt>Shown</dt>
                <dd>
                  {session.currentAsset.shownAt ?? "staged for current turn"}
                </dd>
              </dl>
            </article>
          ) : (
            <article className="asset-card">
              <div className="stack-sm">
                <span className="label">Staged Asset</span>
                <h2>No Asset Staged</h2>
                <p className="muted-copy">
                  This turn is running as a chat-only question with no active
                  asset pane.
                </p>
              </div>
            </article>
          )}
        </aside>
      </div>

      {session.currentAsset &&
      assetUrl &&
      !isDownloadLinkAsset &&
      isAssetModalOpen ? (
        <div
          aria-modal="true"
          className="asset-modal"
          onClick={() => setIsAssetModalOpen(false)}
          role="dialog"
        >
          <div
            className="asset-modal-panel"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="asset-modal-header">
              <div className="stack-sm">
                <span className="label">Asset Review</span>
                <h2>{session.currentAsset.title}</h2>
                <p className="muted-copy">
                  Review the material, then return to the interviewer prompt.
                </p>
              </div>
              <button
                aria-label="Close asset view"
                className="button-secondary"
                onClick={() => setIsAssetModalOpen(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <AssetViewer
              asset={session.currentAsset}
              assetUrl={assetUrl}
              variant="modal"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
