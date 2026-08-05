"use client";

import type {
  IntegrationVerificationResponse,
  LocalEnvironmentConfigResponse,
  UpdateLocalEnvironmentConfig,
} from "@interview/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { FormEvent } from "react";
import { updateLocalEnvironmentConfig, verifyIntegrations } from "../api";

type Props = {
  initialConfig: LocalEnvironmentConfigResponse;
  returnToHref?: string | null;
};

function returnToLabel(returnToHref: string | null) {
  if (!returnToHref) {
    return null;
  }

  if (returnToHref.includes("#customgpt-sources")) {
    return "Continue to CustomGPT Sources";
  }

  if (returnToHref.includes("#customgpt-project")) {
    return "Continue to CustomGPT Project";
  }

  if (returnToHref.includes("#source-context")) {
    return "Continue to Source Context";
  }

  if (returnToHref.includes("#voice-settings")) {
    return "Continue to Voice Settings";
  }

  if (returnToHref.includes("/settings")) {
    return "Continue to Study Settings";
  }

  return "Return to Launch Check";
}

export function LocalEnvironmentForm({
  initialConfig,
  returnToHref = null,
}: Props) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [customGptApiKey, setCustomGptApiKey] = useState("");
  const [customGptProjectId, setCustomGptProjectId] = useState(
    initialConfig.customGptProjectId ?? "",
  );
  const [customGptApiBaseUrl, setCustomGptApiBaseUrl] = useState(
    initialConfig.customGptApiBaseUrl,
  );
  const [openaiRealtimeModel, setOpenaiRealtimeModel] = useState(
    initialConfig.openaiRealtimeModel,
  );
  const [openaiTranscriptionModel, setOpenaiTranscriptionModel] = useState(
    initialConfig.openaiTranscriptionModel,
  );
  const [openaiTtsModel, setOpenaiTtsModel] = useState(
    initialConfig.openaiTtsModel,
  );
  const [openaiTtsSpeed, setOpenaiTtsSpeed] = useState(
    String(initialConfig.openaiTtsSpeed),
  );
  const [status, setStatus] = useState<string | null>(null);
  const [verification, setVerification] =
    useState<IntegrationVerificationResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const returnLabel = returnToLabel(returnToHref);

  async function runVerification() {
    setIsVerifying(true);
    setVerification(null);

    try {
      const result = await verifyIntegrations();
      setVerification(result);
      return result;
    } finally {
      setIsVerifying(false);
    }
  }

  function providerStatusCopy(provider: {
    reason: string | null;
    latencyMs: number | null;
  }) {
    return (
      provider.reason ??
      (provider.latencyMs === null
        ? "Provider check completed."
        : `${provider.latencyMs} ms`)
    );
  }

  async function handleVerifyOnly() {
    setStatus(null);

    try {
      await runVerification();
      setStatus("Provider verification completed.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to verify providers.",
      );
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus(null);
    setIsSaving(true);

    const payload: UpdateLocalEnvironmentConfig = {
      customGptProjectId,
      customGptApiBaseUrl,
      openaiRealtimeModel,
      openaiTranscriptionModel,
      openaiTtsModel,
      openaiTtsSpeed: Number(openaiTtsSpeed),
    };

    if (openaiApiKey.trim()) {
      payload.openaiApiKey = openaiApiKey;
    }

    if (customGptApiKey.trim()) {
      payload.customGptApiKey = customGptApiKey;
    }

    try {
      const nextConfig = await updateLocalEnvironmentConfig(payload);
      setConfig(nextConfig);
      setOpenaiApiKey("");
      setCustomGptApiKey("");
      const result = await runVerification();
      setStatus(
        `Local environment saved and applied. OpenAI ${result.openaiRealtime.status}; CustomGPT ${result.customGpt.status}.${
          returnLabel ? ` ${returnLabel} when you are ready.` : ""
        }`,
      );
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to save local setup.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form className="panel stack-md" onSubmit={handleSubmit}>
      <div className="panel-title-row">
        <div className="stack-sm">
          <span className="label">Local Credentials</span>
          <h2>Provider Keys</h2>
        </div>
        <span
          className={
            config.enabled ? "status-pill status-pill-good" : "status-pill"
          }
        >
          {config.enabled ? "Local" : "Disabled"}
        </span>
      </div>

      <p className="muted-copy">
        Use this on your local machine to update `.env`. Existing secrets are
        never shown; leave secret fields blank to keep the current value. Saved
        values are also applied to the running API process.
      </p>
      <p className="micro-copy">{config.envPath}</p>
      {config.reason ? <p className="error-copy">{config.reason}</p> : null}

      <div className="form-grid">
        <label className="form-field">
          <span>OpenAI API Key</span>
          <input
            autoComplete="off"
            disabled={!config.enabled}
            onChange={(event) => setOpenaiApiKey(event.target.value)}
            placeholder={config.openaiApiKey.masked ?? "Paste OpenAI key"}
            type="password"
            value={openaiApiKey}
          />
        </label>

        <label className="form-field">
          <span>CustomGPT API Key</span>
          <input
            autoComplete="off"
            disabled={!config.enabled}
            onChange={(event) => setCustomGptApiKey(event.target.value)}
            placeholder={config.customGptApiKey.masked ?? "Paste CustomGPT key"}
            type="password"
            value={customGptApiKey}
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Default CustomGPT Project ID</span>
          <input
            disabled={!config.enabled}
            onChange={(event) => setCustomGptProjectId(event.target.value)}
            placeholder="Optional default project"
            value={customGptProjectId}
          />
        </label>

        <label className="form-field">
          <span>CustomGPT API Base URL</span>
          <input
            disabled={!config.enabled}
            onChange={(event) => setCustomGptApiBaseUrl(event.target.value)}
            value={customGptApiBaseUrl}
          />
        </label>
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Realtime Voice Model</span>
          <input
            disabled={!config.enabled}
            onChange={(event) => setOpenaiRealtimeModel(event.target.value)}
            value={openaiRealtimeModel}
          />
        </label>

        <label className="form-field">
          <span>Transcription Model</span>
          <input
            disabled={!config.enabled}
            onChange={(event) =>
              setOpenaiTranscriptionModel(event.target.value)
            }
            value={openaiTranscriptionModel}
          />
        </label>

        <label className="form-field">
          <span>TTS Model</span>
          <input
            disabled={!config.enabled}
            onChange={(event) => setOpenaiTtsModel(event.target.value)}
            value={openaiTtsModel}
          />
        </label>

        <label className="form-field">
          <span>TTS Speed</span>
          <input
            disabled={!config.enabled}
            max="4"
            min="0.25"
            onChange={(event) => setOpenaiTtsSpeed(event.target.value)}
            step="0.05"
            type="number"
            value={openaiTtsSpeed}
          />
        </label>
      </div>

      {verification ? (
        <div className="detail-grid">
          <div className="stack-sm">
            <span className="label">OpenAI Verification</span>
            <strong>{verification.openaiRealtime.status}</strong>
            <span className="muted-copy">
              {providerStatusCopy(verification.openaiRealtime)}
            </span>
          </div>
          <div className="stack-sm">
            <span className="label">CustomGPT Verification</span>
            <strong>{verification.customGpt.status}</strong>
            <span className="muted-copy">
              {providerStatusCopy(verification.customGpt)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="composer-actions">
        {status ? <p className="muted-copy">{status}</p> : null}
        {returnToHref && returnLabel ? (
          <Link className="button-secondary" href={returnToHref}>
            {returnLabel}
          </Link>
        ) : null}
        <button
          className="button-secondary"
          disabled={!config.enabled || isSaving || isVerifying}
          onClick={handleVerifyOnly}
          type="button"
        >
          {isVerifying ? "Verifying..." : "Verify Providers"}
        </button>
        <button
          className="button-primary"
          disabled={!config.enabled || isSaving || isVerifying}
          type="submit"
        >
          {isSaving ? "Saving..." : "Save Local Setup"}
        </button>
      </div>
    </form>
  );
}
