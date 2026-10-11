"use client";

import { IBM_Plex_Sans, Source_Serif_4 } from "next/font/google";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { transcribe } from "../structured-interview/client";
import { moveTrainer, replyTrainer, resumeTrainer, speakTrainer, startTrainer, type TrainerView } from "../structured-interview/trainer-client";
import { FigureCarousel } from "./StructuredInterview";
import styles from "./ObjectionTrainer.module.css";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--ot-sans" });
const serif = Source_Serif_4({ subsets: ["latin"], weight: ["400", "600"], style: ["normal", "italic"], variable: "--ot-serif" });

const SCORE_LABELS = ["", "Needs work", "Needs work", "Getting there", "Strong", "Excellent"];
const ISSUE_LABELS: Record<string, string> = {
  off_label: "Off-label", comparative_claim: "Comparative claim", wrong_trial_or_setting: "Wrong trial or setting",
  inaccurate_number: "Inaccurate number", missing_fair_balance: "Missing fair balance", unsupported_claim: "Unsupported claim",
};

const storageKey = (program: string) => `objection-trainer:${program}`;
const store = {
  get(program: string) { try { return window.sessionStorage.getItem(storageKey(program)); } catch { return null; } },
  set(program: string, id: string) { try { window.sessionStorage.setItem(storageKey(program), id); } catch { /* private mode */ } },
  clear(program: string) { try { window.sessionStorage.removeItem(storageKey(program)); } catch { /* private mode */ } },
};

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return window.btoa(binary);
}

