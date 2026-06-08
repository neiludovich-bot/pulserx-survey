"use client";

import type { FormEvent, MouseEvent, ReactNode } from "react";
import type {
  MvpCustomGptSourcePreviewResponse,
  MvpCustomGptSurveyMessage,
  MvpCustomGptSurveyResponse,
} from "@interview/schemas";
import { useEffect, useRef, useState } from "react";
import {
  previewMvpCustomGptSource,
  startMvpCustomGptSurvey,
  submitMvpCustomGptSurveyTurn,
  synthesizeMvpCustomGptSurveySpeech,
  transcribeMvpCustomGptSurveyVoice,
} from "../api";

function formatSeconds(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

const MIN_RESPONSE_PACING_MS = 750;
const MVP_INTERVIEWER_VOICE = "nova";

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function preserveResponsePacing(startedAt: number) {
  const elapsed = performance.now() - startedAt;
  const remaining = MIN_RESPONSE_PACING_MS - elapsed;
  if (remaining > 0) {
    await wait(remaining);
  }
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

function audioDataUrl(mimeType: string, base64: string) {
  return `data:${mimeType};base64,${base64}`;
}

function formatVoiceError(error: unknown) {
  if (!(error instanceof Error)) {
    return "Unable to start voice recording.";
  }

  if (
    error.name === "NotAllowedError" ||
    /permission denied|not allowed/i.test(error.message)
  ) {
    return "Microphone permission was denied. Allow microphone access for this site, or open this page in Chrome/Edge and allow the mic prompt.";
  }

  if (
    error.name === "NotFoundError" ||
    /device not found|no microphone/i.test(error.message)
  ) {
    return "No microphone was found. Check your input device and browser microphone settings.";
  }

  return error.message || "Unable to start voice recording.";
}

type SourcePanelReference = {
  messageId: string;
  index: number;
  reference: MvpCustomGptSurveyMessage["references"][number];
  preview?: MvpCustomGptSourcePreviewResponse | null;
};

type SourcePreviewImage = MvpCustomGptSourcePreviewResponse["images"][number];

type ExpandedSourceImage = {
  image: SourcePreviewImage;
  caption: string;
  label: string;
};

type OpenReferenceHandler = (
  input: SourcePanelReference,
  event?: MouseEvent<HTMLAnchorElement>,
) => void;

function getSourceHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function getReferenceLabel(
  reference: MvpCustomGptSurveyMessage["references"][number],
  index: number,
) {
  return reference.title ?? reference.description ?? `Reference ${index}`;
}

function normalizeSourceText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sourceTextIncludesAny(value: string, terms: string[]) {
  const normalized = ` ${normalizeSourceText(value)} `;

  return terms.some((term) =>
    normalized.includes(` ${normalizeSourceText(term)} `),
  );
}

function referenceSearchText(
  reference: MvpCustomGptSurveyMessage["references"][number],
  index: number,
) {
  return [
    getReferenceLabel(reference, index),
    reference.description,
    reference.url,
    reference.citationId,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ");
}

function shouldAutoPreviewReference(input: SourcePanelReference, messageText: string) {
  const topicText = messageText;
  const referenceText = referenceSearchText(input.reference, input.index);
  const safetyTopic =
    sourceTextIncludesAny(topicText, [
      "safety",
      "tolerability",
      "adverse",
      "side effect",
      "side effects",
      "neuropathy",
      "peripheral neuropathy",
      "rash",
      "skin",
      "hyperglycemia",
      "pneumonitis",
      "ild",
      "ocular",
      "dose interruption",
      "dose reduction",
      "dose modification",
    ]) &&
    !sourceTextIncludesAny(topicText, [
      "pfs",
      "progression free",
      "overall survival",
      "os",
      "efficacy graph",
      "survival graph",
    ]);

  if (!safetyTopic) {
    return true;
  }

  const safetyReference = sourceTextIncludesAny(referenceText, [
    "safety",
    "important safety",
    "isi",
    "prescribing information",
    "dosing",
    "administration",
    "dose modification",
    "adverse",
    "neuropathy",
    "rash",
    "skin",
    "hyperglycemia",
    "pneumonitis",
    "ocular",
  ]);
  const efficacyReference = sourceTextIncludesAny(referenceText, [
    "efficacy",
    "pfs",
    "progression free",
    "overall survival",
    "survival",
    "orr",
    "response",
    "monotherapy efficacy",
    "ev-302",
    "ev 302",
    "ev-301",
    "ev 301",
  ]);

  return safetyReference && !efficacyReference;
}

function shouldEmbedSourceUrl(url: string) {
  try {
    const parsed = new URL(url);
    const isLocalAsset =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isPreviewableFile = /\.(pdf|png|jpe?g|webp|gif)$/i.test(
      parsed.pathname,
    );

    return isLocalAsset || isPreviewableFile;
  } catch {
    return false;
  }
}

async function resolveVisualSourcePanelReference(
  input: SourcePanelReference,
): Promise<SourcePanelReference | null> {
  const sourceUrl = input.reference.url;
  if (!sourceUrl || shouldEmbedSourceUrl(sourceUrl)) {
    return input;
  }

  try {
    const preview = await previewMvpCustomGptSource({
      url: sourceUrl,
      title: getReferenceLabel(input.reference, input.index),
    });

    return preview.images.length > 0 ? { ...input, preview } : null;
  } catch {
    return null;
  }
}

function openSourceUrlInNewTab(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function normalizeClinicalMarkup(content: string) {
  return content
    .replace(/\$\$?\s*IC_\{?50\}?\s*\$\$?/gi, "IC50")
    .replace(/\$\$?\s*([A-Za-z]+)_\{?(\d+)\}?\s*\$\$?/g, "$1$2")
    .replace(/\$\$?\s*([^$]+?)\s*\$\$?/g, "$1");
}

function SourcePreviewGallery({
  preview,
  label,
  onExpandImage,
}: {
  preview: MvpCustomGptSourcePreviewResponse;
  label: string;
  onExpandImage: (image: ExpandedSourceImage) => void;
}) {
  if (preview.images.length === 0) {
    return (
      <div className="mvp-source-preview-card">
        <p className="mvp-kicker">Preview unavailable</p>
        <h3>{label}</h3>
        <p>
          {preview.reason ??
            "This source blocks embedded viewing and did not expose a usable figure preview."}
        </p>
        <span>{getSourceHost(preview.sourceUrl)}</span>
      </div>
    );
  }

  return (
    <div className="mvp-source-preview-gallery">
      <p className="mvp-kicker">Source figures</p>
      <h3>{label}</h3>
      <div className="mvp-source-image-list">
        {preview.images.map((image, index) => {
          const caption =
            image.alt ??
            `Figure ${index + 1} from ${getSourceHost(preview.sourceUrl)}`;
          return (
            <figure className="mvp-source-image" key={image.url}>
              <div className="mvp-source-image-preview">
                <a href={image.url} rel="noreferrer" target="_blank">
                  <img
                    alt={image.alt ?? `${label} figure ${index + 1}`}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                    referrerPolicy="no-referrer"
                    src={image.url}
                  />
                </a>
                <button
                  aria-label={`Expand figure: ${caption}`}
                  className="mvp-source-image-expand"
                  onClick={() => onExpandImage({ image, caption, label })}
                  type="button"
                >
                  Expand
                </button>
              </div>
              <figcaption>{caption}</figcaption>
            </figure>
          );
        })}
      </div>
      <p className="mvp-source-preview-note">
        These are pulled from the cited page assets. Use the source link below
        for the full page context and prescribing information.
      </p>
    </div>
  );
}

function ExpandedSourceImageModal({
  image,
  onClose,
}: {
  image: ExpandedSourceImage;
  onClose: () => void;
}) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      aria-label="Expanded source figure"
      aria-modal="true"
      className="mvp-image-modal-backdrop"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="mvp-image-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mvp-image-modal-header">
          <div>
            <p className="mvp-kicker">Source figure</p>
            <h2>{image.label}</h2>
          </div>
          <button aria-label="Close expanded figure" onClick={onClose} type="button">
            Close
          </button>
        </header>
        <div className="mvp-image-modal-stage">
          <img
            alt={image.caption}
            referrerPolicy="no-referrer"
            src={image.image.url}
          />
        </div>
        <footer className="mvp-image-modal-footer">
          <p>{image.caption}</p>
          <a href={image.image.url} rel="noreferrer" target="_blank">
            Open image in new tab
          </a>
        </footer>
      </div>
    </div>
  );
}

function ReferenceList({
  message,
  onOpenReference,
}: {
  message: MvpCustomGptSurveyMessage;
  onOpenReference: OpenReferenceHandler;
}) {
  if (message.references.length === 0) {
    return null;
  }

  return (
    <div className="mvp-reference-list" aria-label="References">
      {message.references.map((reference, index) => {
        const label = getReferenceLabel(reference, index + 1);
        const marker = <span className="mvp-reference-number">{index + 1}</span>;
        return reference.url ? (
          <a
            className="mvp-reference"
            href={reference.url}
            key={`${message.id}-${reference.citationId}`}
            onClick={(event) =>
              onOpenReference(
                {
                  messageId: message.id,
                  index: index + 1,
                  reference,
                },
                event,
              )
            }
            rel="noreferrer"
            target="_blank"
            title={label}
          >
            {marker}
            <span className="mvp-reference-label">{label}</span>
          </a>
        ) : (
          <span
            className="mvp-reference"
            key={`${message.id}-${reference.citationId}`}
            title={label}
          >
            {marker}
            <span className="mvp-reference-label">{label}</span>
          </span>
        );
      })}
    </div>
  );
}

function CitationMarker({
  index,
  reference,
  messageId,
  onOpenReference,
}: {
  index: number;
  reference?: MvpCustomGptSurveyMessage["references"][number];
  messageId: string;
  onOpenReference: OpenReferenceHandler;
}) {
  const label = reference
    ? getReferenceLabel(reference, index)
    : `Reference ${index}`;

  if (reference?.url) {
    return (
      <a
        aria-label={`Open reference ${index}: ${label}`}
        className="mvp-inline-citation"
        href={reference.url}
        onClick={(event) =>
          onOpenReference(
            {
              messageId,
              index,
              reference,
            },
            event,
          )
        }
        rel="noreferrer"
        target="_blank"
        title={label}
      >
        {index}
      </a>
    );
  }

  return (
    <span
      aria-label={`Reference ${index}: ${label}`}
      className="mvp-inline-citation"
      title={label}
    >
      {index}
    </span>
  );
}

function renderMessageContentPart(
  message: MvpCustomGptSurveyMessage,
  content: string,
  onOpenReference: OpenReferenceHandler,
  keyPrefix: string,
) {
  const nodes: ReactNode[] = [];
  const inlinePattern = /\*\*([^*]+)\*\*|\[(\d{1,2})\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = inlinePattern.exec(content)) !== null) {
    const boldText = match[1];
    if (boldText) {
      if (match.index > lastIndex) {
        nodes.push(content.slice(lastIndex, match.index));
      }

      nodes.push(
        <strong key={`${message.id}-${keyPrefix}-bold-${match.index}`}>
          {renderMessageContentPart(
            message,
            boldText,
            onOpenReference,
            `${keyPrefix}-bold-${match.index}`,
          )}
        </strong>,
      );
      lastIndex = match.index + match[0].length;
      continue;
    }

    const markerText = match[0];
    const referenceIndex = Number(match[2]);
    const reference = message.references[referenceIndex - 1];

    if (!reference || referenceIndex < 1) {
      continue;
    }

    if (match.index > lastIndex) {
      nodes.push(content.slice(lastIndex, match.index));
    }

    nodes.push(
      <CitationMarker
        index={referenceIndex}
        key={`${message.id}-${keyPrefix}-citation-${match.index}-${referenceIndex}`}
        messageId={message.id}
        onOpenReference={onOpenReference}
        reference={reference}
      />,
    );
    lastIndex = match.index + markerText.length;
  }

  if (lastIndex < content.length) {
    nodes.push(content.slice(lastIndex));
  }

  return nodes.length ? nodes : content;
}

function getFinalQuestionStart(content: string) {
  const questionEndIndex = content.lastIndexOf("?");

  if (questionEndIndex < 0) {
    return -1;
  }

  const questionPrefix = content.slice(0, questionEndIndex + 1);
  const match = questionPrefix.match(/(?:^|[.!?]\s+)([^.!?]*\?\s*)$/s);

  return match ? questionPrefix.length - match[1].length : 0;
}

function renderQuestionParagraph(
  message: MvpCustomGptSurveyMessage,
  paragraph: string,
  onOpenReference: OpenReferenceHandler,
  keyPrefix: string,
) {
  const questionStartIndex = getFinalQuestionStart(paragraph);

  if (questionStartIndex <= 0) {
    return (
      <span className="mvp-message-question">
        {renderMessageContentPart(
          message,
          paragraph,
          onOpenReference,
          `${keyPrefix}-question`,
        )}
      </span>
    );
  }

  const context = paragraph.slice(0, questionStartIndex).trimEnd();
  const question = paragraph.slice(questionStartIndex).trimStart();

  return (
    <>
      {renderMessageContentPart(
        message,
        context,
        onOpenReference,
        `${keyPrefix}-context`,
      )}
      {" "}
      <span className="mvp-message-question">
        {renderMessageContentPart(
          message,
          question,
          onOpenReference,
          `${keyPrefix}-question`,
        )}
      </span>
    </>
  );
}

function renderMessageContent(
  message: MvpCustomGptSurveyMessage,
  onOpenReference: OpenReferenceHandler,
) {
  const paragraphs = normalizeClinicalMarkup(message.content).split(/\n{2,}/);
  let questionParagraphIndex = -1;

  if (message.role === "interviewer") {
    for (let index = paragraphs.length - 1; index >= 0; index -= 1) {
      if (getFinalQuestionStart(paragraphs[index]?.trim() ?? "") >= 0) {
        questionParagraphIndex = index;
        break;
      }
    }
  }

  return (
    <div className="mvp-message-body">
      {paragraphs.map((paragraph, index) => (
        <p key={`${message.id}-paragraph-${index}`}>
          {index === questionParagraphIndex
            ? renderQuestionParagraph(
                message,
                paragraph,
                onOpenReference,
                `paragraph-${index}`,
              )
            : renderMessageContentPart(
                message,
                paragraph,
                onOpenReference,
                `paragraph-${index}`,
              )}
        </p>
      ))}
    </div>
  );
}

function SourcePanel({
  source,
  onClose,
}: {
  source: SourcePanelReference;
  onClose: () => void;
}) {
  const label = getReferenceLabel(source.reference, source.index);
  const sourceUrl = source.reference.url;
  const canEmbedSource = sourceUrl ? shouldEmbedSourceUrl(sourceUrl) : false;
  const [preview, setPreview] =
    useState<MvpCustomGptSourcePreviewResponse | null>(
      source.preview ?? null,
    );
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [expandedImage, setExpandedImage] =
    useState<ExpandedSourceImage | null>(null);

  useEffect(() => {
    let isCancelled = false;

    setPreview(null);
    setPreviewError(null);

    if (source.preview) {
      setPreview(source.preview);
      setIsPreviewLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    if (!sourceUrl || canEmbedSource) {
      setIsPreviewLoading(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsPreviewLoading(true);
    void previewMvpCustomGptSource({ url: sourceUrl, title: label })
      .then((result) => {
        if (!isCancelled) {
          setPreview(result);
        }
      })
      .catch((error: unknown) => {
        if (!isCancelled) {
          setPreviewError(
            error instanceof Error
              ? error.message
              : "Unable to load source images.",
          );
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsPreviewLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [canEmbedSource, label, source.preview, sourceUrl]);

  return (
    <>
      <aside className="mvp-source-panel" aria-label="Citation source">
      <header className="mvp-source-panel-header">
        <div>
          <p className="mvp-kicker">Source</p>
          <h2>
            <span>{source.index}</span>
            {label}
          </h2>
        </div>
        <button aria-label="Close source panel" onClick={onClose} type="button">
          Close
        </button>
      </header>
      {sourceUrl ? (
        <>
          {canEmbedSource ? (
            <iframe
              className="mvp-source-frame"
              src={sourceUrl}
              title={label}
            />
          ) : (
            <div className="mvp-source-preview-fallback">
              {isPreviewLoading ? (
                <div className="mvp-source-preview-card">
                  <p className="mvp-kicker">Looking for figures</p>
                  <h3>{label}</h3>
                  <p>Scanning the cited page for relevant visual assets.</p>
                  <span>{getSourceHost(sourceUrl)}</span>
                </div>
              ) : preview ? (
                <SourcePreviewGallery
                  label={label}
                  onExpandImage={setExpandedImage}
                  preview={preview}
                />
              ) : (
                <div className="mvp-source-preview-card">
                  <p className="mvp-kicker">Preview unavailable</p>
                  <h3>{label}</h3>
                  <p>
                    {previewError ??
                      "This source blocks embedded viewing, so it has to open in a separate tab. The survey will stay open here."}
                  </p>
                  <span>{getSourceHost(sourceUrl)}</span>
                </div>
              )}
            </div>
          )}
          <a
            className="mvp-source-open-link"
            href={sourceUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open source in new tab
          </a>
        </>
      ) : (
        <div className="mvp-source-empty">
          This reference did not include a source URL.
        </div>
      )}
      </aside>
      {expandedImage ? (
        <ExpandedSourceImageModal
          image={expandedImage}
          onClose={() => setExpandedImage(null)}
        />
      ) : null}
    </>
  );
}

function MessageBubble({
  message,
  onOpenReference,
}: {
  message: MvpCustomGptSurveyMessage;
  onOpenReference: OpenReferenceHandler;
}) {
  return (
    <article className={`mvp-message mvp-message-${message.role}`}>
      <div className="mvp-message-meta">
        {message.role === "interviewer" ? "Interviewer" : "You"}
      </div>
      {renderMessageContent(message, onOpenReference)}
      <ReferenceList message={message} onOpenReference={onOpenReference} />
    </article>
  );
}

type MvpCustomGptSurveyModalProps = {
  surveySlug?: string;
  studyName?: string;
  targetDurationSeconds?: number;
};

type SurveyIntentOption = {
  slug: string;
  label: string;
  description: string;
};

const PADCEV_INTENT_OPTIONS: SurveyIntentOption[] = [
  {
    slug: "general-padcev-reaction",
    label: "General PADCEV Reaction",
    description: "Balanced pass across evidence, safety, fit, and implementation.",
  },
  {
    slug: "ev302-first-line-evidence",
    label: "EV-302 / First-Line Evidence",
    description: "Focus on first-line PADCEV plus pembrolizumab evidence.",
  },
  {
    slug: "side-effect-management",
    label: "Side Effect Management",
    description: "Focus on monitoring, counseling, and managing adverse events.",
  },
  {
    slug: "patient-selection-barriers",
    label: "Patient Selection & Barriers",
    description: "Focus on patient fit, cautions, barriers, and confidence gaps.",
  },
  {
    slug: "familiar-whats-new",
    label: "Already Familiar: What's New",
    description: "Skip the basics and focus on newer or underappreciated points.",
  },
];

export function MvpCustomGptSurveyModal({
  surveySlug = "brukinsa",
  studyName = "BRUKINSA HCP MVP",
  targetDurationSeconds = 600,
}: MvpCustomGptSurveyModalProps = {}) {
  const intentOptions =
    surveySlug === "padcev" ? PADCEV_INTENT_OPTIONS : [];
  const [selectedIntentSlug, setSelectedIntentSlug] = useState<string | null>(
    null,
  );
  const [survey, setSurvey] = useState<MvpCustomGptSurveyResponse | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voicePlaybackEnabled, setVoicePlaybackEnabled] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [voiceStatusTone, setVoiceStatusTone] = useState<"neutral" | "error">(
    "neutral",
  );
  const [optimisticMessage, setOptimisticMessage] =
    useState<MvpCustomGptSurveyMessage | null>(null);
  const [sourcePanel, setSourcePanel] = useState<SourcePanelReference | null>(
    null,
  );
  const [closedSourceMessageId, setClosedSourceMessageId] = useState<
    string | null
  >(null);
  const didStart = useRef(false);
  const autoSourceLookupMessageIdRef = useRef<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const stopRecordingResolveRef = useRef<((blob: Blob | null) => void) | null>(
    null,
  );

  useEffect(() => {
    if (didStart.current) {
      return;
    }
    if (intentOptions.length > 0 && !selectedIntentSlug) {
      setIsStarting(false);
      return;
    }
    didStart.current = true;

    async function start() {
      try {
        setIsStarting(true);
        setError(null);
        setSurvey(
          await startMvpCustomGptSurvey({
            surveySlug,
            surveyIntentSlug: selectedIntentSlug ?? undefined,
            studyName,
            targetDurationSeconds,
          }),
        );
      } catch (startError) {
        setError(
          startError instanceof Error
            ? startError.message
            : "Unable to start the MVP survey.",
        );
      } finally {
        setIsStarting(false);
      }
    }

    void start();
  }, [intentOptions.length, selectedIntentSlug, studyName, surveySlug, targetDurationSeconds]);

  useEffect(() => {
    setVoiceSupported(
      typeof MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia),
    );
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({
      top: threadRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [survey?.messages.length, optimisticMessage]);

  useEffect(() => {
    const latestInterviewerMessage = [...(survey?.messages ?? [])]
      .reverse()
      .find((message) => message.role === "interviewer");

    if (
      !latestInterviewerMessage ||
      latestInterviewerMessage.id === sourcePanel?.messageId ||
      latestInterviewerMessage.id === closedSourceMessageId ||
      latestInterviewerMessage.id === autoSourceLookupMessageIdRef.current
    ) {
      return;
    }

    const latestMessageId = latestInterviewerMessage.id;
    const latestMessageContent = latestInterviewerMessage.content;
    const sourceReferences = latestInterviewerMessage.references
      .map((reference, index) => ({
        messageId: latestMessageId,
        index: index + 1,
        reference,
      }))
      .filter((source): source is SourcePanelReference =>
        Boolean(source.reference.url),
      )
      .filter((source) =>
        shouldAutoPreviewReference(source, latestMessageContent),
      );

    if (sourceReferences.length === 0) {
      setSourcePanel((currentPanel) =>
        currentPanel?.messageId === latestMessageId
          ? currentPanel
          : null,
      );
      return;
    }

    let isCancelled = false;
    autoSourceLookupMessageIdRef.current = latestInterviewerMessage.id;

    async function openFirstVisualReference() {
      for (const sourceReference of sourceReferences) {
        const visualReference =
          await resolveVisualSourcePanelReference(sourceReference);
        if (isCancelled) {
          return;
        }
        if (visualReference) {
          setSourcePanel(visualReference);
          return;
        }
      }
      setSourcePanel((currentPanel) =>
        currentPanel?.messageId === latestMessageId
          ? currentPanel
          : null,
      );
    }

    void openFirstVisualReference();

    return () => {
      isCancelled = true;
    };
  }, [
    closedSourceMessageId,
    sourcePanel?.messageId,
    survey?.messages,
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!survey || !content || isSending || isRecording) {
      return;
    }

    try {
      setIsSending(true);
      setError(null);
      setVoiceStatusTone("neutral");
      setDraft("");
      setOptimisticMessage({
        id: `pending-${Date.now()}`,
        role: "participant",
        content,
        createdAt: new Date().toISOString(),
        references: [],
      });
      const requestStartedAt = performance.now();
      const nextSurvey = await submitMvpCustomGptSurveyTurn(
        survey.sessionId,
        content,
      );
      await preserveResponsePacing(requestStartedAt);
      setSurvey(nextSurvey);
      setOptimisticMessage(null);
      if (voicePlaybackEnabled) {
        void playLatestInterviewerSpeech(nextSurvey.sessionId);
      }
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send that response.",
      );
      setDraft(content);
      setOptimisticMessage(null);
    } finally {
      setIsSending(false);
    }
  }

  async function startVoiceRecording() {
    if (!survey || isSending || isRecording || !voiceSupported) {
      return;
    }

    try {
      setVoicePlaybackEnabled(true);
      setVoiceStatusTone("neutral");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getPreferredAudioMimeType();
      const recorder = new MediaRecorder(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      audioChunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || mimeType || "audio/webm",
        });
        stream.getTracks().forEach((track) => track.stop());
        stopRecordingResolveRef.current?.(audioBlob);
        stopRecordingResolveRef.current = null;
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setVoiceStatus("Listening...");
    } catch (recordError) {
      setVoiceStatusTone("error");
      setVoiceStatus(formatVoiceError(recordError));
    }
  }

  function stopVoiceRecording() {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      return Promise.resolve(null);
    }

    return new Promise<Blob | null>((resolve) => {
      stopRecordingResolveRef.current = resolve;
      recorder.stop();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      setVoiceStatus("Transcribing...");
    });
  }

  async function submitVoiceBlob(audioBlob: Blob) {
    if (!survey) {
      return;
    }

    if (audioBlob.size < 1024) {
      setVoiceStatusTone("error");
      setVoiceStatus(
        "I didn't catch any audio. Try again and speak after the button changes to Stop.",
      );
      return;
    }

    try {
      setIsSending(true);
      setError(null);
      setVoiceStatusTone("neutral");
      const audioBase64 = await blobToBase64(audioBlob);
      const response = await transcribeMvpCustomGptSurveyVoice({
        sessionId: survey.sessionId,
        audioBase64,
        mimeType: audioBlob.type || "audio/webm",
      });
      setDraft(response.transcript);
      setVoiceStatus(`Heard: "${response.transcript}" Review, then Send.`);
    } catch (voiceError) {
      setVoiceStatusTone("error");
      setVoiceStatus(
        voiceError instanceof Error
          ? voiceError.message
          : "Unable to transcribe your voice answer.",
      );
    } finally {
      setIsSending(false);
    }
  }

  async function handleVoiceButtonClick() {
    if (isRecording) {
      const audioBlob = await stopVoiceRecording();
      if (audioBlob) {
        await submitVoiceBlob(audioBlob);
      }
      return;
    }

    await startVoiceRecording();
  }

  async function playLatestInterviewerSpeech(sessionId: string) {
    try {
      setIsSpeaking(true);
      setVoiceStatusTone("neutral");
      setVoiceStatus("Speaking...");
      speechAudioRef.current?.pause();
      const response = await synthesizeMvpCustomGptSurveySpeech({
        sessionId,
        voice: MVP_INTERVIEWER_VOICE,
      });

      if (!response.audio) {
        setIsSpeaking(false);
        setVoiceStatus(null);
        return;
      }

      const audio = new Audio(
        audioDataUrl(response.audio.mimeType, response.audio.base64),
      );
      audio.playbackRate = 1.15;
      speechAudioRef.current = audio;
      audio.onended = () => {
        setIsSpeaking(false);
        setVoiceStatus(null);
      };
      await audio.play();
    } catch (speechError) {
      setIsSpeaking(false);
      setVoiceStatusTone("error");
      setVoiceStatus(
        speechError instanceof Error
          ? speechError.message
          : "Unable to play interviewer audio.",
      );
    }
  }

  function stopInterviewerSpeech() {
    speechAudioRef.current?.pause();
    speechAudioRef.current = null;
    setIsSpeaking(false);
    setVoiceStatus(null);
  }

  async function handleReadLatestInterviewer() {
    if (!survey || isStarting || isSending) {
      return;
    }

    if (isSpeaking) {
      stopInterviewerSpeech();
      return;
    }

    setVoicePlaybackEnabled(true);
    await playLatestInterviewerSpeech(survey.sessionId);
  }

  const textDisabled =
    isStarting || isSending || isRecording || survey?.status === "completed";
  const voiceDisabled =
    isStarting ||
    isSending ||
    !survey ||
    !voiceSupported ||
    survey.status === "needs_setup" ||
    survey.status === "completed";
  const speechDisabled =
    isStarting ||
    isSending ||
    !survey ||
    survey.status === "needs_setup" ||
    survey.status === "completed";
  const displayedMessages = survey
    ? [
        ...survey.messages,
        ...(optimisticMessage ? [optimisticMessage] : []),
      ]
    : [];
  const isChoosingIntent =
    intentOptions.length > 0 && !survey && !selectedIntentSlug;

  function handleOpenReference(
    input: SourcePanelReference,
    event?: MouseEvent<HTMLAnchorElement>,
  ) {
    event?.preventDefault();
    setClosedSourceMessageId(null);
    void resolveVisualSourcePanelReference(input).then((visualReference) => {
      if (visualReference) {
        setSourcePanel(visualReference);
        return;
      }

      if (input.reference.url) {
        openSourceUrlInNewTab(input.reference.url);
      }
    });
  }

  function handleCloseSourcePanel() {
    setClosedSourceMessageId(sourcePanel?.messageId ?? null);
    setSourcePanel(null);
  }

  return (
    <main
      className={`mvp-survey-page ${
        sourcePanel ? "mvp-survey-page-with-source" : ""
      }`}
    >
      <section className="mvp-survey-modal" aria-label="CustomGPT survey MVP">
        <header className="mvp-survey-header">
          <div>
            <p className="mvp-kicker">CustomGPT Survey Bridge</p>
            <h1>{survey?.studyName ?? studyName}</h1>
          </div>
          <div className="mvp-status-stack">
            <button
              className={`mvp-speech-toggle ${
                isSpeaking ? "mvp-speech-toggle-active" : ""
              }`}
              disabled={speechDisabled}
              onClick={handleReadLatestInterviewer}
              type="button"
            >
              {isSpeaking ? "Stop" : "Read"}
            </button>
            <span className="mvp-timer">
              {survey ? formatSeconds(survey.remainingSeconds) : "10:00"}
            </span>
            <span className={`mvp-status mvp-status-${survey?.status ?? "active"}`}>
              {survey?.status === "needs_setup"
                ? "Needs key"
                : survey?.status === "completed"
                  ? "Done"
                  : "Live"}
            </span>
          </div>
        </header>

        {isChoosingIntent ? (
          <div className="mvp-intent-picker">
            <p className="mvp-intent-eyebrow">Choose interview focus</p>
            <div className="mvp-intent-grid">
              {intentOptions.map((intent) => (
                <button
                  className="mvp-intent-card"
                  key={intent.slug}
                  onClick={() => setSelectedIntentSlug(intent.slug)}
                  type="button"
                >
                  <span>{intent.label}</span>
                  <small>{intent.description}</small>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {survey?.status === "needs_setup" ? (
          <div className="mvp-setup-note">
            {survey.reason} Add the CustomGPT API key locally, then reload this
            page to test the live cited-answer behavior.
          </div>
        ) : null}

        {error ? <div className="mvp-error">{error}</div> : null}

        <div className="mvp-thread" ref={threadRef}>
          {isChoosingIntent ? null : isStarting ? (
            <div className="mvp-loading">Starting survey...</div>
          ) : (
            displayedMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                onOpenReference={handleOpenReference}
              />
            ))
          )}
          {isSending ? <div className="mvp-loading">Thinking...</div> : null}
        </div>

        <form className="mvp-composer" onSubmit={handleSubmit}>
          <textarea
            aria-label="Survey response"
            disabled={textDisabled || isChoosingIntent}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={
              isChoosingIntent
                ? "Choose a focus above to begin"
                : survey?.status === "completed"
                ? "Survey complete"
                : "Answer the question, or ask about a study/source..."
            }
            rows={2}
            value={draft}
          />
          <button
            disabled={textDisabled || isChoosingIntent || !draft.trim()}
            type="submit"
          >
            {isSending ? "Sending" : "Send"}
          </button>
          <button
            className={`mvp-voice-button ${
              isRecording ? "mvp-voice-button-recording" : ""
            }`}
            disabled={voiceDisabled && !isRecording}
            onClick={handleVoiceButtonClick}
            type="button"
          >
            {isRecording ? "Stop" : "Record"}
          </button>
        </form>
        {voiceStatus ? (
          <div
            className={`mvp-voice-status mvp-voice-status-${voiceStatusTone}`}
            aria-live="polite"
          >
            <span>{voiceStatus}</span>
            {isSpeaking ? (
              <button onClick={stopInterviewerSpeech} type="button">
                Stop audio
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      {sourcePanel ? (
        <SourcePanel source={sourcePanel} onClose={handleCloseSourcePanel} />
      ) : null}
    </main>
  );
}
