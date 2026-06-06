"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  StudyGraphResponse,
  StudyLaunchCheckResponse,
  StudyQuestionGroundingPreviewResponse,
  StudySourceContextPreviewResponse,
} from "@interview/schemas";
import {
  previewStudyQuestionGrounding,
  previewStudySourceContext,
  startTestSession,
  updateStudyQuestionGrounding,
  updateStudySourceContextNotes,
} from "../api";
import {
  buildSourceContextWorklist,
  formatSourceContextReferenceDraft,
  parseSourceContextReferenceDraft,
  parseSourceContextWorklistNotes,
  type SourceContextQuestion,
} from "../source-context-worklist";
import { buildSourceContextCoverageSummary } from "../source-context-coverage";

type Props = {
  launchCheck: StudyLaunchCheckResponse;
  sourceContext: StudyGraphResponse["sourceContext"];
  studyId: string;
};

type SourceContextFilter = "needs-detail" | "approved-notes" | "all";
type QuestionPreview =
  | StudyQuestionGroundingPreviewResponse
  | StudySourceContextPreviewResponse["previews"][number];

const SOURCE_CONTEXT_LAUNCH_ACTION_KEYS = new Set([
  "source_context",
  "source_context_review",
  "customgpt_key",
  "customgpt_project",
]);

function statusClass(status: StudySourceContextPreviewResponse["status"]) {
  if (status === "passed") {
    return "status-pill status-pill-good";
  }

  if (status === "failed") {
    return "status-pill status-pill-bad";
  }

  return "status-pill status-pill-muted";
}

function sourceLabel(
  source:
    | StudySourceContextPreviewResponse["previews"][number]["source"]
    | StudyQuestionGroundingPreviewResponse["source"],
) {
  if (source === "customgpt") {
    return "CustomGPT";
  }

  if (source === "imported_guide") {
    return "Imported guide";
  }

  return "No source";
}

function launchActionSeverityClass(
  severity: StudyLaunchCheckResponse["recommendedActions"][number]["severity"],
) {
  return severity === "blocker"
    ? "status-pill status-pill-bad"
    : "status-pill status-pill-muted";
}

function canApprovePreview(preview: QuestionPreview) {
  return (
    preview.status === "passed" &&
    Boolean(preview.answer?.trim()) &&
    preview.references.length > 0
  );
}

function hasReferencedApprovedNote(question: SourceContextQuestion) {
  return (
    Boolean(question.sourceContextHint) &&
    question.sourceContextReferences.length > 0
  );
}

