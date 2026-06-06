import Link from "next/link";
import {
  getIntegrationReadiness,
  getLocalEnvironmentConfig,
  getStudies,
} from "../../../src/api";
import { LocalEnvironmentForm } from "../../../src/components/LocalEnvironmentForm";

function statusText(configured: boolean) {
  return configured ? "Configured" : "Needs Config";
}

type ResearchSetupPageProps = {
  searchParams?: Promise<{
    returnTo?: string | string[];
  }>;
};

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;

  if (!candidate) {
    return null;
  }

  if (
    (candidate !== "/research" && !candidate.startsWith("/research/")) ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.includes("\n") ||
    candidate.includes("\r")
  ) {
    return null;
  }

  return candidate;
}

function returnToLabel(returnToHref: string | null) {
  if (!returnToHref) {
    return "Back to studies";
  }

  if (returnToHref.includes("#customgpt-sources")) {
    return "Back to CustomGPT Sources";
  }

  if (returnToHref.includes("#customgpt-project")) {
    return "Back to CustomGPT Project";
  }

  if (returnToHref.includes("#source-context")) {
    return "Back to Source Context";
  }

  if (returnToHref.includes("#voice-settings")) {
    return "Back to Voice Settings";
  }

  if (returnToHref.includes("/settings")) {
    return "Back to Study Settings";
  }

  return "Back to launch check";
}

export default async function ResearchSetupPage({
  searchParams,
}: ResearchSetupPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const returnToHref = safeReturnTo(resolvedSearchParams.returnTo);
  const [readiness, studies, localEnvironment] = await Promise.all([
    getIntegrationReadiness(),
    getStudies(),
    getLocalEnvironmentConfig(),
  ]);

  return (
    <main className="shell">
      <section className="page-header">
        <Link className="back-link" href={returnToHref ?? "/research"}>
          {returnToLabel(returnToHref)}
        </Link>
        <p className="eyebrow">Operational Setup</p>
        <h1>Admin Checklist</h1>
        <p className="lede">
          Configure provider secrets, connect studies to CustomGPT projects, and
          import survey guides into runnable adaptive interviews.
        </p>
      </section>

      <LocalEnvironmentForm
        initialConfig={localEnvironment}
        returnToHref={returnToHref}
      />

      <section className="detail-grid">
        <article className="panel stack-md">
          <div className="panel-title-row">
            <span className="label">Environment Secrets</span>
            <span
              className={
                readiness.openaiRealtime.configured &&
                readiness.customGpt.configured
                  ? "status-pill status-pill-good"
                  : "status-pill status-pill-muted"
              }
            >
              {readiness.openaiRealtime.configured &&
              readiness.customGpt.configured
                ? "Ready"
                : "Needs Keys"}
            </span>
          </div>
          <p className="muted-copy">
            Store real API keys in `.env` or production secret storage. In local
            development, the credentials form above updates `.env` for you.
            Study settings still control which CustomGPT project each survey
            uses.
          </p>
          <pre className="setup-code">{`OPENAI_API_KEY=...
CUSTOMGPT_API_KEY=...
# Optional default; per-study project IDs can be set in Study Settings
CUSTOMGPT_PROJECT_ID=...`}</pre>
        </article>

        <article className="panel stack-md">
          <span className="label">Provider Status</span>
          <ul className="plain-list">
            <li>
              <strong>OpenAI Realtime</strong>
              <span className="muted-copy">
                {statusText(readiness.openaiRealtime.configured)}
                {readiness.openaiRealtime.reason
                  ? ` | ${readiness.openaiRealtime.reason}`
                  : ` | ${readiness.openaiRealtime.model}`}
              </span>
            </li>
            <li>
              <strong>CustomGPT API</strong>
              <span className="muted-copy">
                {statusText(readiness.customGpt.configured)}
                {readiness.customGpt.reason
                  ? ` | ${readiness.customGpt.reason}`
                  : ` | ${readiness.customGpt.baseUrl}`}
              </span>
              {readiness.customGpt.studyProjectCount > 0 ? (
                <span className="micro-copy">
                  {readiness.customGpt.studyProjectCount} study project
                  {readiness.customGpt.studyProjectCount === 1 ? "" : "s"}{" "}
                  connected
                </span>
              ) : null}
            </li>
          </ul>
        </article>
      </section>

      <section className="detail-grid">
        <article className="panel stack-md">
          <div className="panel-title-row">
            <span className="label">Next Actions</span>
            <span
              className={
                readiness.setupActions.length === 0
                  ? "status-pill status-pill-good"
                  : "status-pill status-pill-muted"
              }
            >
              {readiness.setupActions.length === 0 ? "Ready" : "Action Needed"}
            </span>
          </div>
          {readiness.setupActions.length > 0 ? (
            <ul className="plain-list">
              {readiness.setupActions.map((action) => (
                <li key={action.key}>
                  <strong>{action.label}</strong>
                  <span className="muted-copy">{action.detail}</span>
                  {action.href ? (
                    <Link className="text-link" href={action.href}>
                      Open
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted-copy">
              Provider configuration is ready for active verification.
            </p>
          )}
        </article>

        <article className="panel stack-md">
          <span className="label">Create Surveys</span>
          <h2>Import Guide</h2>
          <p className="muted-copy">
            Upload a DOCX or paste raw questions, review the generated adaptive
            survey preview, then publish it into Postgres.
          </p>
          <Link className="button-primary" href="/research/import">
            Import Survey
          </Link>
        </article>

        <article className="panel stack-md">
          <span className="label">Connect Knowledge</span>
          <h2>Per-Study CustomGPT</h2>
          <p className="muted-copy">
            Load the source site or assets into CustomGPT, then paste that
            project ID into the relevant study settings page.
          </p>
          <ul className="plain-list">
            {studies.map((study) => (
              <li className="session-row" key={study.id}>
                <div className="stack-sm">
                  <strong>{study.name}</strong>
                  <span className="muted-copy">{study.status}</span>
                </div>
                <Link
                  className="text-link"
                  href={`/research/studies/${study.id}/settings`}
                >
                  Settings
                </Link>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </main>
  );
}
