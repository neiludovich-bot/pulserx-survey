"use client";

import type {
  StudyLaunchCheckResponse,
  StudyLaunchSmokeTestResponse,
} from "@interview/schemas";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  applyRecommendedStudyBranchRules,
  runStudyLaunchSmokeTest,
  updateStudySettings,
} from "../api";

type Props = {
  launchCheck: StudyLaunchCheckResponse;
};

const browserChatFixKeys = new Set([
  "timebox",
  "attempt_limit",
  "off_survey_redirects",
]);
const voiceFixKeys = new Set(["openai_key", "voice"]);
const routingFixKeys = new Set(["adaptive_flow", "route_dry_runs"]);
const sourceContextFixKeys = new Set([
  "customgpt_key",
  "customgpt_project",
  "customgpt_sources",
  "source_context",
  "source_context_review",
]);
const guideHygieneFixKeys = new Set([
  "open_sessions",
  "scripted_response_imports",
]);
const testingFixKeys = new Set(["test_session"]);

function smokeCheckStatusClass(
  status: StudyLaunchSmokeTestResponse["checks"][number]["status"],
) {
  if (status === "pass") {
    return "status-pill status-pill-good";
  }

  if (status === "fail") {
    return "status-pill status-pill-bad";
  }

  return "status-pill status-pill-muted";
}

