"use client";

import type {
  MvpSurveyAuditDetailResponse,
  MvpSurveyAuditListResponse,
} from "@interview/schemas";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import {
  getMvpSurveyAuditSession,
  getMvpSurveyAuditSessions,
} from "../api";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "Not recorded";
}

function preview(text: string | null, fallback = "No current question") {
  if (!text) {
    return fallback;
  }

  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  if (value === null || typeof value === "undefined") {
    return null;
  }

  return (
    <details className="audit-json">
      <summary>{label}</summary>
      <pre>{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function MvpAuditClient() {
  const searchParams = useSearchParams();
  const selectedSessionId = searchParams.get("session");
  const [sessionList, setSessionList] =
    useState<MvpSurveyAuditListResponse | null>(null);
  const [selectedSession, setSelectedSession] =
    useState<MvpSurveyAuditDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadAudit() {
      setLoading(true);
      setError(null);

      try {
        const [list, detail] = await Promise.all([
          getMvpSurveyAuditSessions(),
          selectedSessionId
            ? getMvpSurveyAuditSession(selectedSessionId).catch(() => null)
            : Promise.resolve(null),
        ]);

        if (!cancelled) {
          setSessionList(list);
          setSelectedSession(detail);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load MVP audit.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadAudit();

    return () => {
      cancelled = true;
    };
  }, [selectedSessionId]);

  if (loading && !sessionList) {
    return (
      <section className="panel stack-sm">
        <h2>Loading Audit</h2>
        <p className="muted-copy">Fetching recent MVP survey traces...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel stack-sm">
        <h2>Audit Unavailable</h2>
        <p className="muted-copy">{error}</p>
      </section>
    );
  }

  if (!sessionList) {
    return null;
  }

  return (
    <>
      {!sessionList.dbConfigured ? (
        <section className="panel stack-sm">
          <h2>Database Audit Is Not Configured</h2>
          <p className="muted-copy">
            Set `DATABASE_URL` on the API host to persist and inspect MVP survey
            sessions here.
          </p>
        </section>
      ) : null}

      <section className="panel stack-md">
        <div className="panel-title-row">
          <div>
            <span className="label">
              Generated {formatDate(sessionList.generatedAt)}
            </span>
            <h2>Recent Sessions</h2>
          </div>
        </div>

        {sessionList.sessions.length === 0 ? (
          <p className="muted-copy">
            No persisted MVP survey sessions have been captured yet.
          </p>
        ) : (
          <ul className="plain-list compact-list">
            {sessionList.sessions.map((session) => (
              <li key={session.id}>
                <strong>{session.studyName}</strong>
                <span className="muted-copy">
                  {session.status} | {formatDate(session.startedAt)} |{" "}
                  {session.turnCount} turn(s) | {session.decisionCount}{" "}
                  decision(s)
                </span>
                <p className="micro-copy">
                  {session.surveyIntentLabel ?? session.sourceBrand ?? "MVP"} |{" "}
                  {preview(session.currentQuestion)}
                </p>
                <Link
                  className="button-secondary"
                  href={`/research/mvp-audit?session=${session.id}`}
                >
                  Open Trace
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedSessionId && !selectedSession && !loading ? (
        <section className="panel stack-sm">
          <h2>Session Not Found</h2>
          <p className="muted-copy">
            The selected MVP audit session was not found in the hosted audit
            store.
          </p>
        </section>
      ) : null}

      {selectedSession ? (
        <section className="stack-lg">
          <article className="panel stack-md">
            <div className="panel-title-row">
              <div>
                <span className="label">{selectedSession.session.status}</span>
                <h2>{selectedSession.session.studyName}</h2>
              </div>
              <span className="status-pill status-pill-muted">
                {selectedSession.session.surveyIntentLabel ?? "General"}
              </span>
            </div>
            <p>{preview(selectedSession.session.currentQuestion)}</p>
            <p className="muted-copy">
              Started {formatDate(selectedSession.session.startedAt)}
              {selectedSession.session.completedAt
                ? ` | Completed ${formatDate(
                    selectedSession.session.completedAt,
                  )}`
                : ""}
            </p>
            {selectedSession.session.completedReason ? (
              <p className="micro-copy">
                Completed because {selectedSession.session.completedReason}
              </p>
            ) : null}
          </article>

          <article className="panel stack-md">
            <h2>Turn Trace</h2>
            <div className="transcript-stack">
              {selectedSession.turns.map((turn) => (
                <article
                  className={`chat-bubble ${
                    turn.role === "PARTICIPANT"
                      ? "chat-bubble-participant"
                      : "chat-bubble-interviewer"
                  }`}
                  key={turn.id}
                >
                  <span className="chat-role">
                    #{turn.sequence} {turn.role}
                  </span>
                  <p>{turn.content}</p>
                  <JsonDetails label="Turn Metadata" value={turn.payload} />
                </article>
              ))}
            </div>
          </article>

          <article className="panel stack-md">
            <h2>Selection Decisions</h2>
            {selectedSession.decisions.length === 0 ? (
              <p className="muted-copy">
                No decision records were captured for this session.
              </p>
            ) : (
              <ul className="plain-list">
                {selectedSession.decisions.map((decision) => (
                  <li key={decision.id}>
                    <strong>{decision.kind}</strong>
                    <span className="muted-copy">
                      {decision.status} | {formatDate(decision.createdAt)}
                    </span>
                    {decision.rationale ? (
                      <p className="micro-copy">{decision.rationale}</p>
                    ) : null}
                    <div className="audit-grid">
                      <JsonDetails label="Input" value={decision.input} />
                      <JsonDetails label="Output" value={decision.output} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </section>
      ) : null}
    </>
  );
}
