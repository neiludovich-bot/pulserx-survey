"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import type {
  StudyCustomGptVerificationResponse,
  StudyCustomGptSourcesResponse,
  StudyLaunchCheckResponse,
  StudyLaunchSmokeTestResponse,
  StudySettingsResponse,
  TimeboxStrategy,
} from "@interview/schemas";
import {
  addStudyCustomGptSitemapSource,
  getStudyCustomGptSources,
  getStudyLaunchCheck,
  runStudyLaunchSmokeTest,
  updateStudySettings,
  verifyStudyCustomGpt,
} from "../api";

type Props = {
  initialCustomGptSources?: StudyCustomGptSourcesResponse | null;
  initialSettings: StudySettingsResponse;
  sourceAssetSuggestions?: Array<{
    id: string;
    sitemapPath: string;
    title: string;
    storageKey: string;
  }>;
};

function formatMinutes(seconds: number) {
  const minutes = seconds / 60;

  return Number.isInteger(minutes)
    ? `${minutes} min`
    : `${minutes.toFixed(1)} min`;
}

export function StudySettingsForm({
  initialCustomGptSources = null,
  initialSettings,
  sourceAssetSuggestions = [],
}: Props) {
  const [settings, setSettings] = useState(initialSettings);
  const [customGptProjectId, setCustomGptProjectId] = useState(
    initialSettings.customGptProjectId ?? "",
  );
  const [timeboxStrategy, setTimeboxStrategy] = useState<TimeboxStrategy>(
    initialSettings.timeboxStrategy,
  );
  const [targetMinutes, setTargetMinutes] = useState(
    Math.round(initialSettings.targetDurationSeconds / 60),
  );
  const [maxAttempts, setMaxAttempts] = useState(
    initialSettings.maxAttemptsPerQuestion,
  );
  const [maxRedirects, setMaxRedirects] = useState(
    initialSettings.maxOffTopicRedirects,
  );
  const [realtimeVoiceEnabled, setRealtimeVoiceEnabled] = useState(
    initialSettings.realtimeVoiceEnabled,
  );
  const [
    realtimeVoiceRequiredForFielding,
    setRealtimeVoiceRequiredForFielding,
  ] = useState(initialSettings.realtimeVoiceRequiredForFielding);
  const [status, setStatus] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [verification, setVerification] =
    useState<StudyCustomGptVerificationResponse | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [customGptSources, setCustomGptSources] =
    useState<StudyCustomGptSourcesResponse | null>(initialCustomGptSources);
  const [hasTriedLoadingSources, setHasTriedLoadingSources] = useState(
    Boolean(initialCustomGptSources),
  );
  const [customGptSourceUrl, setCustomGptSourceUrl] = useState("");
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [addingSuggestedSourceUrl, setAddingSuggestedSourceUrl] = useState<
    string | null
  >(null);
  const [launchCheck, setLaunchCheck] =
    useState<StudyLaunchCheckResponse | null>(null);
  const [isCheckingLaunch, setIsCheckingLaunch] = useState(false);
  const [launchSmokeTest, setLaunchSmokeTest] =
    useState<StudyLaunchSmokeTestResponse | null>(null);
  const [isRunningSmokeTest, setIsRunningSmokeTest] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadCustomGptSources() {
      setIsLoadingSources(true);
      setHasTriedLoadingSources(true);

      try {
        const sources = await getStudyCustomGptSources(settings.studyId);
        if (!cancelled) {
          setCustomGptSources(sources);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(
            error instanceof Error
              ? error.message
              : "Unable to load CustomGPT sources.",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingSources(false);
        }
      }
    }

    const shouldLoadSources =
      customGptSources === null &&
      !hasTriedLoadingSources &&
      (Boolean(settings.customGptProjectId) ||
        settings.fieldingReadiness.sourceContext.questionCount > 0);

    if (shouldLoadSources) {
      void loadCustomGptSources();
    }

    return () => {
      cancelled = true;
    };
  }, [
    settings.studyId,
    settings.customGptProjectId,
    settings.fieldingReadiness.sourceContext.questionCount,
    customGptSources,
    hasTriedLoadingSources,
  ]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setStatus(null);

    try {
      await saveCurrentSettings();
      setStatus("Settings saved.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to save settings.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function saveCurrentSettings() {
    const nextSettings = await updateStudySettings(settings.studyId, {
      customGptProjectId: customGptProjectId.trim() || null,
      timeboxStrategy,
      targetDurationSeconds: Math.max(1, targetMinutes) * 60,
      maxAttemptsPerQuestion: maxAttempts,
      maxOffTopicRedirects: maxRedirects,
      realtimeVoiceEnabled,
      realtimeVoiceRequiredForFielding,
    });
    if (nextSettings.customGptProjectId !== settings.customGptProjectId) {
      setCustomGptSources(null);
      setHasTriedLoadingSources(false);
    }
    setSettings(nextSettings);
    return nextSettings;
  }

  async function handleVerifyCustomGpt() {
    setIsVerifying(true);
    setStatus(null);
    setVerification(null);

    try {
      const nextSettings = await saveCurrentSettings();
      setVerification(await verifyStudyCustomGpt(nextSettings.studyId));
      setStatus("Settings saved. CustomGPT verification complete.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to verify CustomGPT.",
      );
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleRefreshCustomGptSources() {
    setIsLoadingSources(true);
    setStatus(null);

    try {
      const nextSettings = await saveCurrentSettings();
      setHasTriedLoadingSources(true);
      setCustomGptSources(await getStudyCustomGptSources(nextSettings.studyId));
      setStatus("Settings saved. CustomGPT sources refreshed.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to refresh CustomGPT sources.",
      );
    } finally {
      setIsLoadingSources(false);
    }
  }

  async function addCustomGptSourceUrl(input: {
    sourceLabel?: string;
    suggestedSourceUrl?: string | null;
    url: string;
  }) {
    const sitemapPath = input.url.trim();
    if (!sitemapPath) {
      setStatus("Enter a sitemap URL before adding a source.");
      return;
    }

    setIsAddingSource(true);
    setAddingSuggestedSourceUrl(input.suggestedSourceUrl ?? null);
    setStatus(null);

    try {
      const nextSettings = await saveCurrentSettings();
      const sources = await addStudyCustomGptSitemapSource(
        nextSettings.studyId,
        {
          sitemapPath,
        },
      );
      setCustomGptSources(sources);
      if (!input.suggestedSourceUrl) {
        setCustomGptSourceUrl("");
      }
      setStatus(
        `Settings saved. ${
          input.sourceLabel ?? "CustomGPT source"
        } submitted for indexing; refresh status while it processes.`,
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to add CustomGPT source.",
      );
    } finally {
      setIsAddingSource(false);
      setAddingSuggestedSourceUrl(null);
    }
  }

  async function handleAddCustomGptSource() {
    await addCustomGptSourceUrl({
      url: customGptSourceUrl,
    });
  }

  async function handleRunLaunchCheck() {
    setIsCheckingLaunch(true);
    setStatus(null);

    try {
      const nextSettings = await saveCurrentSettings();
      setLaunchCheck(await getStudyLaunchCheck(nextSettings.studyId));
      setStatus("Settings saved. Launch check complete.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to run launch check.",
      );
    } finally {
      setIsCheckingLaunch(false);
    }
  }

  async function handleRunSmokeTest() {
    setIsRunningSmokeTest(true);
    setStatus(null);
    setLaunchSmokeTest(null);

    try {
      const nextSettings = await saveCurrentSettings();
      setLaunchSmokeTest(await runStudyLaunchSmokeTest(nextSettings.studyId));
      setStatus("Settings saved. Launch smoke test complete.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to run launch smoke test.",
      );
    } finally {
      setIsRunningSmokeTest(false);
    }
  }

  async function applyBrowserChatDefaults() {
    const nextTimeboxStrategy = "HARD_CAP";
    const nextMaxAttempts = Math.min(maxAttempts, 2);
    const nextMaxRedirects = Math.min(maxRedirects, 2);
    const nextRealtimeVoiceRequiredForFielding = false;

    setTimeboxStrategy(nextTimeboxStrategy);
    setMaxAttempts(nextMaxAttempts);
    setMaxRedirects(nextMaxRedirects);
    setRealtimeVoiceRequiredForFielding(nextRealtimeVoiceRequiredForFielding);
    setIsSaving(true);
    setStatus(null);

    try {
      const nextSettings = await updateStudySettings(settings.studyId, {
        customGptProjectId: customGptProjectId.trim() || null,
        timeboxStrategy: nextTimeboxStrategy,
        targetDurationSeconds: Math.max(1, targetMinutes) * 60,
        maxAttemptsPerQuestion: nextMaxAttempts,
        maxOffTopicRedirects: nextMaxRedirects,
        realtimeVoiceRequiredForFielding: nextRealtimeVoiceRequiredForFielding,
      });

      setSettings(nextSettings);
      setStatus("Browser-chat defaults saved.");
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to save browser-chat defaults.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  const verificationStatusClass =
    verification?.status === "passed"
      ? "status-pill status-pill-good"
      : verification?.status === "failed"
        ? "status-pill status-pill-bad"
        : "status-pill status-pill-muted";
  const readiness = settings.fieldingReadiness;
  const recommendedTargetMinutes = Math.max(
    1,
    Math.ceil(readiness.recommendedTargetDurationSeconds / 60),
  );
  const readinessStatusClass =
    readiness.status === "ready"
      ? "status-pill status-pill-good"
      : "status-pill status-pill-muted";
  const launchStatusLabel = launchCheck
    ? launchCheck.blockingItemCount > 0
      ? "Needs Setup"
      : launchCheck.warningItemCount > 0
        ? "Review"
        : "Ready"
    : "Not Run";
  const launchStatusClass =
    !launchCheck || launchCheck.blockingItemCount > 0
      ? "status-pill status-pill-bad"
      : launchCheck.warningItemCount > 0
        ? "status-pill status-pill-muted"
        : "status-pill status-pill-good";
  const smokeStatusClass =
    launchSmokeTest?.status === "passed"
      ? "status-pill status-pill-good"
      : "status-pill status-pill-muted";
  const customGptSourceTotals = customGptSources
    ? customGptSources.sources.reduce(
        (totals, source) => ({
          pageCount: totals.pageCount + source.pageCount,
          indexedPageCount:
            totals.indexedPageCount + source.indexedPageCount,
          queuedPageCount: totals.queuedPageCount + source.queuedPageCount,
          failedPageCount: totals.failedPageCount + source.failedPageCount,
          limitedPageCount: totals.limitedPageCount + source.limitedPageCount,
        }),
        {
          pageCount: 0,
          indexedPageCount: 0,
          queuedPageCount: 0,
          failedPageCount: 0,
          limitedPageCount: 0,
        },
      )
    : null;
  const customGptSourcesStatusClass =
    customGptSources && customGptSources.enabled
      ? customGptSourceTotals && customGptSourceTotals.indexedPageCount > 0
        ? "status-pill status-pill-good"
        : "status-pill status-pill-bad"
      : "status-pill status-pill-muted";
  const customGptSourcesStatusLabel =
    customGptSources && customGptSources.enabled
      ? customGptSourceTotals && customGptSourceTotals.indexedPageCount > 0
        ? "Indexed"
        : "Needs Sources"
      : isLoadingSources
        ? "Loading"
        : "Needs Setup";
  const browserChatDefaultsNeeded =
    timeboxStrategy !== "HARD_CAP" ||
    maxAttempts > 2 ||
    maxRedirects > 2 ||
    realtimeVoiceRequiredForFielding;

  return (
    <form className="panel stack-md" onSubmit={handleSubmit}>
      <div className="stack-sm">
        <span className="label">Study Settings</span>
        <h2>{settings.studyName}</h2>
        <p className="muted-copy">
          Secret API keys still belong in environment variables. This screen
          stores per-study runtime settings and the CustomGPT project to use for
          grounded clarification answers and proactive study context.
        </p>
      </div>

      <section className="callout">
        <div className="panel-title-row">
          <div className="stack-sm">
            <span className="label">Fielding Readiness</span>
            <strong>
              {readiness.status === "ready" ? "Ready" : "Needs Setup"}
            </strong>
          </div>
          <span className={readinessStatusClass}>
            {readiness.status === "ready" ? "Ready" : "Needs Setup"}
          </span>
        </div>
        <div className="detail-grid">
          <article className="stack-sm">
            <span className="label">Guide</span>
            <strong>{readiness.questionCount} questions</strong>
            <p className="muted-copy">
              {formatMinutes(readiness.estimatedGuideSeconds)} guide |{" "}
              {formatMinutes(readiness.availableInterviewSeconds)} before
              wrap-up
            </p>
          </article>
          <article className="stack-sm">
            <span className="label">Timebox</span>
            <strong>
              {readiness.timeboxStrategy === "HARD_CAP"
                ? "Hard cap"
                : "Full guide"}
            </strong>
            <p className="muted-copy">
              {readiness.estimatedQuestionCapacity} of{" "}
              {readiness.interviewQuestionCount} estimated questions fit
            </p>
          </article>
          <article className="stack-sm">
            <span className="label">Routing</span>
            <strong>
              {readiness.adaptiveRouting.status === "adaptive"
                ? "Adaptive"
                : readiness.adaptiveRouting.status === "sequential_only"
                  ? "Sequential"
                  : "Incomplete"}
            </strong>
            <p className="muted-copy">
              {readiness.adaptiveRouting.conditionalRuleCount} conditional |{" "}
              {readiness.adaptiveRouting.sequentialRuleCount} sequential
            </p>
          </article>
          <article className="stack-sm">
            <span className="label">Grounding</span>
            <strong>
              {readiness.sourceContextQuestionCount} source-context questions
            </strong>
            <p className="muted-copy">
              CustomGPT {readiness.customGpt.enabled ? "ready" : "needs setup"}
            </p>
          </article>
          <article className="stack-sm">
            <span className="label">Guardrails</span>
            <strong>
              {readiness.guardrails.noFixationReady &&
              readiness.guardrails.offSurveyReturnReady
                ? "Fieldable"
                : "Review"}
            </strong>
            <p className="muted-copy">
              {readiness.guardrails.maxAttemptsPerQuestion} attempt
              {readiness.guardrails.maxAttemptsPerQuestion === 1
                ? ""
                : "s"} | {readiness.guardrails.maxOffTopicRedirects} redirect
              {readiness.guardrails.maxOffTopicRedirects === 1 ? "" : "s"}
            </p>
          </article>
          <article className="stack-sm">
            <span className="label">Assets & Voice</span>
            <strong>{readiness.assetCount} assets</strong>
            <p className="muted-copy">
              Realtime voice{" "}
              {readiness.voice.realtimeAvailable
                ? "ready"
                : (readiness.voice.reason ?? "not enabled")}
            </p>
          </article>
        </div>
        {readiness.warnings.length > 0 ? (
          <ul className="plain-list">
            {readiness.warnings.map((warning) => (
              <li key={warning}>
                <span className="muted-copy">{warning}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-copy">
            No setup warnings for this study based on current local config.
          </p>
        )}
      </section>

      <section className="callout" id="customgpt-sources">
        <div className="panel-title-row">
          <div className="stack-sm">
            <span className="label">Launch Check</span>
            <strong>{launchStatusLabel}</strong>
          </div>
          {launchCheck ? (
            <span className={launchStatusClass}>{launchStatusLabel}</span>
          ) : null}
        </div>
        <p className="muted-copy">
          Saves these settings, then checks timing, routing, source context,
          side-pane assets, voice, and launch-test coverage.
        </p>
        {launchCheck ? (
          <>
            <p className="muted-copy">
              {launchCheck.blockingItemCount} blocker(s) |{" "}
              {launchCheck.warningItemCount} warning(s)
            </p>
            {launchCheck.recommendedActions.length > 0 ? (
              <div className="source-preview stack-sm">
                <div className="panel-title-row">
                  <div className="stack-sm">
                    <span className="label">Recommended Next Steps</span>
                    <h3>{launchCheck.recommendedActions.length} action(s)</h3>
                  </div>
                </div>
                <ul className="plain-list compact-list">
                  {launchCheck.recommendedActions.map((item, index) => (
                    <li key={item.key}>
                      <div className="panel-title-row">
                        <div className="stack-sm">
                          <span className="label">
                            Step {index + 1} | {item.category.replace("_", " ")}
                          </span>
                          <strong>{item.label}</strong>
                        </div>
                        <span
                          className={
                            item.severity === "blocker"
                              ? "status-pill status-pill-bad"
                              : "status-pill status-pill-muted"
                          }
                        >
                          {item.severity}
                        </span>
                      </div>
                      <span className="muted-copy">{item.action}</span>
                      {item.actionHref ? (
                        <p className="micro-copy">
                          <Link className="text-link" href={item.actionHref}>
                            {item.actionLabel ?? "Open"}
                          </Link>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="muted-copy">
                No launch actions are currently recommended.
              </p>
            )}
            <ul className="plain-list">
              {launchCheck.items.map((item) => (
                <li key={item.key}>
                  <strong>
                    {item.label} | {item.status}
                  </strong>
                  <span className="muted-copy">{item.detail}</span>
                  {item.action ? (
                    <p className="micro-copy">
                      {item.action}
                      {item.actionHref ? (
                        <>
                          {" "}
                          <Link className="text-link" href={item.actionHref}>
                            Open
                          </Link>
                        </>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <button
          className="button-secondary"
          disabled={isSaving || isCheckingLaunch}
          onClick={handleRunLaunchCheck}
          type="button"
        >
          {isCheckingLaunch ? "Checking..." : "Run Launch Check"}
        </button>
      </section>

      <section className="callout">
        <div className="panel-title-row">
          <div className="stack-sm">
            <span className="label">Launch Smoke Test</span>
            <strong>
              {launchSmokeTest
                ? launchSmokeTest.status === "passed"
                  ? "Passed"
                  : "Failed"
                : "Not Run"}
            </strong>
          </div>
          {launchSmokeTest ? (
            <span className={smokeStatusClass}>{launchSmokeTest.status}</span>
          ) : null}
        </div>
        <p className="muted-copy">
          Starts temporary respondent sessions, checks the first interviewer
          turn, off-survey return behavior, staged asset, proactive
          source-context turn, and voice capabilities, then removes the
          temporary sessions.
        </p>
        {launchSmokeTest ? (
          <>
            <dl className="asset-meta">
              <dt>Cleanup</dt>
              <dd>{launchSmokeTest.cleanedUp ? "Complete" : "Incomplete"}</dd>
              <dt>First Question</dt>
              <dd>{launchSmokeTest.firstQuestion?.title ?? "Not rendered"}</dd>
              <dt>Asset</dt>
              <dd>{launchSmokeTest.currentAsset?.title ?? "None staged"}</dd>
            </dl>
            <ul className="plain-list">
              {launchSmokeTest.checks.map((item) => (
                <li key={item.key}>
                  <strong>
                    {item.label} | {item.status}
                  </strong>
                  <span className="muted-copy">{item.detail}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <button
          className="button-secondary"
          disabled={isSaving || isRunningSmokeTest}
          onClick={handleRunSmokeTest}
          type="button"
        >
          {isRunningSmokeTest ? "Running..." : "Run Smoke Test"}
        </button>
      </section>

      <label className="form-field" id="customgpt-project">
        <span>CustomGPT Project ID</span>
        <input
          onChange={(event) => setCustomGptProjectId(event.target.value)}
          placeholder="Project ID from CustomGPT"
          value={customGptProjectId}
        />
      </label>

      <section className="callout">
        <div className="panel-title-row">
          <div className="stack-sm">
            <span className="label">CustomGPT Sources</span>
            <strong>
              {customGptSources
                ? `${customGptSources.sources.length} source${
                    customGptSources.sources.length === 1 ? "" : "s"
                  }`
                : "Not loaded"}
            </strong>
          </div>
          {customGptSources ? (
            <span className={customGptSourcesStatusClass}>
              {customGptSourcesStatusLabel}
            </span>
          ) : isLoadingSources ? (
            <span className="status-pill status-pill-muted">Loading</span>
          ) : null}
        </div>
        <p className="muted-copy">
          Add the sitemap source to the study CustomGPT project, then refresh
          until indexed pages are available for cited answers.
        </p>
        {customGptSourceTotals ? (
          <div className="detail-grid">
            <div className="stack-sm">
              <span className="label">Indexed</span>
              <strong>{customGptSourceTotals.indexedPageCount}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Queued</span>
              <strong>{customGptSourceTotals.queuedPageCount}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Failed</span>
              <strong>{customGptSourceTotals.failedPageCount}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Limited</span>
              <strong>{customGptSourceTotals.limitedPageCount}</strong>
            </div>
          </div>
        ) : null}
        {sourceAssetSuggestions.length > 0 ? (
          <ul className="plain-list compact-list">
            {sourceAssetSuggestions.map((asset) => (
              <li key={asset.id}>
                <div className="panel-title-row">
                  <div className="stack-sm">
                    <span className="label">Suggested website asset</span>
                    <strong>{asset.title}</strong>
                  </div>
                  <button
                    className="button-secondary"
                    disabled={isSaving || isAddingSource}
                    onClick={() =>
                      void addCustomGptSourceUrl({
                        sourceLabel: asset.title,
                        suggestedSourceUrl: asset.sitemapPath,
                        url: asset.sitemapPath,
                      })
                    }
                    type="button"
                  >
                    {addingSuggestedSourceUrl === asset.sitemapPath
                      ? "Adding..."
                      : "Add Sitemap Source"}
                  </button>
                </div>
                <p className="micro-copy">Website: {asset.storageKey}</p>
                <p className="micro-copy">
                  CustomGPT sitemap: {asset.sitemapPath}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        <label className="form-field">
          <span>Sitemap URL</span>
          <input
            onChange={(event) => setCustomGptSourceUrl(event.target.value)}
            placeholder="https://example.com/sitemap.xml"
            value={customGptSourceUrl}
          />
        </label>
        <div className="composer-actions">
          <button
            className="button-secondary"
            disabled={isSaving || isAddingSource || !customGptSourceUrl.trim()}
            onClick={handleAddCustomGptSource}
            type="button"
          >
            {isAddingSource ? "Adding..." : "Add Sitemap to CustomGPT"}
          </button>
          <button
            className="button-secondary"
            disabled={isSaving || isLoadingSources}
            onClick={handleRefreshCustomGptSources}
            type="button"
          >
            {isLoadingSources ? "Refreshing..." : "Refresh Source Status"}
          </button>
        </div>
        {customGptSources?.reason ? (
          <p className="error-copy">{customGptSources.reason}</p>
        ) : null}
        {customGptSources && customGptSources.sources.length > 0 ? (
          <ul className="plain-list compact-list">
            {customGptSources.sources.map((source) => (
              <li key={`${source.type}-${source.sourceId}`}>
                <div className="panel-title-row">
                  <div className="stack-sm">
                    <span className="label">{source.type}</span>
                    <strong>{source.path ?? source.sourceId}</strong>
                  </div>
                  <span
                    className={
                      source.failedPageCount > 0
                        ? "status-pill status-pill-bad"
                        : source.queuedPageCount > 0
                          ? "status-pill status-pill-muted"
                          : "status-pill status-pill-good"
                    }
                  >
                    {source.indexedPageCount}/{source.pageCount} indexed
                  </span>
                </div>
                <p className="micro-copy">
                  {source.queuedPageCount} queued | {source.failedPageCount}{" "}
                  failed | {source.limitedPageCount} limited
                </p>
              </li>
            ))}
          </ul>
        ) : customGptSources?.enabled ? (
          <p className="muted-copy">
            No sources were returned for this CustomGPT project yet.
          </p>
        ) : null}
      </section>

      <section className="callout">
        <div className="panel-title-row">
          <div className="stack-sm">
            <span className="label">Study Knowledge Check</span>
            <strong>CustomGPT Verification</strong>
          </div>
          {verification ? (
            <span className={verificationStatusClass}>
              {verification.status}
            </span>
          ) : null}
        </div>
        <p className="muted-copy">
          Saves these settings, then checks the CustomGPT project this study
          will use for grounded clarification answers and proactive study
          context.
        </p>
        {verification ? (
          <dl className="asset-meta">
            <dt>Project</dt>
            <dd>{verification.projectId ?? "Not configured"}</dd>
            <dt>Mode</dt>
            <dd>
              {verification.verificationMode === "source_context_question"
                ? "Source-context question"
                : "General project"}
            </dd>
            <dt>Question</dt>
            <dd>
              {verification.sourceContextQuestionTitle ??
                "No source-context question used"}
            </dd>
            <dt>Response</dt>
            <dd>{verification.responseReceived ? "Received" : "Missing"}</dd>
            <dt>References</dt>
            <dd>{verification.referenceCount}</dd>
            <dt>Result</dt>
            <dd>
              {verification.reason ??
                verification.answerPreview ??
                "Verification passed."}
            </dd>
          </dl>
        ) : null}
        <button
          className="button-secondary"
          disabled={isSaving || isVerifying}
          onClick={handleVerifyCustomGpt}
          type="button"
        >
          {isVerifying ? "Checking..." : "Save and Verify CustomGPT"}
        </button>
      </section>

      <div className="form-grid" id="timing-settings">
        <label className="form-field">
          <span>Target Minutes</span>
          <input
            min={1}
            onChange={(event) => setTargetMinutes(Number(event.target.value))}
            type="number"
            value={targetMinutes}
          />
        </label>
        <label className="form-field">
          <span>Timebox Strategy</span>
          <select
            onChange={(event) =>
              setTimeboxStrategy(event.target.value as TimeboxStrategy)
            }
            value={timeboxStrategy}
          >
            <option value="HARD_CAP">Hard cap</option>
            <option value="FULL_GUIDE">Full guide</option>
          </select>
        </label>
        <label className="form-field">
          <span>Max Attempts</span>
          <input
            max={5}
            min={1}
            onChange={(event) => setMaxAttempts(Number(event.target.value))}
            type="number"
            value={maxAttempts}
          />
        </label>
        <label className="form-field">
          <span>Off-Survey Redirects</span>
          <input
            max={5}
            min={0}
            onChange={(event) => setMaxRedirects(Number(event.target.value))}
            type="number"
            value={maxRedirects}
          />
        </label>
      </div>

      {browserChatDefaultsNeeded ? (
        <section className="callout">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Browser Chat Defaults</span>
              <strong>Fieldable guardrails available</strong>
            </div>
            <span className="status-pill status-pill-muted">Recommended</span>
          </div>
          <p className="muted-copy">
            Save browser-chat settings: hard cap, at most 2 attempts, at most 2
            off-survey redirects, and realtime voice not required for fielding.
          </p>
          <button
            className="button-secondary"
            disabled={isSaving}
            onClick={applyBrowserChatDefaults}
            type="button"
          >
            {isSaving ? "Saving..." : "Save Browser Chat Defaults"}
          </button>
        </section>
      ) : null}

      {readiness.timeboxWillSkipQuestions ? (
        <section className="callout">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Timebox Fit</span>
              <strong>
                {readiness.estimatedQuestionCapacity} of{" "}
                {readiness.interviewQuestionCount} questions fit
              </strong>
            </div>
            <span className="status-pill status-pill-muted">
              {formatMinutes(readiness.estimatedOverageSeconds)} over
            </span>
          </div>
          <p className="muted-copy">
            Hard cap keeps the interview within {targetMinutes} minutes and lets
            the runtime move to wrap-up when the reserve is reached. Full guide
            needs about {recommendedTargetMinutes} minutes.
          </p>
          <div className="composer-footer">
            <button
              className="button-secondary"
              onClick={() => setTimeboxStrategy("HARD_CAP")}
              type="button"
            >
              Keep Hard Cap
            </button>
            <button
              className="button-secondary"
              onClick={() => {
                setTargetMinutes(recommendedTargetMinutes);
                setTimeboxStrategy("FULL_GUIDE");
              }}
              type="button"
            >
              Fit Full Guide
            </button>
          </div>
        </section>
      ) : null}

      <label className="checkbox-field" id="voice-settings">
        <input
          checked={realtimeVoiceEnabled}
          onChange={(event) => setRealtimeVoiceEnabled(event.target.checked)}
          type="checkbox"
        />
        <span>
          Enable realtime voice for this study when OpenAI keys are present
        </span>
      </label>

      <label className="checkbox-field">
        <input
          checked={realtimeVoiceRequiredForFielding}
          onChange={(event) =>
            setRealtimeVoiceRequiredForFielding(event.target.checked)
          }
          type="checkbox"
        />
        <span>Require realtime voice before fielding respondent links</span>
      </label>

      <div className="composer-actions">
        {status ? <p className="muted-copy">{status}</p> : null}
        <button className="button-primary" disabled={isSaving} type="submit">
          {isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </form>
  );
}
