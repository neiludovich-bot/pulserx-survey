"use client";

import type { StudyGraphResponse } from "@interview/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { abandonStudyOpenSessions } from "../api";

type StudySessionPanelProps = {
  recentSessions: StudyGraphResponse["recentSessions"];
  sessionSummary: StudyGraphResponse["sessionSummary"];
  studyId: string;
};

export function StudySessionPanel({
  recentSessions,
  sessionSummary,
  studyId,
}: StudySessionPanelProps) {
  const router = useRouter();
  const [isAbandoning, setIsAbandoning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAbandonOpenSessions() {
    const confirmed = window.confirm(
      "Mark all active and pending sessions for this study as abandoned? This keeps audit history but stops those respondent links from continuing.",
    );
    if (!confirmed) {
      return;
    }

    setIsAbandoning(true);
    setStatus(null);
    setError(null);

    try {
      const result = await abandonStudyOpenSessions(studyId);
      setStatus(
        `Abandoned ${result.abandonedCount} open session(s). ${result.remainingOpenSessionCount} remain open.`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to abandon sessions.",
      );
    } finally {
      setIsAbandoning(false);
    }
  }

  return (
    <article className="panel stack-md" id="session-management">
      <div className="panel-title-row">
        <div className="stack-sm">
          <span className="label">Session Management</span>
          <h2>{sessionSummary.openSessionCount} open session(s)</h2>
        </div>
        <span
          className={
            sessionSummary.openSessionCount === 0
              ? "status-pill status-pill-good"
              : "status-pill status-pill-muted"
          }
        >
          {sessionSummary.openSessionCount === 0 ? "Clear" : "Open"}
        </span>
      </div>

      <div className="detail-grid">
        <div className="stack-sm">
          <span className="label">Active</span>
          <strong>{sessionSummary.activeSessionCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Pending</span>
          <strong>{sessionSummary.pendingSessionCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Completed</span>
          <strong>{sessionSummary.completedSessionCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Abandoned</span>
          <strong>{sessionSummary.abandonedSessionCount}</strong>
        </div>
      </div>

      {sessionSummary.openSessionCount > 0 ? (
        <>
          <p className="muted-copy">
            Open sessions protect in-progress respondent paths from guide
            changes. Abandon stale test/respondent sessions before fielding a
            fresh respondent link or applying guide cleanup.
          </p>
          <button
            className="button-secondary"
            disabled={isAbandoning}
            onClick={handleAbandonOpenSessions}
            type="button"
          >
            {isAbandoning ? "Closing..." : "Abandon Open Sessions"}
          </button>
        </>
      ) : (
        <p className="muted-copy">
          No active or pending sessions are blocking guide edits.
        </p>
      )}

      {status ? <p className="muted-copy">{status}</p> : null}
      {error ? <p className="error-copy">{error}</p> : null}

      <div className="stack-sm">
        <h3>Recent Sessions</h3>
        {recentSessions.length === 0 ? (
          <p className="muted-copy">No sessions yet.</p>
        ) : (
          <ul className="plain-list">
            {recentSessions.map((session) => (
              <li className="session-row" key={session.id}>
                <div className="stack-sm">
                  <strong>{session.respondentLabel}</strong>
                  <span className="muted-copy">
                    {session.turnCount} turns | {session.status}
                  </span>
                </div>
                <Link
                  className="text-link"
                  href={`/research/sessions/${session.id}`}
                >
                  Review audit
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
