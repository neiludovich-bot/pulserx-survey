"use client";

import type { StudyGraphResponse } from "@interview/schemas";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  abandonStudyOpenSessions,
  applyStudyGuideCleanup,
  retainStudyGuideSourceNotes,
} from "../api";

type StudyGuideCleanupPanelProps = {
  guideCleanup: StudyGraphResponse["guideCleanup"];
  openSessionCount: number;
  studyId: string;
};

export function StudyGuideCleanupPanel({
  guideCleanup,
  openSessionCount,
  studyId,
}: StudyGuideCleanupPanelProps) {
  const router = useRouter();
  const [isApplying, setIsApplying] = useState(false);
  const [isAbandoningAndApplying, setIsAbandoningAndApplying] = useState(false);
  const [isRetainingNotes, setIsRetainingNotes] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cleanupBlockedBySessions =
    guideCleanup.scriptedResponseNodeCount > 0 && openSessionCount > 0;
  const retainedSourceContextHintCount =
    guideCleanup.scriptedResponseNodes.filter(
      (node) => node.retainedSourceContextHint,
    ).length;

  const handleRetainNotes = async () => {
    const confirmed = window.confirm(
      `Copy ${retainedSourceContextHintCount} source-context note(s) from imported scripted-response blocks onto the preceding real question(s), without removing any guide nodes?`,
    );
    if (!confirmed) {
      return;
    }

    setIsRetainingNotes(true);
    setStatus(null);
    setError(null);

    try {
      const result = await retainStudyGuideSourceNotes(studyId);
      const referenceUpdateText =
        result.sourceContextReferenceUpdatedNodeCount > 0
          ? ` Updated references on ${result.sourceContextReferenceUpdatedNodeCount} question(s).`
          : "";
      setStatus(
        `Retained ${result.retainedSourceContextHintCount} new source-context note(s) and updated ${result.sourceContextHintUpdatedNodeCount} question(s).${referenceUpdateText} ${result.remainingScriptedResponseNodeCount} cleanup item(s) remain for later review.`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to retain source-context notes.",
      );
    } finally {
      setIsRetainingNotes(false);
    }
  };

  const handleApply = async () => {
    if (cleanupBlockedBySessions) {
      setError(
        "Abandon open sessions from Session Management before applying guide cleanup.",
      );
      return;
    }

    const confirmed = window.confirm(
      `Remove ${guideCleanup.scriptedResponseNodeCount} imported scripted-response node(s), retain ${retainedSourceContextHintCount} source-context note(s), and bridge the survey flow around them?`,
    );
    if (!confirmed) {
      return;
    }

    setIsApplying(true);
    setStatus(null);
    setError(null);

    try {
      const result = await applyStudyGuideCleanup(studyId);
      const referenceUpdateText =
        result.sourceContextReferenceUpdatedNodeCount > 0
          ? ` updated references on ${result.sourceContextReferenceUpdatedNodeCount} question(s),`
          : "";
      setStatus(
        `Removed ${result.deletedNodeCount} node(s), retained ${result.retainedSourceContextHintCount} new source-context note(s),${referenceUpdateText} updated ${result.sourceContextHintUpdatedNodeCount} question(s), bridged ${result.createdBranchRuleCount} route(s), and left ${result.remainingScriptedResponseNodeCount} cleanup item(s).`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to apply cleanup.",
      );
    } finally {
      setIsApplying(false);
    }
  };

  const handleAbandonAndApply = async () => {
    const confirmed = window.confirm(
      `Abandon ${openSessionCount} active or pending session(s), then remove ${guideCleanup.scriptedResponseNodeCount} scripted-response node(s), retain ${retainedSourceContextHintCount} source-context note(s), and bridge the survey flow?`,
    );
    if (!confirmed) {
      return;
    }

    setIsAbandoningAndApplying(true);
    setStatus(null);
    setError(null);

    try {
      const abandoned = await abandonStudyOpenSessions(studyId);
      const cleaned = await applyStudyGuideCleanup(studyId);
      setStatus(
        `Abandoned ${abandoned.abandonedCount} open session(s), removed ${cleaned.deletedNodeCount} node(s), retained ${cleaned.retainedSourceContextHintCount} source-context note(s), and bridged ${cleaned.createdBranchRuleCount} route(s).`,
      );
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to abandon sessions and apply cleanup.",
      );
    } finally {
      setIsAbandoningAndApplying(false);
    }
  };

  return (
    <article className="panel stack-md" id="guide-cleanup">
      <div className="panel-title-row">
        <div className="stack-sm">
          <span className="label">Guide Cleanup</span>
          <h2>
            {guideCleanup.scriptedResponseNodeCount} review item
            {guideCleanup.scriptedResponseNodeCount === 1 ? "" : "s"}
          </h2>
        </div>
        <span
          className={
            guideCleanup.scriptedResponseNodeCount === 0
              ? "status-pill status-pill-good"
              : "status-pill status-pill-muted"
          }
        >
          {guideCleanup.scriptedResponseNodeCount === 0 ? "Clean" : "Review"}
        </span>
      </div>
      {guideCleanup.scriptedResponseNodes.length === 0 ? (
        <p className="muted-copy">
          No scripted interviewer response blocks or respondent examples are
          present in the fieldable question guide.
        </p>
      ) : (
        <>
          <p className="muted-copy">
            These imported nodes look like interviewer script examples or
            respondent quotes, not questions to ask. Remove them before
            fielding, or re-import with the cleaned importer.
          </p>
          <div className="detail-grid">
            <div className="stack-sm">
              <span className="label">Remove</span>
              <strong>{guideCleanup.scriptedResponseNodeCount}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Retain Notes</span>
              <strong>{retainedSourceContextHintCount}</strong>
            </div>
            <div className="stack-sm">
              <span className="label">Open Sessions</span>
              <strong>{openSessionCount}</strong>
            </div>
          </div>
          <ol className="plain-list compact-list">
            <li>
              <strong>Clear open sessions</strong>
              <span className="muted-copy">
                Abandon active or pending sessions so existing respondent links
                do not continue on an edited guide.
              </span>
            </li>
            <li>
              <strong>Apply guide cleanup</strong>
              <span className="muted-copy">
                Remove scripted-response nodes, bridge the flow, and retain
                useful source-context notes on the real questions.
              </span>
            </li>
          </ol>
          {cleanupBlockedBySessions ? (
            <p className="error-copy">
              {openSessionCount} open session
              {openSessionCount === 1 ? "" : "s"} must be abandoned from Session
              Management before cleanup can change the guide.{" "}
              <a className="text-link" href="#session-management">
                Open Session Management
              </a>
            </p>
          ) : null}
          <button
            className="button-secondary"
            disabled={
              isRetainingNotes ||
              isApplying ||
              isAbandoningAndApplying ||
              retainedSourceContextHintCount === 0
            }
            onClick={handleRetainNotes}
            type="button"
          >
            {isRetainingNotes ? "Retaining..." : "Retain Source Notes Only"}
          </button>
          <button
            className="button-primary"
            disabled={
              isRetainingNotes ||
              isApplying ||
              isAbandoningAndApplying ||
              cleanupBlockedBySessions
            }
            onClick={handleApply}
            type="button"
          >
            {isApplying
              ? "Applying..."
              : cleanupBlockedBySessions
                ? "Clear Sessions First"
                : "Apply Cleanup"}
          </button>
          {cleanupBlockedBySessions ? (
            <button
              className="button-secondary"
              disabled={isAbandoningAndApplying || isApplying}
              onClick={handleAbandonAndApply}
              type="button"
            >
              {isAbandoningAndApplying
                ? "Working..."
                : "Abandon Sessions & Apply Cleanup"}
            </button>
          ) : null}
          {status ? <p className="muted-copy">{status}</p> : null}
          {error ? <p className="error-copy">{error}</p> : null}
          <ul className="plain-list compact-list">
            {guideCleanup.scriptedResponseNodes.map((node) => (
              <li key={node.nodeId}>
                <div className="stack-sm">
                  <strong>{node.title}</strong>
                  <span className="muted-copy">{node.reason}</span>
                  <span className="micro-copy">
                    {node.moduleTitle ? `${node.moduleTitle} | ` : ""}
                    {node.sourceLine ? `line ${node.sourceLine} | ` : ""}
                    {node.nodeKey}
                  </span>
                  <p className="micro-copy">{node.prompt}</p>
                  {node.retainedSourceContextHint ? (
                    <p className="micro-copy">
                      Will retain source context:{" "}
                      {node.retainedSourceContextHint}
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
