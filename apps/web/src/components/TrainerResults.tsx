"use client";

import { useCallback, useEffect, useState } from "react";
import { webEnv } from "../env";
import type { StoredAdminSession } from "../admin-session";
import type { TrainerResults as Results } from "../structured-interview/trainer-client";
import { AdminGate } from "./AdminGate";
import styles from "./StructuredResults.module.css";

const ISSUE_LABELS: Record<string, string> = {
  off_label: "Off-label", comparative_claim: "Comparative claim", wrong_trial_or_setting: "Wrong trial or setting",
  inaccurate_number: "Inaccurate number", missing_fair_balance: "Missing fair balance", unsupported_claim: "Unsupported claim",
};
const fmt = (value: number | null) => (value === null ? "–" : value.toFixed(1));
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

function Report({ session, program }: { session: StoredAdminSession; program: string }) {
  const [data, setData] = useState<Results | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const token = session.token;

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/admin/trainer/${program}/results`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error(`Results could not load (${response.status}).`);
      setData((await response.json()) as Results);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Results could not load."); }
  }, [program, token]);

  useEffect(() => { void load(); }, [load]);

  if (error) return <div className={styles.page}><p className={styles.error}>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>;
  if (!data) return <div className={styles.page}><p className={styles.muted}>Loading results…</p></div>;

  const flagged = data.sessions.flatMap(s => s.replies.filter(r => r.compliance.length).map(r => ({ ...r, repName: s.repName })));

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>{data.title}: team results</h1>
          <p className={styles.muted}>Scores are each rep&apos;s best attempt per objection, out of 5. Reps are listed lowest first.</p>
        </div>
        <div className={styles.actions}><button type="button" onClick={() => void load()}>Refresh</button></div>
      </header>

      <dl className={styles.totals}>
        <div><dt>Reps</dt><dd>{data.reps.length}</dd></div>
        <div><dt>Rounds</dt><dd>{data.sessions.length}</dd></div>
        <div><dt>Compliance flags</dt><dd>{flagged.reduce((n, r) => n + r.compliance.length, 0)}</dd></div>
      </dl>

      <section className={styles.question}>
        <h2 className={styles.qTitle}>By rep</h2>
        {data.reps.length === 0 ? <p className={styles.muted}>No practice rounds yet.</p> : (
          <div style={{ overflowX: "auto" }}>
            <table className={styles.bars} style={{ minWidth: 640 }}>
              <thead><tr>
                <th scope="col">Rep</th><th scope="col">Rounds</th><th scope="col">Average</th><th scope="col">Flags</th>
                {data.objections.map(o => <th key={o.id} scope="col" title={o.title}>{o.title}</th>)}
              </tr></thead>
              <tbody>{data.reps.map(rep => (
                <tr key={rep.repName}>
                  <th scope="row">{rep.repName}{rep.team ? <span className={styles.muted}> · {rep.team}</span> : null}<br /><span className={styles.muted}>last {day(rep.lastActive)}</span></th>
                  <td className={styles.num}>{rep.sessions}</td>
                  <td className={styles.num}><strong>{fmt(rep.averageScore)}</strong></td>
                  <td className={styles.num} style={rep.complianceFlags ? { color: "#9a3412", fontWeight: 600 } : undefined}>{rep.complianceFlags || "–"}</td>
                  {rep.byObjection.map(o => <td key={o.id} className={styles.num}>{fmt(o.average)}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className={styles.question}>
        <h2 className={styles.qTitle}>Hardest objections</h2>
        <table className={styles.bars}><tbody>
          {[...data.objections].sort((a, b) => (a.average ?? 9) - (b.average ?? 9)).map(o => (
            <tr key={o.id}><th scope="row">{o.title}</th>
              <td className={styles.barCell}><span className={styles.bar} style={{ width: `${((o.average ?? 0) / 5) * 100}%` }} /></td>
              <td className={styles.num}>{fmt(o.average)}</td><td className={styles.num}>{o.attempts} {o.attempts === 1 ? "round" : "rounds"}</td></tr>
          ))}
        </tbody></table>
      </section>

      <section className={styles.question}>
        <h2 className={styles.qTitle}>Compliance flags</h2>
        {flagged.length === 0 ? <p className={styles.muted}>None so far.</p> : (
          <ul className={styles.detours}>{flagged.map((r, i) => (
            <li key={i}><strong>{r.repName}</strong> on <em>{r.title}</em>: {r.compliance.map(c => `${ISSUE_LABELS[c.issue] ?? c.issue} (“${c.quote}”)`).join("; ")}</li>
          ))}</ul>
        )}
      </section>

      <section className={styles.question}>
        <h2 className={styles.qTitle}>Rounds</h2>
        <ul className={styles.detours}>{data.sessions.map(s => (
          <li key={s.sessionId}>
            <button type="button" onClick={() => setOpen(open === s.sessionId ? null : s.sessionId)} style={{ padding: "2px 8px" }}>{open === s.sessionId ? "Hide" : "Show"}</button>{" "}
            <strong>{s.repName}</strong> · {day(s.startedAt)} · average {fmt(s.average)}{s.completedAt ? "" : " · in progress"}
            {open === s.sessionId && (
              <ul style={{ marginTop: 8 }}>{s.replies.map((r, i) => (
                <li key={i}><strong>{r.title}</strong> — {r.score}/5<br /><span className={styles.muted}>{r.reply}</span>
                  {r.improvements.length > 0 && <><br /><span className={styles.muted}>Coach: {r.improvements.join(" ")}</span></>}</li>
              ))}</ul>
            )}
          </li>
        ))}</ul>
      </section>
    </div>
  );
}

export function TrainerResults({ program }: { program: string }) {
  return <AdminGate>{session => <Report session={session} program={program} />}</AdminGate>;
}