export function StudySourceContextPanel({
  launchCheck,
  sourceContext,
  studyId,
}: Props) {
  const router = useRouter();
  const [questions, setQuestions] = useState(sourceContext.questions);
  const [filter, setFilter] = useState<SourceContextFilter>("needs-detail");
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      sourceContext.questions.map((question) => [
        question.nodeId,
        question.sourceContextHint ?? "",
      ]),
    ),
  );
  const [referenceDrafts, setReferenceDrafts] = useState<
    Record<string, string>
  >(() =>
    Object.fromEntries(
      sourceContext.questions.map((question) => [
        question.nodeId,
        formatSourceContextReferenceDraft(question.sourceContextReferences),
      ]),
    ),
  );
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] =
    useState<StudySourceContextPreviewResponse | null>(null);
  const [questionPreviews, setQuestionPreviews] = useState<
    Record<string, StudyQuestionGroundingPreviewResponse>
  >({});
  const [previewingNodeId, setPreviewingNodeId] = useState<string | null>(null);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);
  const [approvingPreviewNodeId, setApprovingPreviewNodeId] = useState<
    string | null
  >(null);
  const [applyingPreviewNotes, setApplyingPreviewNotes] = useState(false);
  const [worklistStatus, setWorklistStatus] = useState<string | null>(null);
  const [bulkWorklistText, setBulkWorklistText] = useState("");
  const [importingBulkNotes, setImportingBulkNotes] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approvedNoteCount = questions.filter(hasReferencedApprovedNote).length;
  const needsDetailCount = questions.length - approvedNoteCount;
  const coverageSummary = buildSourceContextCoverageSummary({
    sourceContext: {
      ...sourceContext,
      referencedApprovedNoteQuestionCount: approvedNoteCount,
      missingReferencedDetailQuestionCount: needsDetailCount,
      importedHintQuestionCount: approvedNoteCount,
      missingImportedHintQuestionCount: needsDetailCount,
      questions,
    },
    launchCheck,
  });
  const filteredQuestions = questions.filter((question) => {
    if (filter === "needs-detail") {
      return !hasReferencedApprovedNote(question);
    }

    if (filter === "approved-notes") {
      return hasReferencedApprovedNote(question);
    }

    return true;
  });
  const approvablePreviewCount =
    preview?.previews.filter(canApprovePreview).length ?? 0;
  const sourceContextLaunchActions = launchCheck.recommendedActions.filter(
    (item) =>
      item.category === "source_context" ||
      SOURCE_CONTEXT_LAUNCH_ACTION_KEYS.has(item.key),
  );

  async function handlePreviewAll() {
    setPreviewing(true);
    setError(null);

    try {
      setPreview(await previewStudySourceContext(studyId));
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Unable to preview source context.",
      );
    } finally {
      setPreviewing(false);
    }
  }

  async function handlePreviewQuestion(question: SourceContextQuestion) {
    setPreviewingNodeId(question.nodeId);
    setError(null);

    try {
      const questionPreview = await previewStudyQuestionGrounding(
        studyId,
        question.nodeId,
      );
      setQuestionPreviews((currentPreviews) => ({
        ...currentPreviews,
        [question.nodeId]: questionPreview,
      }));
    } catch (previewError) {
      setError(
        previewError instanceof Error
          ? previewError.message
          : "Unable to preview this source context.",
      );
    } finally {
      setPreviewingNodeId(null);
    }
  }

  async function handleStartTest(question: SourceContextQuestion) {
    setTestingNodeId(question.nodeId);
    setError(null);

    try {
      const session = await startTestSession(studyId, {
        startNodeId: question.nodeId,
      });
      router.push(`/respondent/${session.sessionId}`);
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : "Unable to start a test session at this question.",
      );
      setTestingNodeId(null);
    }
  }

  async function handleSaveNote(question: SourceContextQuestion) {
    setSavingNodeId(question.nodeId);
    setError(null);

    try {
      const note = noteDrafts[question.nodeId]?.trim() ?? "";
      const sourceContextReferences = note
        ? parseSourceContextReferenceDraft(
            question.nodeKey,
            referenceDrafts[question.nodeId] ?? "",
          )
        : [];
      const updated = await updateStudyQuestionGrounding(
        studyId,
        question.nodeId,
        {
          requiresGroundedStudyContext: true,
          sourceContextHint: note || null,
          sourceContextReferences,
        },
      );

      setQuestions((currentQuestions) =>
        currentQuestions.map((currentQuestion) =>
          currentQuestion.nodeId === question.nodeId
            ? {
                ...currentQuestion,
                sourceContextHint: updated.sourceContextHint,
                sourceContextReferences: updated.sourceContextReferences,
                sourceContextOverride: updated.sourceContextOverride,
              }
            : currentQuestion,
        ),
      );
      setNoteDrafts((currentDrafts) => ({
        ...currentDrafts,
        [question.nodeId]: updated.sourceContextHint ?? "",
      }));
      setReferenceDrafts((currentDrafts) => ({
        ...currentDrafts,
        [question.nodeId]: formatSourceContextReferenceDraft(
          updated.sourceContextReferences,
        ),
      }));
      setQuestionPreviews((currentPreviews) => {
        const remainingPreviews = { ...currentPreviews };
        delete remainingPreviews[question.nodeId];
        return remainingPreviews;
      });
      router.refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save source context note.",
      );
    } finally {
      setSavingNodeId(null);
    }
  }

  async function handleApprovePreview(
    question: SourceContextQuestion,
    questionPreview: QuestionPreview,
  ) {
    if (!canApprovePreview(questionPreview) || !questionPreview.answer) {
      setError(
        "Only passed previews with an answer and references can be saved as approved source notes.",
      );
      return;
    }

    setApprovingPreviewNodeId(question.nodeId);
    setWorklistStatus(null);
    setError(null);

    try {
      const updated = await updateStudyQuestionGrounding(
        studyId,
        question.nodeId,
        {
          requiresGroundedStudyContext: true,
          sourceContextHint: questionPreview.answer,
          sourceContextReferences: questionPreview.references,
        },
      );

      setQuestions((currentQuestions) =>
        currentQuestions.map((currentQuestion) =>
          currentQuestion.nodeId === question.nodeId
            ? {
                ...currentQuestion,
                sourceContextHint: updated.sourceContextHint,
                sourceContextReferences: updated.sourceContextReferences,
                sourceContextOverride: updated.sourceContextOverride,
              }
            : currentQuestion,
        ),
      );
      setNoteDrafts((currentDrafts) => ({
        ...currentDrafts,
        [question.nodeId]: updated.sourceContextHint ?? "",
      }));
      setReferenceDrafts((currentDrafts) => ({
        ...currentDrafts,
        [question.nodeId]: formatSourceContextReferenceDraft(
          updated.sourceContextReferences,
        ),
      }));
      setQuestionPreviews((currentPreviews) => {
        const remainingPreviews = { ...currentPreviews };
        delete remainingPreviews[question.nodeId];
        return remainingPreviews;
      });
      setWorklistStatus("Preview saved as an approved source note.");
      router.refresh();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Unable to approve this preview.",
      );
    } finally {
      setApprovingPreviewNodeId(null);
    }
  }

  async function handleApprovePassedPreviews() {
    if (!preview) {
      return;
    }

    const approvablePreviews = preview.previews.filter(canApprovePreview);
    if (approvablePreviews.length === 0) {
      setError(
        "No passed previews with references are available to approve yet.",
      );
      return;
    }

    setApplyingPreviewNotes(true);
    setWorklistStatus(null);
    setError(null);

    try {
      const response = await updateStudySourceContextNotes(studyId, {
        notes: approvablePreviews.map((item) => ({
          nodeId: item.nodeId,
          sourceContextHint: item.answer ?? "",
          sourceContextReferences: item.references,
        })),
      });
      const updatedQuestions = response.questions;

      setQuestions((currentQuestions) =>
        currentQuestions.map((currentQuestion) => {
          const updated = updatedQuestions.find(
            (item) => item.nodeId === currentQuestion.nodeId,
          );

          return updated
            ? {
                ...currentQuestion,
                sourceContextHint: updated.sourceContextHint,
                sourceContextReferences: updated.sourceContextReferences,
                sourceContextOverride: updated.sourceContextOverride,
              }
            : currentQuestion;
        }),
      );
      setNoteDrafts((currentDrafts) => ({
        ...currentDrafts,
        ...Object.fromEntries(
          updatedQuestions.map((updated) => [
            updated.nodeId,
            updated.sourceContextHint ?? "",
          ]),
        ),
      }));
      setReferenceDrafts((currentDrafts) => ({
        ...currentDrafts,
        ...Object.fromEntries(
          updatedQuestions.map((updated) => [
            updated.nodeId,
            formatSourceContextReferenceDraft(updated.sourceContextReferences),
          ]),
        ),
      }));
      setQuestionPreviews((currentPreviews) => {
        const remainingPreviews = { ...currentPreviews };
        for (const updated of updatedQuestions) {
          delete remainingPreviews[updated.nodeId];
        }
        return remainingPreviews;
      });
      setWorklistStatus(
        `${response.appliedCount} preview${
          response.appliedCount === 1 ? "" : "s"
        } saved as approved source notes.`,
      );
      router.refresh();
    } catch (approveError) {
      setError(
        approveError instanceof Error
          ? approveError.message
          : "Unable to approve passed previews.",
      );
    } finally {
      setApplyingPreviewNotes(false);
    }
  }

  async function handleCopyWorklist() {
    setWorklistStatus(null);
    setError(null);

    try {
      await navigator.clipboard.writeText(
        buildSourceContextWorklist(studyId, questions),
      );
      setWorklistStatus("Source-context worklist copied.");
    } catch (copyError) {
      setError(
        copyError instanceof Error
          ? copyError.message
          : "Unable to copy the source-context worklist.",
      );
    }
  }

  function handleDownloadWorklist() {
    setWorklistStatus(null);
    setError(null);

    const blob = new Blob([buildSourceContextWorklist(studyId, questions)], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${studyId}-source-context-worklist.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setWorklistStatus("Source-context worklist downloaded.");
  }

  async function handleApplyWorklistNotes() {
    setImportingBulkNotes(true);
    setWorklistStatus(null);
    setError(null);

    try {
      const parsedNotes = parseSourceContextWorklistNotes(
        bulkWorklistText,
        questions,
      );

      if (parsedNotes.length === 0) {
        setError(
          "No approved source notes were found. Paste a completed worklist with Approved source note lines.",
        );
        return;
      }

      const response = await updateStudySourceContextNotes(studyId, {
        notes: parsedNotes.map((note) => ({
          nodeId: note.nodeId,
          sourceContextHint: note.sourceContextHint,
          sourceContextReferences: note.sourceContextReferences,
        })),
      });
      const updatedQuestions = response.questions;

      setQuestions((currentQuestions) =>
        currentQuestions.map((currentQuestion) => {
          const updated = updatedQuestions.find(
            (item) => item.nodeId === currentQuestion.nodeId,
          );

          return updated
            ? {
                ...currentQuestion,
                sourceContextHint: updated.sourceContextHint,
                sourceContextReferences: updated.sourceContextReferences,
                sourceContextOverride: updated.sourceContextOverride,
              }
            : currentQuestion;
        }),
      );
      setNoteDrafts((currentDrafts) => ({
        ...currentDrafts,
        ...Object.fromEntries(
          updatedQuestions.map((updated) => [
            updated.nodeId,
            updated.sourceContextHint ?? "",
          ]),
        ),
      }));
      setReferenceDrafts((currentDrafts) => ({
        ...currentDrafts,
        ...Object.fromEntries(
          updatedQuestions.map((updated) => [
            updated.nodeId,
            formatSourceContextReferenceDraft(updated.sourceContextReferences),
          ]),
        ),
      }));
      setQuestionPreviews((currentPreviews) => {
        const remainingPreviews = { ...currentPreviews };
        for (const updated of updatedQuestions) {
          delete remainingPreviews[updated.nodeId];
        }
        return remainingPreviews;
      });
      setBulkWorklistText("");
      setWorklistStatus(
        `${response.appliedCount} approved source note${
          response.appliedCount === 1 ? "" : "s"
        } applied.`,
      );
      router.refresh();
    } catch (bulkError) {
      setError(
        bulkError instanceof Error
          ? bulkError.message
          : "Unable to apply approved source notes.",
      );
    } finally {
      setImportingBulkNotes(false);
    }
  }

  return (
    <article className="panel stack-md" id="source-context">
      <div className="panel-title-row">
        <div className="stack-sm">
          <span className="label">Proactive Source Context</span>
          <h2>
            {sourceContext.enabledQuestionCount} question
            {sourceContext.enabledQuestionCount === 1 ? "" : "s"}
          </h2>
        </div>
        <span
          className={
            sourceContext.enabledQuestionCount > 0
              ? "status-pill status-pill-good"
              : "status-pill status-pill-muted"
          }
        >
          {sourceContext.enabledQuestionCount > 0 ? "Configured" : "None"}
        </span>
      </div>
      <div className="detail-grid">
        <div className="stack-sm">
          <span className="label">Detected</span>
          <strong>{sourceContext.detectedQuestionCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Enabled Overrides</span>
          <strong>{sourceContext.overrideEnabledCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Disabled Overrides</span>
          <strong>{sourceContext.overrideDisabledCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Approved Notes</span>
          <strong>{approvedNoteCount}</strong>
        </div>
        <div className="stack-sm">
          <span className="label">Needs Detail</span>
          <strong>{needsDetailCount}</strong>
        </div>
      </div>
      {sourceContext.enabledQuestionCount > 0 ? (
        <p className="muted-copy">
          These questions will proactively show study/source detail before the
          survey question. CustomGPT can retrieve cited detail from approved
          source material; approved cited notes are shown immediately when the
          source needs researcher control.
        </p>
      ) : null}
      <div className="source-preview stack-sm">
        <div className="panel-title-row">
          <div className="stack-sm">
            <span className="label">Coverage Plan</span>
            <strong>{coverageSummary.label}</strong>
          </div>
          <span
            className={
              coverageSummary.status === "good"
                ? "status-pill status-pill-good"
                : coverageSummary.status === "warning"
                  ? "status-pill status-pill-muted"
                  : "status-pill status-pill-muted"
            }
          >
            {coverageSummary.status}
          </span>
        </div>
        <p className="muted-copy">{coverageSummary.detail}</p>
        <p className="micro-copy">{coverageSummary.action}</p>
        {sourceContextLaunchActions.length > 0 ? (
          <ul className="plain-list compact-list">
            {sourceContextLaunchActions.map((item) => (
              <li key={item.key}>
                <div className="panel-title-row">
                  <strong>{item.label}</strong>
                  <span className={launchActionSeverityClass(item.severity)}>
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
        ) : null}
      </div>
      {questions.length > 0 ? (
        <>
          <div className="source-context-toolbar">
            <div
              className="source-filter-row"
              aria-label="Source context queue"
            >
              <button
                className={
                  filter === "needs-detail"
                    ? "button-secondary source-filter-button source-filter-button-active"
                    : "button-secondary source-filter-button"
                }
                onClick={() => setFilter("needs-detail")}
                type="button"
              >
                Needs Detail ({needsDetailCount})
              </button>
              <button
                className={
                  filter === "approved-notes"
                    ? "button-secondary source-filter-button source-filter-button-active"
                    : "button-secondary source-filter-button"
                }
                onClick={() => setFilter("approved-notes")}
                type="button"
              >
                Referenced Notes ({approvedNoteCount})
              </button>
              <button
                className={
                  filter === "all"
                    ? "button-secondary source-filter-button source-filter-button-active"
                    : "button-secondary source-filter-button"
                }
                onClick={() => setFilter("all")}
                type="button"
              >
                All ({questions.length})
              </button>
            </div>
            <div className="source-filter-row">
              <button
                className="button-secondary"
                disabled={previewing}
                onClick={() => void handlePreviewAll()}
                type="button"
              >
                {previewing ? "Generating..." : "Preview All CustomGPT Detail"}
              </button>
              <button
                className="button-secondary"
                onClick={() => void handleCopyWorklist()}
                type="button"
              >
                Copy Worklist
              </button>
              <button
                className="button-secondary"
                onClick={handleDownloadWorklist}
                type="button"
              >
                Download Worklist
              </button>
            </div>
          </div>
          {worklistStatus ? (
            <p className="micro-copy">{worklistStatus}</p>
          ) : null}
          <div className="source-preview stack-sm">
            <div className="panel-title-row">
              <div className="stack-sm">
                <span className="label">Bulk Approved Notes</span>
                <strong>Paste completed worklist</strong>
              </div>
              <span className="status-pill status-pill-muted">Optional</span>
            </div>
            <p className="muted-copy">
              Paste the copied/downloaded worklist after filling in Approved
              source note and Approved reference lines. Notes and references
              are saved through the same typed per-question grounding path as
              manual review.
            </p>
            <label className="form-field">
              <span>Completed source-context worklist</span>
              <textarea
                onChange={(event) => setBulkWorklistText(event.target.value)}
                placeholder="Paste worklist text with Approved source note and Approved reference lines filled in."
                rows={6}
                value={bulkWorklistText}
              />
            </label>
            <div className="composer-actions">
              <button
                className="button-secondary"
                disabled={importingBulkNotes || !bulkWorklistText.trim()}
                onClick={() => void handleApplyWorklistNotes()}
                type="button"
              >
                {importingBulkNotes
                  ? "Applying..."
                  : "Apply Approved Notes"}
              </button>
            </div>
          </div>
          <ul className="plain-list compact-list">
            {filteredQuestions.map((question) => (
              <li key={question.nodeId}>
                <div className="panel-title-row">
                  <strong>{question.title}</strong>
                  <span
                    className={
                      hasReferencedApprovedNote(question)
                        ? "status-pill status-pill-good"
                        : "status-pill status-pill-muted"
                    }
                  >
                    {hasReferencedApprovedNote(question)
                      ? "Referenced Note"
                      : question.sourceContextHint
                        ? "Needs References"
                        : "Needs Detail"}
                  </span>
                </div>
                <span className="muted-copy">
                  {question.moduleTitle ?? "Unassigned"}
                  {question.assetTitle
                    ? ` | asset ${question.assetTitle}`
                    : " | no staged asset"}
                </span>
                <p className="micro-copy">
                  {question.nodeKey}
                  {question.sourceContextOverride !== null
                    ? " | researcher override"
                    : question.sourceContextDetected
                      ? " | prompt-detected"
                      : " | manually configured"}
                  {question.sourceContextHint ? " | imported context note" : ""}
                </p>
                <p className="muted-copy">{question.prompt}</p>
                {!question.sourceContextHint ? (
                  <p className="micro-copy">
                    Needs CustomGPT source coverage or an approved note with
                    references before it can show proactive detail.
                  </p>
                ) : question.sourceContextReferences.length === 0 ? (
                  <p className="micro-copy">
                    Source note saved, but add at least one approved reference
                    before counting it as fielding-ready context.
                  </p>
                ) : null}
                {question.sourceContextHint ? (
                  <p className="micro-copy">{question.sourceContextHint}</p>
                ) : null}
                {question.sourceContextReferences.length > 0 ? (
                  <p className="micro-copy">
                    {question.sourceContextReferences.length} approved reference
                    {question.sourceContextReferences.length === 1
                      ? ""
                      : "s"}{" "}
                    saved.
                  </p>
                ) : null}
                {questionPreviews[question.nodeId] ? (
                  <div className="source-preview stack-sm">
                    <div className="panel-title-row">
                      <div className="stack-sm">
                        <span className="label">Single Preview</span>
                        <h3>
                          {questionPreviews[question.nodeId].questionTitle}
                        </h3>
                      </div>
                      <span
                        className={statusClass(
                          questionPreviews[question.nodeId].status,
                        )}
                      >
                        {questionPreviews[question.nodeId].status}
                      </span>
                    </div>
                    {questionPreviews[question.nodeId].assetTitle ? (
                      <p className="micro-copy">
                        Asset: {questionPreviews[question.nodeId].assetTitle}
                      </p>
                    ) : null}
                    <p className="micro-copy">
                      Source:{" "}
                      {sourceLabel(questionPreviews[question.nodeId].source)} |{" "}
                      {questionPreviews[question.nodeId].referenceCount}{" "}
                      reference
                      {questionPreviews[question.nodeId].referenceCount === 1
                        ? ""
                        : "s"}
                    </p>
                    {questionPreviews[question.nodeId].answer ? (
                      <p className="source-preview-answer">
                        {questionPreviews[question.nodeId].answer}
                      </p>
                    ) : (
                      <p className="muted-copy">
                        {questionPreviews[question.nodeId].reason ??
                          "No source context was returned."}
                      </p>
                    )}
                    {questionPreviews[question.nodeId].references.length > 0 ? (
                      <ul className="plain-list audit-reference-list">
                        {questionPreviews[question.nodeId].references.map(
                          (reference, index) => (
                            <li key={`${reference.citationId}-${index}`}>
                              <strong>
                                [{index + 1}]{" "}
                                {reference.title ??
                                  `Citation ${reference.citationId}`}
                              </strong>
                              {reference.url ? (
                                <a
                                  className="text-link"
                                  href={reference.url}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  {reference.url}
                                </a>
                              ) : null}
                              {reference.description ? (
                                <p className="muted-copy">
                                  {reference.description}
                                </p>
                              ) : null}
                            </li>
                          ),
                        )}
                      </ul>
                    ) : null}
                    <div className="composer-actions">
                      <button
                        className="button-secondary"
                        disabled={
                          approvingPreviewNodeId === question.nodeId ||
                          !canApprovePreview(questionPreviews[question.nodeId])
                        }
                        onClick={() =>
                          void handleApprovePreview(
                            question,
                            questionPreviews[question.nodeId],
                          )
                        }
                        type="button"
                      >
                        {approvingPreviewNodeId === question.nodeId
                          ? "Saving..."
                          : "Save Preview as Note"}
                      </button>
                    </div>
                  </div>
                ) : null}
                <label className="form-field">
                  <span>Approved source note</span>
                  <textarea
                    onChange={(event) =>
                      setNoteDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [question.nodeId]: event.target.value,
                      }))
                    }
                    placeholder="Paste the study/source summary this question should show before asking for a reaction."
                    rows={4}
                    value={noteDrafts[question.nodeId] ?? ""}
                  />
                </label>
                <label className="form-field">
                  <span>Approved references</span>
                  <textarea
                    onChange={(event) =>
                      setReferenceDrafts((currentDrafts) => ({
                        ...currentDrafts,
                        [question.nodeId]: event.target.value,
                      }))
                    }
                    placeholder="One per line: Title | URL | Description"
                    rows={3}
                    value={referenceDrafts[question.nodeId] ?? ""}
                  />
                </label>
                <div className="composer-footer">
                  <span className="micro-copy">
                    Saved cited notes are used as reviewer-controlled
                    respondent context.
                  </span>
                  <div className="composer-actions">
                    <button
                      className="button-secondary"
                      disabled={previewingNodeId === question.nodeId}
                      onClick={() => void handlePreviewQuestion(question)}
                      type="button"
                    >
                      {previewingNodeId === question.nodeId
                        ? "Previewing..."
                        : "Preview Detail"}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={testingNodeId === question.nodeId}
                      onClick={() => void handleStartTest(question)}
                      type="button"
                    >
                      {testingNodeId === question.nodeId
                        ? "Starting..."
                        : "Start Test Here"}
                    </button>
                    <button
                      className="button-secondary"
                      disabled={savingNodeId === question.nodeId}
                      onClick={() => void handleSaveNote(question)}
                      type="button"
                    >
                      {savingNodeId === question.nodeId
                        ? "Saving..."
                        : "Save Source Note"}
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {filteredQuestions.length === 0 ? (
            <p className="muted-copy">
              No questions match this source-context filter.
            </p>
          ) : null}
        </>
      ) : (
        <p className="muted-copy">
          No questions are configured to proactively pull CustomGPT source
          context.
        </p>
      )}
      {error ? <p className="error-copy">{error}</p> : null}
      {preview ? (
        <div className="source-preview stack-sm">
          <div className="panel-title-row">
            <div className="stack-sm">
              <span className="label">Bulk Preview</span>
              <h3>{preview.previewCount} question checks</h3>
            </div>
            <span className={statusClass(preview.status)}>
              {preview.status}
            </span>
          </div>
          <p className="muted-copy">
            {preview.passedCount} passed | {preview.skippedCount} skipped |{" "}
            {preview.failedCount} failed
          </p>
          <p className="micro-copy">
            Passed previews with references can be saved as approved source
            notes. Those notes are used as reviewer-approved respondent detail;
            live CustomGPT fills the remaining questions that do not yet have a
            controlled summary.
          </p>
          <div className="composer-actions">
            <button
              className="button-secondary"
              disabled={applyingPreviewNotes || approvablePreviewCount === 0}
              onClick={() => void handleApprovePassedPreviews()}
              type="button"
            >
              {applyingPreviewNotes
                ? "Saving..."
                : `Save Cited Previews as Approved Notes (${approvablePreviewCount})`}
            </button>
          </div>
          <ul className="plain-list compact-list">
            {preview.previews.map((item) => (
              <li key={item.nodeId}>
                <div className="panel-title-row">
                  <strong>{item.questionTitle}</strong>
                  <span className={statusClass(item.status)}>
                    {item.status}
                  </span>
                </div>
                {item.answer ? (
                  <p className="source-preview-answer">{item.answer}</p>
                ) : (
                  <p className="muted-copy">
                    {item.reason ?? "No source context was returned."}
                  </p>
                )}
                <p className="micro-copy">
                  {item.nodeKey} | {sourceLabel(item.source)} |{" "}
                  {item.referenceCount} reference
                  {item.referenceCount === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
