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

type Figure = { url: string; alt: string; caption?: string; source?: string | null; sourceTitle?: string | null };

/** Charts and images for an answer: assets the answer cited, then matching figures from the site library. */
function messageFigures(message: InterviewMessage): Figure[] {
  const seen = new Set<string>();
  const keep = (url: string) => !seen.has(url) && Boolean(seen.add(url));
  const cited = (message.payload?.references ?? []).flatMap(reference => (reference.assets ?? [])
    .filter(asset => ["IMAGE", "CHART", "TABLE"].includes(asset.assetKind.toUpperCase()) && /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(asset.url))
    .filter(asset => keep(asset.url))
    .map(asset => ({ url: asset.url, alt: asset.description ?? asset.title, caption: asset.title, source: reference.url, sourceTitle: reference.title })));
  const library = (message.payload?.figures ?? []).filter(figure => keep(figure.url));
  return [...cited, ...library];
}

type PanelImages = Figure[];
/** What the right-hand evidence panel shows: the trial card in play, plus figures for answers. */
type Panel = { card: EvidenceCard | null; images: PanelImages; current: boolean } | null;

/** One figure at a time, with a caption, arrows, a counter and gentle auto-advance. */
export function FigureCarousel({ figures, intervalMs = 3000 }: { figures: Figure[]; intervalMs?: number }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [open, setOpen] = useState(false);
  const count = figures.length;
  const key = figures.map(figure => figure.url).join("|");
  useEffect(() => {
    if (count < 2 || !playing || open || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % count), intervalMs);
    return () => window.clearInterval(timer);
  }, [count, playing, open, key, intervalMs]);
  // While enlarged: Esc closes, arrow keys step, and the page behind does not scroll.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
      if (event.key === "ArrowRight" && count > 1) setIndex(current => (current + 1) % count);
      if (event.key === "ArrowLeft" && count > 1) setIndex(current => (current - 1 + count) % count);
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = previousOverflow; };
  }, [open, count]);
  if (!count) return null;
  const figure = figures[Math.min(index, count - 1)]!;
  // Using an arrow means they are reading, so it pauses; Play resumes the cycle.
  const go = (step: number) => { setPlaying(false); setIndex(current => (current + step + count) % count); };
  const enlarge = () => { setPlaying(false); setOpen(true); };
  return (
    <div className={styles.carousel} aria-roledescription="carousel" aria-label="Figures">
      <button type="button" className={styles.carouselFrame} onClick={enlarge} aria-label={`Enlarge: ${figure.caption ?? figure.alt}`} title="Click to enlarge">
        {/* Only the current figure is in the frame. Hosted on the manufacturer's HCP site; shown as published. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={figure.url} src={figure.url} alt={figure.alt} loading="eager" />
        <span className={styles.enlargeHint} aria-hidden="true">⤢</span>
      </button>
      <div className={styles.carouselBar}>
        <p className={styles.carouselCaption} aria-live="polite">{figure.caption ?? figure.alt}</p>
        {count > 1 && (
          <div className={styles.carouselNav}>
            <button type="button" onClick={() => go(-1)} aria-label="Previous figure">‹</button>
            <span>{index + 1} / {count}</span>
            <button type="button" onClick={() => go(1)} aria-label="Next figure">›</button>
            <button type="button" className={styles.carouselPlay} data-on={playing} onClick={() => setPlaying(current => !current)}
              aria-label={playing ? "Pause" : "Play"} aria-pressed={playing}>{playing ? "Pause" : "Play"}</button>
          </div>
        )}
      </div>
      {/* The other figures are fetched now, off screen, so each switch is instant. */}
      <div className={styles.carouselPreload} aria-hidden="true">
        {figures.map((item, i) => i !== index && (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={item.url} src={item.url} alt="" loading="eager" />
        ))}
      </div>
      {open && (
        <div className={styles.lightbox} role="dialog" aria-modal="true" aria-label={figure.caption ?? figure.alt} onClick={() => setOpen(false)}>
          <div className={styles.lightboxBody} onClick={event => event.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={figure.url} alt={figure.alt} />
            <div className={styles.lightboxBar}>
              <p>{figure.caption ?? figure.alt}</p>
              <div className={styles.carouselNav}>
                {count > 1 && (<>
                  <button type="button" onClick={() => go(-1)} aria-label="Previous figure">‹</button>
                  <span>{index + 1} / {count}</span>
                  <button type="button" onClick={() => go(1)} aria-label="Next figure">›</button>
                </>)}
                <button type="button" className={styles.carouselPlay} onClick={() => setOpen(false)} autoFocus>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImageSet({ images }: { images: PanelImages }) {
  const source = images.find(image => image.source);
  return (
    <figure className={styles.plate} aria-label="Figures from the prescribing site">
      <header className={styles.plateHead}><h3 className={styles.plateTitle}>From the prescribing site</h3></header>
      <FigureCarousel key={images.map(image => image.url).join("|")} figures={images} />
      <figcaption className={styles.plateSource}>
        Source: {source?.source
          ? <a href={source.source} target="_blank" rel="noreferrer">{source.sourceTitle ?? "Prescribing site"}</a>
          : <a href="https://www.nubeqahcp.com/" target="_blank" rel="noreferrer">nubeqahcp.com</a>}
      </figcaption>
    </figure>
  );
}

function EvidencePlate({ card }: { card: EvidenceCard }) {
  return (
    <figure className={styles.plate} aria-label={`${card.title} evidence`}>
      <header className={styles.plateHead}>
        <h3 className={styles.plateTitle}>{card.title}</h3>
        <p className={styles.plateSubtitle}>{card.subtitle}</p>
      </header>
      <p className={styles.plateBody}>{card.body}</p>
      {card.figures.length > 0 && <FigureCarousel key={card.id} figures={card.figures} />}
      {card.context && card.context.length > 0 && (
        <ul className={styles.plateContext} aria-label="Study context">
          {card.context.map(note => <li key={note}>{note}</li>)}
        </ul>
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
  const [panel, setPanel] = useState<Panel>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
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
  const activeRef = useRef<HTMLElement | null>(null);
  const answerRef = useRef<HTMLLIElement | null>(null);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  const readAloudRef = useRef(false);
  const inFlightRef = useRef(false);
  const lastQuestionRef = useRef<string | null>(null);

  const prompt = data?.prompt ?? null;
  const busy = pending !== null;

  const absorb = useCallback((response: InterviewResponse, replace: boolean) => {
    const after = response.prompt.type === "question" ? response.prompt.question.id : null;
    // Returning from a side question keeps any boxes already ticked.
    if (!after || lastQuestionRef.current !== after) setSelected([]);
    lastQuestionRef.current = after;
    setData(response);
    setMessages(previous => (replace ? response.messages : [...previous, ...response.messages]));
    const prompt = response.prompt;
    const latestImages = [...response.messages].reverse()
      .map(message => (message.kind === "detour_answer" ? messageFigures(message) : []))
      .find(images => images.length > 0);
    // The panel shows one thing at a time: the figures for a side question while it is being answered,
    // otherwise the trial card in play.
    if (prompt.type === "question" && prompt.question.card) {
      const card = prompt.question.card;
      setCards(previous => ({ ...previous, [prompt.question.id]: card }));
      setPanel({ card, images: latestImages && prompt.returning ? latestImages : [], current: true });
    } else if (latestImages) {
      setPanel(previous => ({ card: previous?.current ? previous.card : null, images: latestImages, current: true }));
    } else {
      // A follow-up about the card keeps it current; later questions show it as earlier evidence.
      const keepCurrent = prompt.type === "follow_up";
      setPanel(previous => (previous ? { ...previous, current: keepCurrent && previous.current } : previous));
    }
    if (prompt.type === "end") store.clear(surveySlug); else store.set(surveySlug, response.sessionId);
    if (readAloudRef.current) {
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
        catch (cause) {
          // Only a missing interview starts over; a network blip should not lose progress.
          if ((cause as { status?: number }).status !== 404) throw cause;
          store.clear(surveySlug);
        }
      }
      absorb(await startInterview(surveySlug), true);
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "The interview could not open.", retry: () => void boot() });
    } finally {
      setPending(null);
    }
  }, [absorb, surveySlug]);

  useEffect(() => { void boot(); }, [boot]);

  // While waiting, show the pending line; once a new prompt arrives, bring its first line (or the
  // answer to a side question) to the top so the whole question fits on screen.
  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    if (pending) { endRef.current?.scrollIntoView({ behavior, block: "end" }); return; }
    const target = (prompt?.type === "question" && prompt.returning ? answerRef.current : null) ?? activeRef.current ?? endRef.current;
    target?.scrollIntoView({ behavior, block: target === endRef.current ? "end" : "start" });
  }, [messages, prompt, pending]);

  useEffect(() => { if (prompt && prompt.type !== "question") draftRef.current?.focus(); }, [prompt]);
  useEffect(() => { if (!draft && draftRef.current) draftRef.current.style.height = ""; }, [draft]);

  const restart = useCallback(() => {
    store.clear(surveySlug);
    setData(null); setMessages([]); setCards({}); setSelected([]); setDraft("");
    void boot();
  }, [boot, surveySlug]);

  const submit = useCallback(async (input: TurnInput, label: string, echo: string | null) => {
    if (!data || inFlightRef.current) return;
    inFlightRef.current = true;
    audioRef.current?.pause();
    setError(null);
    setConfirmStop(false);
    setPending({ label, echo });
    try {
      absorb(await sendTurn(data.sessionId, input), false);
      setDraft("");
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      setError(status === 404
        ? { message: "This interview has expired. Start again to continue.", retry: restart, }
        : { message: cause instanceof Error ? cause.message : "Your answer was not saved.", retry: () => void submit(input, label, echo) });
    } finally {
      inFlightRef.current = false;
      setPending(null);
    }
  }, [absorb, data, restart]);

  const question = prompt?.type === "question" ? prompt.question : null;
  const labelsFor = (ids: string[]) => ids.map(id => question?.options.find(o => o.id === id)?.label ?? id).join("; ");

  const choose = useCallback((optionId: string) => {
    if (!question || busy || recording) return;
    if (question.kind === "single") {
      const comment = draft.trim();
      const label = question.options.find(o => o.id === optionId)?.label ?? optionId;
      void submit({ action: "select", optionIds: [optionId], text: comment || undefined, source: "tap" }, "Saving your answer…",
        [label, comment].filter(Boolean).join(" — "));
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
  }, [question, busy, recording, draft, submit]);

  const confirmMulti = () => {
    if (!question || !selected.length) return;
    const comment = draft.trim();
    void submit({ action: "select", optionIds: selected, text: comment || undefined, source: "tap" }, "Saving your answer…",
      [labelsFor(selected), comment].filter(Boolean).join(" — "));
  };

  const sendText = (text: string, source: "text" | "voice") => {
    const trimmed = text.trim();
    if (!trimmed || !prompt || prompt.type === "end") return;
    const label = prompt.type === "follow_up" && !trimmed.endsWith("?") ? "Saving your answer…"
      : prompt.type === "open_question" ? "Checking the prescribing site…" : "Reading your answer…";
    void submit({ action: "text", text: trimmed, source }, label, trimmed);
  };

  const sendTextRef = useRef(sendText);
  useEffect(() => { sendTextRef.current = sendText; });

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
          sendTextRef.current(transcript, "voice");
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
  // Earlier questions fold into an accordion; the current question's exchange stays open.
  const { earlier, recent } = useMemo(() => {
    const currentId = !prompt ? null : prompt.type === "question" ? prompt.question.id
      : prompt.type === "follow_up" || prompt.type === "open_question" ? prompt.questionId : null;
    let split = currentId ? thread.findIndex(m => m.role === "interviewer" && m.kind === "question" && m.questionId === currentId) : -1;
    if (split < 0) split = prompt?.type === "end" ? Math.max(0, thread.length - 1) : thread.length;
    // Keep the welcome note visible until the first answer.
    if (thread.every(m => m.role !== "participant")) split = 0;
    return { earlier: thread.slice(0, split), recent: thread.slice(split) };
  }, [thread, prompt]);
  const answeredEarlier = earlier.filter(m => m.role === "participant").length;
  const latestDetourId = [...recent].reverse().find(m => m.kind === "detour_answer")?.id ?? null;
  const done = prompt?.type === "end";
  const progress = data?.progress;
  const share = progress ? Math.round((progress.answered / progress.total) * 100) : 0;

  const renderMessage = (message: InterviewMessage) => {
    const cardTitle = (message.questionId ? cards[message.questionId]?.title : undefined) ?? message.payload?.cardTitle;
    if (message.role === "participant") {
      return <li key={message.id} className={styles.answer}><p>{message.content}</p></li>;
    }
    if (message.kind === "detour_answer") {
      const references = message.payload?.references ?? [];
      const images = messageFigures(message);
      return (
        <li key={message.id} className={styles.detour} ref={message.id === latestDetourId ? answerRef : undefined}>
          <div className={styles.detourBody}><Paragraphs text={message.content} references={references} /></div>
          {images.length > 0 && <div className={styles.inlineOnly}><ImageSet images={images} /></div>}
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
        {cardTitle && <span className={styles.pastCard}>{cardTitle}</span>}
        <p>{message.content}</p>
      </li>
    );
  };

  const composerPlaceholder = prompt?.type === "follow_up" ? "Type your answer"
    : prompt?.type === "open_question" ? "Type your question"
    : "Type a comment or a question";

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
              <input type="checkbox" checked={readAloud} onChange={event => { readAloudRef.current = event.target.checked; setReadAloud(event.target.checked); if (!event.target.checked) audioRef.current?.pause(); }} />
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

      <div className={styles.layout} data-panel={panel ? "on" : "off"}>
      <main className={styles.column}>
        {earlier.length > 0 && (
          <details className={styles.earlier} open={earlierOpen} onToggle={event => setEarlierOpen((event.target as HTMLDetailsElement).open)}>
            <summary>Earlier questions <span className={styles.earlierCount}>{answeredEarlier} {answeredEarlier === 1 ? "answer" : "answers"}</span></summary>
            <ol className={styles.thread}>{earlier.map(message => renderMessage(message))}</ol>
          </details>
        )}
        <ol className={styles.thread} aria-live="polite">
          {recent.map(message => renderMessage(message))}
          {pending?.echo && <li className={`${styles.answer} ${styles.answerPending}`}><p>{pending.echo}</p></li>}
        </ol>

        {error && (
          <div className={styles.error} role="alert">
            <p>{error.message}</p>
            {error.retry && <button type="button" className={styles.secondary} onClick={error.retry}>{error.retry === restart ? "Start again" : "Try again"}</button>}
            {!error.retry && !data && <button type="button" className={styles.secondary} onClick={() => void boot()}>Start again</button>}
          </div>
        )}

        {pending && <p className={styles.working} role="status">{pending.label}</p>}

        {!pending && prompt && prompt.type !== "end" && (
          <section className={styles.active} aria-label="Current question" ref={activeRef}>
            {prompt.type === "question" && (
              <>
                {prompt.returning && <p className={styles.returning}>Back to where we were</p>}
                {prompt.question.card && (
                  <details className={`${styles.inlineOnly} ${styles.inlineCard}`}>
                    <summary>See the {prompt.question.card.title} chart and study details</summary>
                    <EvidencePlate card={prompt.question.card} />
                  </details>
                )}
                {!prompt.returning && !prompt.clarifying && prompt.question.narration && (
                  <div className={styles.narration}>
                    {prompt.question.narration.split(/\n{2,}/).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
                  </div>
                )}
                {prompt.question.card && <p className={styles.panelHint}>The {prompt.question.card.title} results are shown on the right.</p>}
                <h2 className={styles.prompt}>{prompt.clarifying ? `So I record this accurately, which of these is closest? ${prompt.question.prompt}` : prompt.question.prompt}</h2>
                {prompt.question.kind === "multi" && prompt.question.maxSelect && (
                  <p className={styles.hint}>{selected.length} of up to {prompt.question.maxSelect} selected</p>
                )}
                <div className={styles.options} data-compact={prompt.question.options.every(option => option.label.length <= 40) && prompt.question.options.length >= 4}
                  role={prompt.question.kind === "single" ? "radiogroup" : "group"} aria-label={prompt.question.prompt}>
                  {prompt.question.options.map((option, index) => {
                    const isOn = selected.includes(option.id);
                    return (
                      <button key={option.id} type="button" className={styles.option} data-kind={prompt.question.kind} aria-pressed={prompt.question.kind === "multi" ? isOn : undefined}
                        role={prompt.question.kind === "single" ? "radio" : "checkbox"} aria-checked={isOn}
                        disabled={recording} onClick={() => choose(option.id)}>
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
              <textarea ref={draftRef} value={draft} rows={1} placeholder={composerPlaceholder} aria-label={composerPlaceholder}
                onChange={event => {
                  setDraft(event.target.value);
                  // Grow with the text, up to about five lines.
                  event.target.style.height = "auto";
                  event.target.style.height = `${Math.min(event.target.scrollHeight, 132)}px`;
                }}
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

      {panel && (
        <aside className={styles.panel} aria-label="Evidence">
          {!panel.current && <p className={styles.panelLabel}>Shown earlier</p>}
          <div className={styles.panelStack} data-current={panel.current}>
            {panel.images.length > 0 ? <ImageSet images={panel.images} /> : panel.card && <EvidencePlate card={panel.card} />}
            {panel.images.length > 0 && panel.card && (
              <button type="button" className={styles.panelSwitch} onClick={() => setPanel(previous => (previous ? { ...previous, images: [] } : previous))}>
                Back to the {panel.card.title} results
              </button>
            )}
          </div>
        </aside>
      )}
      </div>
    </div>
  );
}