export function StudyLaunchQuickFixes({ launchCheck }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const [routingStatus, setRoutingStatus] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<string | null>(null);
  const [smokeStatus, setSmokeStatus] = useState<string | null>(null);
  const [smokeTest, setSmokeTest] =
    useState<StudyLaunchSmokeTestResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isApplyingVoiceDefaults, setIsApplyingVoiceDefaults] = useState(false);
  const [isApplyingRoutes, setIsApplyingRoutes] = useState(false);
  const [isRunningSmokeTest, setIsRunningSmokeTest] = useState(false);
  const hasBrowserChatFix =
    launchCheck.items.some(
      (item) => item.status !== "pass" && browserChatFixKeys.has(item.key),
    ) ||
    launchCheck.recommendedActions.some((action) =>
      browserChatFixKeys.has(action.key),
    );
  const hasRoutingFix =
    launchCheck.items.some(
      (item) => item.status !== "pass" && routingFixKeys.has(item.key),
    ) ||
    launchCheck.recommendedActions.some((action) =>
      routingFixKeys.has(action.key),
    );
  const hasSourceContextFix =
    launchCheck.items.some(
      (item) => item.status !== "pass" && sourceContextFixKeys.has(item.key),
    ) ||
    launchCheck.recommendedActions.some((action) =>
      sourceContextFixKeys.has(action.key),
    );
  const hasGuideHygieneFix =
    launchCheck.items.some(
      (item) => item.status !== "pass" && guideHygieneFixKeys.has(item.key),
    ) ||
    launchCheck.recommendedActions.some((action) =>
      guideHygieneFixKeys.has(action.key),
    );
  const hasTestingFix =
    launchCheck.items.some(
      (item) => item.status !== "pass" && testingFixKeys.has(item.key),
    ) ||
    launchCheck.items.some(
      (item) => item.key === "source_context_review" && item.status !== "pass",
    ) ||
    launchCheck.recommendedActions.some((action) =>
      testingFixKeys.has(action.key),
    );
  const hasVoiceFix =
    launchCheck.items.some(
      (item) => item.status !== "pass" && voiceFixKeys.has(item.key),
    ) ||
    launchCheck.recommendedActions.some((action) =>
      voiceFixKeys.has(action.key),
    );
  const customGptSetupHref =
    launchCheck.recommendedActions.find(
      (action) => action.key === "customgpt_key",
    )?.actionHref ??
    `/research/setup?returnTo=${encodeURIComponent(
      `/research/studies/${launchCheck.studyId}#source-context`,
    )}`;
  const customGptSourcesHref =
    launchCheck.recommendedActions.find(
      (action) => action.key === "customgpt_sources",
    )?.actionHref ??
    `/research/setup?returnTo=${encodeURIComponent(
      `/research/studies/${launchCheck.studyId}/settings#customgpt-sources`,
    )}`;
  const sourceContextHref =
    launchCheck.recommendedActions.find(
      (action) => action.key === "source_context_review",
    )?.actionHref ?? `/research/studies/${launchCheck.studyId}#source-context`;
  const sessionManagementHref =
    launchCheck.recommendedActions.find(
      (action) => action.key === "open_sessions",
    )?.actionHref ??
    `/research/studies/${launchCheck.studyId}#session-management`;
  const guideCleanupHref =
    launchCheck.recommendedActions.find(
      (action) => action.key === "scripted_response_imports",
    )?.actionHref ?? `/research/studies/${launchCheck.studyId}#guide-cleanup`;
  const openAiSetupHref =
    launchCheck.recommendedActions.find((action) => action.key === "openai_key")
      ?.actionHref ??
    `/research/setup?returnTo=${encodeURIComponent(
      `/research/studies/${launchCheck.studyId}/settings#voice-settings`,
    )}`;
  const voiceSettingsHref =
    launchCheck.recommendedActions.find((action) => action.key === "voice")
      ?.actionHref ??
    `/research/studies/${launchCheck.studyId}/settings#voice-settings`;

  async function applyBrowserChatDefaults() {
    setIsSaving(true);
    setStatus(null);

    try {
      await updateStudySettings(launchCheck.studyId, {
        timeboxStrategy: "HARD_CAP",
        maxAttemptsPerQuestion: 2,
        maxOffTopicRedirects: 2,
        realtimeVoiceRequiredForFielding: false,
      });
      setStatus("Browser-chat defaults saved. Rechecking launch readiness...");
      router.refresh();
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

  async function applyRealtimeVoiceDefaults() {
    setIsApplyingVoiceDefaults(true);
    setVoiceStatus(null);

    try {
      await updateStudySettings(launchCheck.studyId, {
        realtimeVoiceEnabled: true,
        realtimeVoiceRequiredForFielding: false,
      });
      setVoiceStatus(
        "Realtime voice enabled as optional. Add OPENAI_API_KEY to use live voice without blocking browser-chat fielding.",
      );
      router.refresh();
    } catch (error) {
      setVoiceStatus(
        error instanceof Error
          ? error.message
          : "Unable to enable realtime voice.",
      );
    } finally {
      setIsApplyingVoiceDefaults(false);
    }
  }

  async function applyRecommendedRoutes() {
    setIsApplyingRoutes(true);
    setRoutingStatus(null);

    try {
      const result = await applyRecommendedStudyBranchRules(
        launchCheck.studyId,
      );
      setRoutingStatus(
        `${result.createdCount} recommended conditional ${
          result.createdCount === 1 ? "route" : "routes"
        } added; ${result.passedDryRunCount} of ${result.dryRunCount} dry runs passed.`,
      );
      router.refresh();
    } catch (error) {
      setRoutingStatus(
        error instanceof Error
          ? error.message
          : "Unable to apply recommended routes.",
      );
    } finally {
      setIsApplyingRoutes(false);
    }
  }

  async function runLaunchSmokeTest() {
    setIsRunningSmokeTest(true);
    setSmokeStatus(null);
    setSmokeTest(null);

    try {
      const result = await runStudyLaunchSmokeTest(launchCheck.studyId);
      const proactiveSourceCheckKeys = [
        "adaptive_source_context_route",
        "source_context_turn",
        "source_context_approved_note_turn",
      ];
      const proactiveSourceChecks = proactiveSourceCheckKeys.flatMap((key) => {
        const check = result.checks.find((item) => item.key === key);
        return check ? [check] : [];
      });
      const proactiveSourceCheck =
        proactiveSourceChecks.find((check) => check.status === "fail") ??
        proactiveSourceChecks.find((check) => check.status === "warning") ??
        proactiveSourceChecks[0] ??
        null;

      setSmokeTest(result);
      setSmokeStatus(
        proactiveSourceCheck
          ? `${proactiveSourceCheck.label}: ${proactiveSourceCheck.detail}`
          : "Launch smoke test complete.",
      );
      router.refresh();
    } catch (error) {
      setSmokeStatus(
        error instanceof Error
          ? error.message
          : "Unable to run launch smoke test.",
      );
    } finally {
      setIsRunningSmokeTest(false);
    }
  }

  if (
    !hasBrowserChatFix &&
    !hasRoutingFix &&
    !hasSourceContextFix &&
    !hasGuideHygieneFix &&
    !hasTestingFix &&
    !hasVoiceFix
  ) {
    return null;
  }

  return (
    <div className="stack-sm">
      {hasGuideHygieneFix ? (
        <div className="source-preview stack-sm">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Guide Hygiene</span>
              <strong>Clear session and import warnings</strong>
            </div>
            <span className="status-pill status-pill-muted">Available</span>
          </div>
          <p className="muted-copy">
            Review stale sessions and imported scripted-response nodes before
            fielding or applying guide cleanup.
          </p>
          <div className="composer-actions">
            <Link className="button-secondary" href={sessionManagementHref}>
              Open Session Management
            </Link>
            <Link className="button-secondary" href={guideCleanupHref}>
              Review Cleanup
            </Link>
          </div>
        </div>
      ) : null}

      {hasSourceContextFix ? (
        <div className="source-preview stack-sm">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Source Context</span>
              <strong>Finish grounded study detail</strong>
            </div>
            <span className="status-pill status-pill-muted">Available</span>
          </div>
          <p className="muted-copy">
            Add the CustomGPT key and approved source material for live cited
            answers, or open Source Context to save referenced approved notes
            for reviewer-controlled respondent detail.
          </p>
          <div className="composer-actions">
            <Link className="button-secondary" href={customGptSetupHref}>
              Open Key Setup
            </Link>
            <Link className="button-secondary" href={customGptSourcesHref}>
              Open Source Material
            </Link>
            <Link className="button-secondary" href={sourceContextHref}>
              Review Source Context
            </Link>
          </div>
        </div>
      ) : null}

      {hasTestingFix ? (
        <div className="source-preview stack-sm">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Launch Smoke Test</span>
              <strong>Verify respondent source detail</strong>
            </div>
            <span
              className={
                smokeTest?.status === "passed"
                  ? "status-pill status-pill-good"
                  : smokeTest?.status === "failed"
                    ? "status-pill status-pill-bad"
                    : "status-pill status-pill-muted"
              }
            >
              {smokeTest?.status ?? "Available"}
            </span>
          </div>
          <p className="muted-copy">
            Starts temporary sessions, checks off-survey return behavior and
            proactive cited study detail, then cleans up the temporary sessions.
          </p>
          <button
            className="button-secondary"
            disabled={isRunningSmokeTest}
            onClick={runLaunchSmokeTest}
            type="button"
          >
            {isRunningSmokeTest ? "Testing..." : "Run Launch Smoke Test"}
          </button>
          {smokeStatus ? <p className="micro-copy">{smokeStatus}</p> : null}
          {smokeTest ? (
            <ul className="plain-list compact-list">
              {smokeTest.checks.map((check) => (
                <li key={check.key}>
                  <div className="panel-title-row">
                    <strong>{check.label}</strong>
                    <span className={smokeCheckStatusClass(check.status)}>
                      {check.status}
                    </span>
                  </div>
                  <p className="micro-copy">{check.detail}</p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {hasVoiceFix ? (
        <div className="source-preview stack-sm">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Voice Readiness</span>
              <strong>Enable low-latency live voice</strong>
            </div>
            <span className="status-pill status-pill-muted">Optional</span>
          </div>
          <p className="muted-copy">
            Turns on realtime voice as an optional respondent control. Browser
            chat remains fieldable; adding the OpenAI key unlocks the live voice
            transport.
          </p>
          <div className="composer-actions">
            <button
              className="button-secondary"
              disabled={isApplyingVoiceDefaults}
              onClick={applyRealtimeVoiceDefaults}
              type="button"
            >
              {isApplyingVoiceDefaults
                ? "Enabling..."
                : "Enable Optional Live Voice"}
            </button>
            <Link className="button-secondary" href={openAiSetupHref}>
              Open Key Setup
            </Link>
            <Link className="button-secondary" href={voiceSettingsHref}>
              Voice Settings
            </Link>
          </div>
          {voiceStatus ? <p className="micro-copy">{voiceStatus}</p> : null}
        </div>
      ) : null}

      {hasRoutingFix ? (
        <div className="source-preview stack-sm">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Adaptive Routing</span>
              <strong>Apply recommended routes</strong>
            </div>
            <span className="status-pill status-pill-muted">Available</span>
          </div>
          <p className="muted-copy">
            Applies researcher-reviewable keyword routes inferred from the guide
            and runs the saved sample answers through the route simulator.
          </p>
          <button
            className="button-secondary"
            disabled={isApplyingRoutes}
            onClick={applyRecommendedRoutes}
            type="button"
          >
            {isApplyingRoutes
              ? "Applying and Testing..."
              : "Apply Recommended Routes & Test"}
          </button>
          {routingStatus ? <p className="micro-copy">{routingStatus}</p> : null}
        </div>
      ) : null}

      {hasBrowserChatFix ? (
        <div className="source-preview stack-sm">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Browser Chat Defaults</span>
              <strong>Fix local fielding guardrails</strong>
            </div>
            <span className="status-pill status-pill-muted">Available</span>
          </div>
          <p className="muted-copy">
            Applies browser-chat fielding guardrails: hard cap, max 2 attempts,
            and max 2 off-survey redirects.
          </p>
          <button
            className="button-secondary"
            disabled={isSaving}
            onClick={applyBrowserChatDefaults}
            type="button"
          >
            {isSaving ? "Saving..." : "Apply Browser Chat Defaults"}
          </button>
          {status ? <p className="micro-copy">{status}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
