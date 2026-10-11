"use client";

import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  resumeInterview, sendTurn, speakLatest, startInterview, transcribe,
  type EvidenceCard, type InterviewMessage, type InterviewResponse, type Prompt, type Reference, type TurnInput,
} from "../structured-interview/client";
import styles from "./StructuredInterview.module.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--si-sans" });
const serif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], variable: "--si-serif" });

const storageKey = (slug: string) => `structured-interview:${slug}`;
const store = {
  get(slug: string) { try { return window.sessionStorage.getItem(storageKey(slug)); } catch { return null; } },
  set(slug: string, id: string) { try { window.sessionStorage.setItem(storageKey(slug), id); } catch { /* private mode */ } },
  clear(slug: string) { try { window.sessionStorage.removeItem(storageKey(slug)); } catch { /* private mode */ } },
};

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return window.btoa(binary);
}

function preferredMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"].find(type => MediaRecorder.isTypeSupported(type)) ?? "";
}

/** "[1]" markers become links to the matching source. */
function withCitations(text: string, references: Reference[]): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, index) => {
    const match = /^\[(\d+)\]$/.exec(part);
    const reference = match ? references[Number(match[1]) - 1] : undefined;
    if (!match) return <Fragment key={index}>{part}</Fragment>;
    return reference?.url
      ? <a key={index} className={styles.cite} href={reference.url} target="_blank" rel="noreferrer">{match[1]}</a>
      : <sup key={index} className={styles.cite}>{match[1]}</sup>;
  });
}

function Paragraphs({ text, references = [] }: { text: string; references?: Reference[] }) {
  return <>{text.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{withCitations(paragraph, references)}</p>)}</>;
}

function EvidencePlate({ card }: { card: EvidenceCard }) {
  return (
    <figure className={styles.plate} aria-label={`${card.title} evidence`}>
      <header className={styles.plateHead}>
        <h3 className={styles.plateTitle}>{card.title}</h3>
        <p className={styles.plateSubtitle}>{card.subtitle}</p>
      </header>
      <p className={styles.plateBody}>{card.body}</p>
      {card.figures.length > 0 && (
        <div className={styles.plateFigures} data-count={card.figures.length}>
          {card.figures.map(figure => (
            // Hosted on the manufacturer's HCP site; shown as published.
            // eslint-disable-next-line @next/next/no-img-element
            <img key={figure.url} src={figure.url} alt={figure.alt} loading="eager" />
          ))}
        </div>
      )}
      <figcaption className={styles.plateSource}>
        Source: <a href={card.sourceUrl} target="_blank" rel="noreferrer">{card.sourceLabel}</a>
      </figcaption>
    </figure>
  );
}

/** Messages already shown in the thread, minus the trailing prompt that the active panel will show. */
function threadMessages(messages: InterviewMessage[], prompt: Prompt | null) {
  if (!prompt || prompt.type === "end") return messages;
  const last = messages.at(-1);
  if (last?.role === "interviewer" && (last.kind === "question" || last.kind === "follow_up")) return messages.slice(0, -1);
  return messages;
}

type Props = { surveySlug: "nubeqa" | "brukinsa" | "padcev" | "enhertu" };

