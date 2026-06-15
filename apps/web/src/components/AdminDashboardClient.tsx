"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { StudySummary } from "@interview/schemas";
import { getStudies } from "../api";
import { AdminGate } from "./AdminGate";

const SURVEY_CARDS = [
  {
    slug: "data",
    name: "Data Survey",
    mode: "Fixed question flow",
    description:
      "One-off canned survey with ordered questions and question-specific assets.",
    liveHref: "/surveys/data/",
  },
  {
    slug: "padcev",
    name: "PADCEV HCP",
    mode: "Adaptive clinical survey",
    description:
      "Adaptive PADCEV interview with controlled source context and side-panel evidence.",
    liveHref: "/surveys/padcev/",
  },
  {
    slug: "brukinsa",
    name: "BRUKINSA HCP",
    mode: "Adaptive clinical survey",
    description:
      "Adaptive BRUKINSA interview using the same reusable admin and source workflow.",
    liveHref: "/surveys/brukinsa/",
  },
];

function findStudy(studies: StudySummary[], slug: string) {
  return studies.find(
    (study) =>
      study.slug === slug ||
      study.name.toLowerCase().includes(slug.toLowerCase()),
  );
}

export function AdminDashboardClient() {
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStudies()
      .then((response) => {
        if (!cancelled) {
          setStudies(response);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load surveys.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const totals = useMemo(
    () => ({
      surveys: studies.length,
      sessions: studies.reduce((total, study) => total + study.sessionCount, 0),
      active: studies.filter((study) => study.status === "ACTIVE").length,
    }),
    [studies],
  );

  return (
    <AdminGate>
      {(_session, { logout }) => (
        <main className="admin-page">
          <section className="admin-shell">
            <header className="admin-topbar">
              <div>
                <p className="admin-kicker">PulseRx Backend</p>
                <h1>Survey Admin</h1>
                <p>
                  Manage survey guides, source libraries, side-panel assets, and
                  launch checks from one place.
                </p>
              </div>
              <button className="admin-button" onClick={logout} type="button">
                Sign out
              </button>
            </header>

            {error ? <p className="admin-error">{error}</p> : null}

            <section className="admin-stat-grid">
              <article>
                <span>Configured studies</span>
                <strong>{loading ? "..." : totals.surveys}</strong>
              </article>
              <article>
                <span>Total sessions</span>
                <strong>{loading ? "..." : totals.sessions}</strong>
              </article>
              <article>
                <span>Active studies</span>
                <strong>{loading ? "..." : totals.active}</strong>
              </article>
            </section>

            <section className="admin-section-header">
              <div>
                <h2>Surveys</h2>
                <p>Open a survey-specific backend or jump to the live link.</p>
              </div>
              <div className="admin-actions">
                <Link className="admin-button" href="/admin/import/">
                  Import Guide
                </Link>
                <Link className="admin-button" href="/admin/source-library/">
                  Source Library
                </Link>
              </div>
            </section>

            <section className="admin-card-grid">
              {SURVEY_CARDS.map((survey) => {
                const study = findStudy(studies, survey.slug);
                return (
                  <article className="admin-card" key={survey.slug}>
                    <div className="admin-card-head">
                      <div>
                        <span className="admin-chip">{survey.mode}</span>
                        <h3>{survey.name}</h3>
                      </div>
                      <span
                        className={
                          study ? "admin-status active" : "admin-status"
                        }
                      >
                        {study ? study.status : "Not imported"}
                      </span>
                    </div>
                    <p>{survey.description}</p>
                    {study ? (
                      <p className="admin-card-meta">
                        {study.sessionCount} captured session
                        {study.sessionCount === 1 ? "" : "s"}
                      </p>
                    ) : (
                      <p className="admin-card-meta">
                        Import or publish this guide before launch.
                      </p>
                    )}
                    <div className="admin-card-actions">
                      <Link
                        className="admin-button admin-button-primary"
                        href={`/admin/surveys/${survey.slug}/`}
                      >
                        Manage
                      </Link>
                      <Link className="admin-button" href={survey.liveHref}>
                        Live survey
                      </Link>
                    </div>
                  </article>
                );
              })}
            </section>
          </section>
        </main>
      )}
    </AdminGate>
  );
}