export function ObjectionTrainer({ program }: { program: "nubeqa" }) {
  const [view, setView] = useState<TrainerView | null>(null);
  const [booting, setBooting] = useState(true);
  const [repName, setRepName] = useState("");
  const [team, setTeam] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [spoke, setSpoke] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);

  const show = useCallback((next: TrainerView) => {
    audioRef.current?.pause();
    setView(next);
    if (next.phase === "complete") store.clear(program); else store.set(program, next.sessionId);
    topRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [program]);

  useEffect(() => {
    const existing = store.get(program);
    if (!existing) { setBooting(false); return; }
    resumeTrainer(existing).then(show).catch(() => store.clear(program)).finally(() => setBooting(false));
  }, [program, show]);

  // Stop any live microphone or audio when leaving the page.
  useEffect(() => () => { recorderRef.current?.stop(); audioRef.current?.pause(); }, []);

  const run = async (label: string, work: () => Promise<TrainerView>) => {
    if (busy) return;
    if (recording) recorderRef.current?.stop();
    setBusy(label); setError(null);
    try { show(await work()); } catch (cause) { setError(cause instanceof Error ? cause.message : "Something went wrong. Try again."); }
    finally { setBusy(null); }
  };

  const begin = (event: FormEvent) => {
    event.preventDefault();
    if (!repName.trim()) { setError("Enter your name so your manager can see your progress."); return; }
    void run("Setting up your round…", () => startTrainer(program, repName.trim(), team.trim()));
  };

  const submitReply = () => {
    if (!view || !draft.trim()) return;
    const source = spoke ? "voice" : "text";
    void run(`${view.persona.name} is listening, and your coach is reviewing…`, async () => {
      const next = await replyTrainer(view.sessionId, draft.trim(), source);
      setDraft(""); setSpoke(false);
      return next;
    });
  };

  const hearObjection = async () => {
    if (!view) return;
    try {
      const { audio } = await speakTrainer(view.sessionId);
      if (!audio) return;
      audioRef.current?.pause();
      audioRef.current = new Audio(`data:${audio.mimeType};base64,${audio.base64}`);
      await audioRef.current.play();
    } catch { setError("Audio could not play. Read the objection instead."); }
  };

  const toggleRecording = async () => {
    if (recording) { recorderRef.current?.stop(); return; }
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(t => MediaRecorder.isTypeSupported(t)) ?? "";
      const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        setRecording(false);
        const blob = new Blob(chunks, { type: recorder.mimeType || type || "audio/webm" });
        if (blob.size < 1024) { setError("No speech was picked up. Tap Speak, talk, then tap Stop."); return; }
        setBusy("Transcribing…");
        try {
          const { transcript } = await transcribe(await blobToBase64(blob), blob.type);
          // Speaking is the point of practice, so the transcript goes in for review, not straight to scoring.
          setDraft(previous => [previous, transcript].filter(Boolean).join(" "));
          setSpoke(true);
        } catch (cause) { setError(cause instanceof Error ? cause.message : "Transcription failed. Type your answer instead."); }
        finally { setBusy(null); }
      };
      recorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch { setError("Microphone access is blocked. Allow it in your browser settings, or type your answer."); }
  };

  const objection = view?.objection ?? null;
  const feedback = view?.feedback ?? null;

  return (
    <div className={`${styles.root} ${sans.variable} ${serif.variable}`} ref={topRef}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <div>
            <h1 className={styles.title}>{view?.title ?? "NUBEQA objection practice"}</h1>
            <p className={styles.meta}>{view ? `${view.repName}${view.phase !== "complete" ? ` · Objection ${view.position} of ${view.total}` : " · Round complete"}` : "Sales training"}</p>
          </div>
          {view && view.phase !== "complete" && (
            <button type="button" className={styles.link} disabled={Boolean(busy)} onClick={() => void run("Wrapping up…", () => moveTrainer(view.sessionId, "finish"))}>Finish round</button>
          )}
        </div>
        {view && <div className={styles.progress}><span style={{ width: `${(view.phase === "complete" ? 1 : (view.position - (view.phase === "objection" ? 1 : 0)) / view.total) * 100}%` }} /></div>}
      </header>

      <main className={styles.page}>
        {error && <p className={styles.error} role="alert">{error}</p>}

        {!view && !booting && (
          <form className={styles.start} onSubmit={begin}>
            <h2 className={styles.startTitle}>Practice the conversations that matter</h2>
            <p>A simulated GU medical oncologist will raise five common objections about NUBEQA. Respond the way you would in the office, by typing or speaking. After each one you&apos;ll get a score, coaching, how Dr. Patel would likely react, and a model answer, and you can try again.</p>
            <p className={styles.muted}>You&apos;re scored on acknowledging the concern, using accurate approved evidence, and staying compliant: on-label, no comparative claims without head-to-head data, and fair balance on safety. Your manager can see your scores.</p>
            <label className={styles.field}>Your name<input id="rep-name" value={repName} onChange={e => setRepName(e.target.value)} autoComplete="name" required /></label>
            <label className={styles.field}>Team or territory <span className={styles.muted}>(optional)</span><input id="rep-team" value={team} onChange={e => setTeam(e.target.value)} /></label>
            <button type="submit" className={styles.primary} disabled={Boolean(busy)}>{busy ?? "Start practice"}</button>
          </form>
        )}

        {view && objection && (
          <div className={styles.split}>
            <section className={styles.main}>
              <figure className={styles.objection}>
                <figcaption className={styles.persona}>
                  <span className={styles.avatar} aria-hidden="true">DP</span>
                  <span><strong>{view.persona.name}</strong> · {view.persona.role}</span>
                  <span className={styles.setting}>{objection.setting}</span>
                </figcaption>
                <blockquote className={styles.quote}>{objection.hcpLine}</blockquote>
                <button type="button" className={styles.link} onClick={() => void hearObjection()}>Hear {view.persona.name}</button>
              </figure>

              {view.phase === "objection" && (
                <>
                  <div className={styles.rubric}>
                    <p className={styles.rubricTitle}>A strong answer will</p>
                    <ul>{objection.criteria.map(c => <li key={c.id}>{c.label}</li>)}<li>Stay on-label and compliant</li></ul>
                  </div>
                  <form className={styles.composer} onSubmit={e => { e.preventDefault(); submitReply(); }}>
                    <label htmlFor="reply" className={styles.composerLabel}>
                      Your response{objection.attemptNumber > 1 ? ` · attempt ${objection.attemptNumber}` : ""}
                    </label>
                    <textarea id="reply" value={draft} onChange={e => setDraft(e.target.value)} rows={5} maxLength={6000}
                      placeholder="Respond as you would in the office…" disabled={Boolean(busy)} />
                    <div className={styles.actions}>
                      {typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && (
                        <button type="button" className={styles.secondary} data-on={recording} onClick={() => void toggleRecording()} disabled={Boolean(busy) && !recording}>
                          {recording ? "Stop" : "Speak"}
                        </button>
                      )}
                      <button type="submit" className={styles.primary} disabled={!draft.trim() || Boolean(busy)}>{busy ?? "Get feedback"}</button>
                    </div>
                  </form>
                </>
              )}

              {view.phase === "feedback" && feedback && (
                <section className={styles.feedback} aria-label="Coaching">
                  <div className={styles.scoreRow}>
                    <span className={styles.score} data-score={feedback.score}>{feedback.score}<small>/5</small></span>
                    <div>
                      <p className={styles.scoreLabel}>{SCORE_LABELS[feedback.score]}</p>
                      {feedback.previousScore !== null && (
                        <p className={styles.muted}>{feedback.score > feedback.previousScore ? `Up from ${feedback.previousScore}` : feedback.score < feedback.previousScore ? `Down from ${feedback.previousScore}` : `Same as last try`}</p>
                      )}
                    </div>
                  </div>

                  <blockquote className={styles.reaction}><span className={styles.muted}>{view.persona.name}:</span> {feedback.hcpReaction}</blockquote>

                  {feedback.compliance.length > 0 && (
                    <div className={styles.flags} role="alert">
                      <p className={styles.flagsTitle}>Compliance {feedback.compliance.length === 1 ? "issue" : "issues"}</p>
                      <ul>{feedback.compliance.map((flag, i) => (
                        <li key={i}><strong>{ISSUE_LABELS[flag.issue] ?? flag.issue}:</strong> “{flag.quote}” {flag.explanation}</li>
                      ))}</ul>
                    </div>
                  )}

                  <ul className={styles.criteria}>
                    {feedback.criteria.map(c => (
                      <li key={c.id} data-status={c.status}>
                        <span className={styles.mark} aria-label={c.status}>{c.status === "met" ? "✓" : c.status === "partial" ? "~" : "✕"}</span>
                        <span><strong>{c.label}.</strong> {c.note}</span>
                      </li>
                    ))}
                  </ul>

                  {feedback.strengths.length > 0 && (<><p className={styles.subhead}>What worked</p><ul className={styles.list}>{feedback.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}
                  {feedback.improvements.length > 0 && (<><p className={styles.subhead}>Try next time</p><ul className={styles.list}>{feedback.improvements.map((s, i) => <li key={i}>{s}</li>)}</ul></>)}

                  <details className={styles.model}>
                    <summary>See a model answer</summary>
                    <p>{feedback.modelAnswer}</p>
                  </details>
                  <details className={styles.model}>
                    <summary>Your response</summary>
                    <p>{feedback.reply}</p>
                  </details>

                  <div className={styles.actions}>
                    <button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={() => void run("Resetting…", () => moveTrainer(view.sessionId, "retry"))}>Try again</button>
                    <button type="button" className={styles.primary} disabled={Boolean(busy)} onClick={() => void run("Loading…", () => moveTrainer(view.sessionId, view.position < view.total ? "next" : "finish"))}>
                      {view.position < view.total ? "Next objection" : "See my results"}
                    </button>
                  </div>
                </section>
              )}
            </section>

            <aside className={styles.evidence} aria-label="Evidence you can use">
              <p className={styles.evidenceTitle}>Evidence you can use</p>
              <FigureCarousel key={objection.id} figures={objection.figures} />
              <p className={styles.muted}>Figures from nubeqahcp.com. Always pair efficacy with the Important Safety Information.</p>
            </aside>
          </div>
        )}

        {view?.phase === "complete" && view.summary && (
          <section className={styles.summary}>
            <h2 className={styles.startTitle}>Round complete{view.summary.average !== null ? `: ${view.summary.average} average` : ""}</h2>
            <table className={styles.table}>
              <thead><tr><th scope="col">Objection</th><th scope="col">First try</th><th scope="col">Best</th><th scope="col">Tries</th><th scope="col">Compliance flags</th></tr></thead>
              <tbody>{view.summary.rows.map(row => (
                <tr key={row.id}><th scope="row">{row.title}</th><td>{row.first}</td><td><strong>{row.best}</strong></td><td>{row.attempts}</td><td>{row.complianceFlags || "None"}</td></tr>
              ))}</tbody>
            </table>
            <button type="button" className={styles.primary} onClick={() => { store.clear(program); setView(null); }}>Practice another round</button>
          </section>
        )}
      </main>
    </div>
  );
}