export function StructuredInterview({ surveySlug }: Props) {
  const [data, setData] = useState<InterviewResponse | null>(null);
  const [messages, setMessages] = useState<InterviewMessage[]>([]);
  const [cards, setCards] = useState<Record<string, EvidenceCard>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<{ label: string; echo: string | null } | null>(null);
  const [error, setError] = useState<{ message: string; retry: (() => void) | null } | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [readAloud, setReadAloud] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const readAloudRef = useRef(readAloud);
  readAloudRef.current = readAloud;

  const prompt = data?.prompt ?? null;
  const busy = pending !== null;

  const absorb = useCallback((response: InterviewResponse, replace: boolean) => {
    setData(response);
    setMessages(previous => (replace ? response.messages : [...previous, ...response.messages]));
    if (response.prompt.type === "question" && response.prompt.question.card) {
      const card = response.prompt.question.card;
      setCards(previous => ({ ...previous, [response.prompt.type === "question" ? response.prompt.question.id : ""]: card }));
    }
    setSelected([]);
    if (response.prompt.type === "end") store.clear(surveySlug); else store.set(surveySlug, response.sessionId);
    if (readAloudRef.current && response.prompt.type !== "end") {
      speakLatest(response.sessionId).then(result => {
        if (!result.audio) return;
        audioRef.current?.pause();
        const audio = new Audio(`data:${result.audio.mimeType};base64,${result.audio.base64}`);
        audioRef.current = audio;
        void audio.play().catch(() => undefined);
      }).catch(() => undefined);
    }
  }, [surveySlug]);

  const boot = useCallback(async () => {
    setError(null);
    setPending({ label: "Opening the interview…", echo: null });
    try {
      const existing = store.get(surveySlug);
      if (existing) {
        try { absorb(await resumeInterview(existing), true); return; }
        catch { store.clear(surveySlug); }
      }
      absorb(await startInterview(surveySlug), true);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "The interview could not open.", retry: () => void boot() });
    } finally {
      setPending(null);
    }
  }, [absorb, surveySlug]);

  useEffect(() => { void boot(); }, [boot]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "end" });
  }, [messages, prompt, pending]);

  useEffect(() => { if (prompt && prompt.type !== "question") draftRef.current?.focus(); }, [prompt]);

  const submit = useCallback(async (input: TurnInput, label: string, echo: string | null) => {
    if (!data) return;
    audioRef.current?.pause();
    setError(null);
    setConfirmStop(false);
    setPending({ label, echo });
    try {
      absorb(await sendTurn(data.sessionId, input), false);
      setDraft("");
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      if (status === 404) { store.clear(surveySlug); }
      setError({ message: cause instanceof Error ? cause.message : "Your answer was not saved.", retry: status === 404 ? null : () => void submit(input, label, echo) });
    } finally {
      setPending(null);
    }
  }, [absorb, data, surveySlug]);

  const question = prompt?.type === "question" ? prompt.question : null;
  const optionLabel = (id: string) => question?.options.find(o => o.id === id)?.label ?? id;

  const choose = useCallback((optionId: string) => {
    if (!question || busy) return;
    if (question.kind === "single") {
      const comment = draft.trim();
      void submit({ action: "select", optionIds: [optionId], text: comment || undefined, source: "tap" }, "Saving your answer…",
        [optionLabel(optionId), comment].filter(Boolean).join(" — "));
      return;
    }
    const option = question.options.find(o => o.id === optionId);
    setSelected(previous => {
      if (previous.includes(optionId)) return previous.filter(id => id !== optionId);
      if (option?.exclusive) return [optionId];
      const withoutExclusive = previous.filter(id => !question.options.find(o => o.id === id)?.exclusive);
      if (question.maxSelect && withoutExclusive.length >= question.maxSelect) return withoutExclusive;
      return [...withoutExclusive, optionId];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, busy, draft, submit]);

  const confirmMulti = () => {
    if (!question || !selected.length) return;
    const comment = draft.trim();
    void submit({ action: "select", optionIds: selected, text: comment || undefined, source: "tap" }, "Saving your answer…",
      [selected.map(optionLabel).join("; "), comment].filter(Boolean).join(" — "));
  };

  const sendText = (text: string, source: "text" | "voice") => {
    const trimmed = text.trim();
    if (!trimmed || !prompt || prompt.type === "end") return;
    const label = prompt.type === "follow_up" && !trimmed.endsWith("?") ? "Saving your answer…"
      : prompt.type === "open_question" ? "Checking the prescribing site…" : "Reading your answer…";
    void submit({ action: "text", text: trimmed, source }, label, trimmed);
  };

  // Number keys pick options when the text box is not in use.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!question || busy || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < question.options.length) { event.preventDefault(); choose(question.options[index]!.id); }
      if (event.key === "Enter" && question.kind === "multi" && selected.length) { event.preventDefault(); confirmMulti(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const toggleRecording = async () => {
    if (recording) { recorderRef.current?.stop(); return; }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = preferredMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" });
        if (blob.size < 1024) { setError({ message: "No speech was picked up. Tap the microphone, speak, then tap it again to send.", retry: null }); return; }
        setPending({ label: "Transcribing…", echo: null });
        try {
          const { transcript } = await transcribe(await blobToBase64(blob), blob.type);
          setPending(null);
          sendText(transcript, "voice");
        } catch (cause) {
          setPending(null);
          setError({ message: cause instanceof Error ? cause.message : "Transcription failed. Type your answer instead.", retry: null });
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setError({ message: "Microphone access is blocked. Allow it in your browser settings, or type your answer.", retry: null });
    }
  };

  const thread = useMemo(() => threadMessages(messages, prompt), [messages, prompt]);
  const done = prompt?.type === "end";
  const progress = data?.progress;
  const share = progress ? Math.round((progress.answered / progress.total) * 100) : 0;

  const composerPlaceholder = prompt?.type === "follow_up" ? "Type your answer"
    : prompt?.type === "open_question" ? "Type your question"
    : question?.kind === "multi" ? "Add a comment, answer in your own words, or ask a question"
    : "Add a comment before tapping, answer in your own words, or ask a question";

  return (
    <div className={`${styles.root} ${sans.variable} ${serif.variable}`}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{data?.title ?? "HCP discussion"}</h1>
            <p className={styles.meta}>{done ? "Finished" : question ? question.section : progress ? "In progress" : ""}</p>
          </div>
          <div className={styles.barActions}>
            <label className={styles.toggle}>
              <input type="checkbox" checked={readAloud} onChange={event => { setReadAloud(event.target.checked); if (!event.target.checked) audioRef.current?.pause(); }} />
              Read aloud
            </label>
            {!done && data && (confirmStop ? (
              <span className={styles.stopConfirm}>
                End now?
                <button type="button" className={styles.linkButton} onClick={() => void submit({ action: "stop" }, "Ending the interview…", null)}>End</button>
                <button type="button" className={styles.linkButton} onClick={() => setConfirmStop(false)}>Keep going</button>
              </span>
            ) : (
              <button type="button" className={styles.linkButton} onClick={() => setConfirmStop(true)}>End interview</button>
            ))}
          </div>
        </div>
        <div className={styles.progress} role="progressbar" aria-label="Interview progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={done ? 100 : share}>
          <span style={{ width: `${done ? 100 : share}%` }} />
        </div>
      </header>

      <main className={styles.column}>
        <ol className={styles.thread} aria-live="polite">
          {thread.map(message => {
            const card = message.questionId ? cards[message.questionId] : undefined;
            if (message.role === "participant") {
              return <li key={message.id} className={styles.answer}><p>{message.content}</p></li>;
            }
            if (message.kind === "detour_answer") {
              const references = message.payload?.references ?? [];
              return (
                <li key={message.id} className={styles.detour}>
                  <div className={styles.detourBody}><Paragraphs text={message.content} references={references} /></div>
                  {references.length > 0 && (
                    <ol className={styles.sources}>
                      {references.map(reference => (
                        <li key={reference.citationId}>{reference.url
                          ? <a href={reference.url} target="_blank" rel="noreferrer">{reference.title ?? reference.url}</a>
                          : reference.title}</li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            }
            if (message.kind === "notice" || message.kind === "closing") {
              return <li key={message.id} className={message.kind === "closing" ? styles.closing : styles.notice}><p>{message.content}</p></li>;
            }
            return (
              <li key={message.id} className={styles.pastQuestion}>
                {card && <span className={styles.pastCard}>{card.title}</span>}
                <p>{message.content}</p>
              </li>
            );
          })}
          {pending?.echo && <li className={`${styles.answer} ${styles.answerPending}`}><p>{pending.echo}</p></li>}
        </ol>

        {error && (
          <div className={styles.error} role="alert">
            <p>{error.message}</p>
            {error.retry && <button type="button" className={styles.secondary} onClick={error.retry}>Try again</button>}
            {!error.retry && !data && <button type="button" className={styles.secondary} onClick={() => void boot()}>Start again</button>}
          </div>
        )}

        {pending && <p className={styles.working} role="status">{pending.label}</p>}

        {!pending && prompt && prompt.type !== "end" && (
          <section className={styles.active} aria-label="Current question">
            {prompt.type === "question" && (
              <>
                {prompt.returning && <p className={styles.returning}>Back to where we were</p>}
                {prompt.question.card && <EvidencePlate card={prompt.question.card} />}
                <h2 className={styles.prompt}>{prompt.clarifying ? `So I record this accurately, which of these is closest? ${prompt.question.prompt}` : prompt.question.prompt}</h2>
                {prompt.question.kind === "multi" && prompt.question.maxSelect && (
                  <p className={styles.hint}>{selected.length} of up to {prompt.question.maxSelect} selected</p>
                )}
                <div className={styles.options} role={prompt.question.kind === "single" ? "radiogroup" : "group"} aria-label={prompt.question.prompt}>
                  {prompt.question.options.map((option, index) => {
                    const isOn = selected.includes(option.id);
                    return (
                      <button key={option.id} type="button" className={styles.option} data-kind={prompt.question.kind} aria-pressed={prompt.question.kind === "multi" ? isOn : undefined}
                        role={prompt.question.kind === "single" ? "radio" : "checkbox"} aria-checked={isOn}
                        onClick={() => choose(option.id)}>
                        <span className={styles.optionKey} aria-hidden="true">{index + 1}</span>
                        <span className={styles.optionLabel}>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
                {prompt.question.kind === "multi" && (
                  <button type="button" className={styles.primary} disabled={!selected.length} onClick={confirmMulti}>Continue</button>
                )}
              </>
            )}
            {(prompt.type === "follow_up" || prompt.type === "open_question") && (
              <h2 className={styles.prompt}>{prompt.prompt}</h2>
            )}

            <form className={styles.composer} onSubmit={event => { event.preventDefault(); sendText(draft, "text"); }}>
              <textarea ref={draftRef} value={draft} rows={2} placeholder={composerPlaceholder} aria-label={composerPlaceholder}
                onChange={event => setDraft(event.target.value)}
                onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); sendText(draft, "text"); } }} />
              <div className={styles.composerActions}>
                {typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && (
                  <button type="button" className={styles.mic} data-on={recording} onClick={() => void toggleRecording()}
                    aria-label={recording ? "Stop recording and send" : "Answer by voice"}>
                    {recording ? "Stop and send" : "Speak"}
                  </button>
                )}
                {(prompt.type === "follow_up" || prompt.type === "open_question") && (
                  <button type="button" className={styles.secondary} onClick={() => void submit({ action: "skip" }, "Moving on…", null)}>
                    {prompt.type === "open_question" ? "No question after all" : "Skip"}
                  </button>
                )}
                <button type="submit" className={styles.primary} disabled={!draft.trim()}>Send</button>
              </div>
            </form>
          </section>
        )}

        {prompt?.type === "end" && (
          <section className={styles.finished} aria-label="Interview finished">
            <p>{prompt.reason === "declined" ? "No responses were recorded." : `Recorded ${progress?.answered ?? 0} of ${progress?.total ?? 0} questions.`}</p>
          </section>
        )}
        <div ref={endRef} />
      </main>
    </div>
  );
}
