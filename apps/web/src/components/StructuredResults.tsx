"use client";

import { useCallback, useEffect, useState } from "react";
import { webEnv } from "../env";
import type { StoredAdminSession } from "../admin-session";
import type { ResultsSummary } from "../structured-interview/client";
import { AdminGate } from "./AdminGate";
import styles from "./StructuredResults.module.css";

const percent = (share: number) => `${Math.round(share * 100)}%`;

function Results({ session, surveySlug }: { session: StoredAdminSession; surveySlug: string }) {
  const [summary, setSummary] = useState<ResultsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const token = session.token;

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/admin/structured-interview/${surveySlug}/results`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error(`Results could not load (${response.status}).`);
      setSummary((await response.json()) as ResultsSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Results could not load.");
    }
  }, [surveySlug, token]);

  useEffect(() => { void load(); }, [load]);

  const download = async () => {
    const response = await fetch(`${webEnv.NEXT_PUBLIC_API_BASE_URL}/admin/structured-interview/${surveySlug}/export.csv`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { setError(`Export failed (${response.status}).`); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url; link.download = `${surveySlug}-interviews.csv`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  if (error) return <div className={styles.page}><p className={styles.error}>{error}</p><button type="button" onClick={() => void load()}>Try again</button></div>;
  if (!summary) return <div className={styles.page}><p className={styles.muted}>Loading results…</p></div>;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>{summary.title}: results</h1>
          <p className={styles.muted}>Guide version {summary.surveyVersion}</p>
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={() => void load()}>Refresh</button>
          <button type="button" className={styles.primary} onClick={() => void download()}>Download CSV</button>
        </div>
      </header>

      <dl className={styles.totals}>
        <div><dt>Completed</dt><dd>{summary.totals.completed}</dd></div>
        <div><dt>Started</dt><dd>{summary.totals.started}</dd></div>
        <div><dt>Ended early</dt><dd>{summary.totals.stopped}</dd></div>
        <div><dt>Declined</dt><dd>{summary.totals.declined}</dd></div>
        <div><dt>Median length</dt><dd>{summary.totals.medianMinutes === null ? "–" : `${summary.totals.medianMinutes} min`}</dd></div>
      </dl>

      {summary.questions.map(question => (
        <section key={question.id} className={styles.question}>
          <h2 className={styles.qTitle}>{question.label}</h2>
          <p className={styles.muted}>{question.prompt} · {question.responses} {question.responses === 1 ? "response" : "responses"}{question.kind === "multi" ? " · multiple answers allowed" : ""}</p>
          <table className={styles.bars}>
            <tbody>
              {question.options.map(option => (
                <tr key={option.id}>
                  <th scope="row">{option.label}</th>
                  <td className={styles.barCell}><span className={styles.bar} style={{ width: percent(option.share) }} /></td>
                  <td className={styles.num}>{percent(option.share)}</td>
                  <td className={styles.num}>{option.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {question.verbatims.length > 0 && (
            <details className={styles.verbatims}>
              <summary>{question.verbatims.length} in their own words</summary>
              <ul>
                {question.verbatims.map((verbatim, index) => (
                  <li key={`${verbatim.sessionId}-${index}`}><span className={styles.muted}>{verbatim.optionLabels}:</span> {verbatim.text}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ))}

      <section className={styles.question}>
        <h2 className={styles.qTitle}>Questions HCPs asked</h2>
        {summary.detours.length === 0 ? <p className={styles.muted}>None yet.</p> : (
          <ul className={styles.detours}>
            {summary.detours.map((detour, index) => (
              <li key={`${detour.sessionId}-${index}`}>{detour.question}{detour.answered ? "" : <span className={styles.muted}> (not answered from the site)</span>}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export function StructuredResults({ surveySlug }: { surveySlug: string }) {
  return <AdminGate>{session => <Results session={session} surveySlug={surveySlug} />}</AdminGate>;
}
