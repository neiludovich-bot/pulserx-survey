"use client";

import Link from "next/link";
import { useState } from "react";
import type {
  IntegrationReadinessResponse,
  IntegrationVerificationResponse,
} from "@interview/schemas";
import { verifyIntegrations } from "../api";

type Props = {
  readiness: IntegrationReadinessResponse;
};

type ProviderStatus =
  | "ready"
  | "missing_config"
  | "passed"
  | "skipped"
  | "failed";

function statusLabel(status: ProviderStatus) {
  if (status === "missing_config") {
    return "Needs Config";
  }

  return status[0].toUpperCase() + status.slice(1);
}

function statusClass(status: ProviderStatus) {
  if (status === "ready" || status === "passed") {
    return "status-pill status-pill-good";
  }

  if (status === "failed") {
    return "status-pill status-pill-bad";
  }

  return "status-pill status-pill-muted";
}

function latencyText(latencyMs: number | null) {
  return latencyMs === null ? null : `${latencyMs} ms`;
}

export function IntegrationVerificationPanel({ readiness }: Props) {
  const [verification, setVerification] =
    useState<IntegrationVerificationResponse | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleVerify() {
    setIsVerifying(true);
    setError(null);

    try {
      setVerification(await verifyIntegrations());
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Integration verification failed.",
      );
    } finally {
      setIsVerifying(false);
    }
  }

  const openAiStatus =
    verification?.openaiRealtime.status ?? readiness.openaiRealtime.status;
  const customGptStatus =
    verification?.customGpt.status ?? readiness.customGpt.status;
  const generatedAt = verification?.generatedAt ?? readiness.generatedAt;

  return (
    <section className="detail-grid">
      <article className="panel stack-sm">
        <div className="panel-title-row">
          <span className="label">Realtime Voice</span>
          <span className={statusClass(openAiStatus)}>
            {statusLabel(openAiStatus)}
          </span>
        </div>
        <h2>OpenAI Realtime</h2>
        <p className="muted-copy">
          Model {readiness.openaiRealtime.model}
          {verification?.openaiRealtime.expiresAt
            ? ` | session expires ${verification.openaiRealtime.expiresAt}`
            : ""}
        </p>
        <p className="muted-copy">
          {verification
            ? (verification.openaiRealtime.reason ??
              latencyText(verification.openaiRealtime.latencyMs) ??
              "Provider check completed.")
            : (readiness.openaiRealtime.reason ??
              "Low-latency voice sessions can be created.")}
        </p>
      </article>

      <article className="panel stack-sm">
        <div className="panel-title-row">
          <span className="label">CustomGPT Grounding</span>
          <span className={statusClass(customGptStatus)}>
            {statusLabel(customGptStatus)}
          </span>
        </div>
        <h2>CustomGPT Project</h2>
        <p className="muted-copy">{readiness.customGpt.baseUrl}</p>
        {readiness.customGpt.studyProjectCount > 0 ? (
          <p className="micro-copy">
            {readiness.customGpt.studyProjectCount} study project
            {readiness.customGpt.studyProjectCount === 1 ? "" : "s"} connected
          </p>
        ) : null}
        <p className="muted-copy">
          {verification
            ? (verification.customGpt.reason ??
              latencyText(verification.customGpt.latencyMs) ??
              "Provider check completed.")
            : (readiness.customGpt.reason ??
              "Project is configured for clarification grounding.")}
        </p>
      </article>

      <article className="panel integration-actions">
        <div className="stack-sm">
          <span className="label">Provider Verification</span>
          <h2>Active Checks</h2>
          <p className="muted-copy">
            Last generated {generatedAt}
            {verification
              ? ` | CustomGPT response ${
                  verification.customGpt.responseReceived
                    ? "received"
                    : "not received"
                }`
              : ""}
          </p>
          {error ? <p className="error-copy">{error}</p> : null}
          {readiness.setupActions.length > 0 ? (
            <ul className="plain-list">
              {readiness.setupActions.map((action) => (
                <li key={action.key}>
                  <strong>{action.label}</strong>
                  <span className="muted-copy">{action.detail}</span>
                  {action.href ? (
                    <Link className="text-link" href={action.href}>
                      Open Setup
                    </Link>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <button
          className="button-primary"
          disabled={isVerifying}
          onClick={handleVerify}
          type="button"
        >
          {isVerifying ? "Checking..." : "Verify Providers"}
        </button>
      </article>
    </section>
  );
}
