"use client";

import type {
  StudyGraphResponse,
  StudyLaunchCheckResponse,
} from "@interview/schemas";
import { useRouter } from "next/navigation";
import { useMemo, useState, type MouseEvent } from "react";
import { createRespondentSession, startTestSession } from "../api";

type StartNode = StudyGraphResponse["nodes"][number];

export function StartSessionButton({
  launchCheck,
  nodes = [],
  studyId,
}: {
  launchCheck?: StudyLaunchCheckResponse;
  nodes?: StartNode[];
  studyId: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [fieldingStatus, setFieldingStatus] = useState<
    "idle" | "loading" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldingError, setFieldingError] = useState<string | null>(null);
  const [respondentUrl, setRespondentUrl] = useState<string | null>(null);
  const [startNodeId, setStartNodeId] = useState("");
  const launchableNodes = useMemo(
    () =>
      [...nodes]
        .filter((node) => !node.isTerminal)
        .sort((left, right) => {
          if (left.position !== right.position) {
            return left.position - right.position;
          }

          return left.title.localeCompare(right.title);
        }),
    [nodes],
  );
  const blockingItemCount = launchCheck?.blockingItemCount ?? 0;
  const warningItemCount = launchCheck?.warningItemCount ?? 0;
  const fieldingBlocked = blockingItemCount > 0;

  async function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    setStatus("loading");
    setError(null);

    try {
      const session = await startTestSession(studyId, {
        ...(startNodeId ? { startNodeId } : {}),
      });
      router.push(`/respondent/${session.sessionId}`);
    } catch (caughtError) {
      setStatus("error");
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to start a test session.",
      );
      return;
    }

    setStatus("idle");
  }

  async function handleCreateRespondentLink(
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    setFieldingStatus("loading");
    setFieldingError(null);
    setRespondentUrl(null);

    try {
      const session = await createRespondentSession(studyId);
      setRespondentUrl(
        `${window.location.origin}/respondent/${session.sessionId}`,
      );
    } catch (caughtError) {
      setFieldingStatus("error");
      setFieldingError(
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to create a respondent link.",
      );
      return;
    }

    setFieldingStatus("idle");
  }

  async function handleCopyRespondentLink(
    event: MouseEvent<HTMLButtonElement>,
  ) {
    event.preventDefault();
    if (respondentUrl) {
      await navigator.clipboard.writeText(respondentUrl);
    }
  }

  return (
    <div className="stack-sm">
      {launchableNodes.length > 0 ? (
        <label className="form-field">
          <span>Start test at</span>
          <select
            value={startNodeId}
            onChange={(event) => setStartNodeId(event.target.value)}
          >
            <option value="">Entry question</option>
            {launchableNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title}
                {node.requiresGroundedStudyContext ? " | source context" : ""}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button className="button-primary" onClick={handleClick} type="button">
        {status === "loading"
          ? "Starting test session..."
          : startNodeId
            ? "Start From Selected Question"
            : "Start Test Session"}
      </button>
      {error ? <p className="inline-error">{error}</p> : null}

      <div className="route-test-panel stack-sm">
        <div className="panel-title-row">
          <div className="stack-sm">
            <span className="label">Fresh Respondent Link</span>
            <strong>
              {fieldingBlocked
                ? `${blockingItemCount} blocker${
                    blockingItemCount === 1 ? "" : "s"
                  }`
                : warningItemCount > 0
                  ? `${warningItemCount} warning${
                      warningItemCount === 1 ? "" : "s"
                    }`
                  : "Ready"}
            </strong>
          </div>
          <span
            className={
              fieldingBlocked
                ? "status-pill status-pill-bad"
                : warningItemCount > 0
                  ? "status-pill status-pill-muted"
                  : "status-pill status-pill-good"
            }
          >
            {fieldingBlocked ? "Blocked" : "Fieldable"}
          </span>
        </div>
        <button
          className="button-secondary"
          disabled={fieldingBlocked || fieldingStatus === "loading"}
          onClick={handleCreateRespondentLink}
          type="button"
        >
          {fieldingStatus === "loading"
            ? "Creating..."
            : "Create Respondent Link"}
        </button>
        {respondentUrl ? (
          <div className="stack-sm">
            <a
              className="text-link"
              href={respondentUrl}
              rel="noreferrer"
              target="_blank"
            >
              {respondentUrl}
            </a>
            <button
              className="button-secondary"
              onClick={handleCopyRespondentLink}
              type="button"
            >
              Copy Link
            </button>
          </div>
        ) : null}
        {fieldingBlocked ? (
          <p className="micro-copy">
            Clear launch blockers before creating a live respondent path.
          </p>
        ) : null}
        {fieldingError ? <p className="inline-error">{fieldingError}</p> : null}
      </div>
    </div>
  );
}
