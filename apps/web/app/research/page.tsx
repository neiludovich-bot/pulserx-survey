import Link from "next/link";
import {
  getIntegrationReadiness,
  getStudies,
  getStudyLaunchCheck,
} from "../../src/api";
import { IntegrationVerificationPanel } from "../../src/components/IntegrationVerificationPanel";

export default async function ResearchPage() {
  const [studies, readiness] = await Promise.all([
    getStudies(),
    getIntegrationReadiness(),
  ]);
  const launchChecks = await Promise.all(
    studies.map((study) => getStudyLaunchCheck(study.id)),
  );
  const launchCheckByStudyId = new Map(
    launchChecks.map((launchCheck) => [launchCheck.studyId, launchCheck]),
  );

  return (
    <main className="shell">
      <section className="page-header">
        <p className="eyebrow">Researcher Console</p>
        <h1>Studies</h1>
        <p className="lede">
          Review seeded studies, inspect each question graph, and launch test
          sessions that produce a full turn-by-turn audit trail.
        </p>
        <div className="composer-actions">
          <Link className="button-primary" href="/research/import">
            Import Survey
          </Link>
          <Link className="button-secondary" href="/research/setup">
            Setup Checklist
          </Link>
        </div>
      </section>

      <IntegrationVerificationPanel readiness={readiness} />

      <section className="panel-grid">
        {studies.map((study) => {
          const launchCheck = launchCheckByStudyId.get(study.id) ?? null;
          const nextAction = launchCheck?.recommendedActions[0] ?? null;
          const blockerCount = launchCheck?.blockingItemCount ?? 0;
          const warningCount = launchCheck?.warningItemCount ?? 0;
          const statusLabel =
            blockerCount > 0
              ? "Needs Setup"
              : warningCount > 0
                ? "Review"
                : "Ready";
          const statusClass =
            blockerCount > 0
              ? "status-pill status-pill-bad"
              : warningCount > 0
                ? "status-pill status-pill-muted"
                : "status-pill status-pill-good";

          return (
            <article className="panel study-card" key={study.id}>
              <div className="panel-title-row">
                <span className="label">{study.status}</span>
                {launchCheck ? (
                  <span className={statusClass}>{statusLabel}</span>
                ) : null}
              </div>
              <h2>{study.name}</h2>
              <p>{study.description}</p>
              <p className="muted-copy">
                {study.sessionCount} session(s) recorded
              </p>
              {launchCheck ? (
                <p className="muted-copy">
                  {blockerCount} blocker(s) | {warningCount} warning(s)
                </p>
              ) : null}
              {nextAction ? (
                <p className="micro-copy">
                  Next: {nextAction.label} - {nextAction.action}
                </p>
              ) : null}
              <Link
                className="button-secondary"
                href={nextAction?.actionHref ?? `/research/studies/${study.id}`}
              >
                {nextAction?.actionLabel ?? "Open Study"}
              </Link>
            </article>
          );
        })}
      </section>
    </main>
  );
}
