"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { SurveyImportPreview } from "@interview/schemas";
import { previewSurveyImport, publishSurveyImport } from "../api";

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + chunkSize),
    );
  }

  return btoa(binary);
}

function formatConditionKeywords(keywords: string[]) {
  return keywords.join(", ");
}

function formatMinutes(seconds: number) {
  const minutes = seconds / 60;

  return Number.isInteger(minutes)
    ? `${minutes} min`
    : `${minutes.toFixed(1)} min`;
}

function getPreviewMetrics(preview: SurveyImportPreview) {
  const mustAskCount = preview.questions.filter(
    (question) => question.mustAsk,
  ).length;
  const conditionalCount = preview.questions.filter(
    (question) => question.condition,
  ).length;
  const groundedContextCount = preview.questions.filter(
    (question) => question.requiresGroundedStudyContext,
  ).length;
  const estimatedQuestionSeconds = preview.questions.reduce(
    (total, question) => total + question.estimatedSeconds,
    0,
  );
  const availableSeconds = Math.max(
    0,
    preview.targetDurationSeconds - preview.closingReserveSeconds,
  );

  return {
    mustAskCount,
    optionalCount: preview.questions.length - mustAskCount,
    conditionalCount,
    groundedContextCount,
    estimatedQuestionSeconds,
    availableSeconds,
    timingStatus:
      estimatedQuestionSeconds > availableSeconds ? "Time-boxed" : "In Target",
  };
}

export function SurveyImportForm() {
  const router = useRouter();
  const [sourceText, setSourceText] = useState("");
  const [studyName, setStudyName] = useState("");
  const [targetDurationMinutes, setTargetDurationMinutes] = useState(15);
  const [customGptProjectId, setCustomGptProjectId] = useState("");
  const [assetTitle, setAssetTitle] = useState("");
  const [assetDescription, setAssetDescription] = useState("");
  const [assetStorageKey, setAssetStorageKey] = useState("");
  const [assetFileName, setAssetFileName] = useState<string | null>(null);
  const [assetFileBase64, setAssetFileBase64] = useState<string | null>(null);
  const [assetMimeType, setAssetMimeType] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [preview, setPreview] = useState<SurveyImportPreview | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? null);
    setFileBase64(file ? arrayBufferToBase64(await file.arrayBuffer()) : null);
  }

  async function handleAssetFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setAssetFileName(file?.name ?? null);
    setAssetMimeType(file?.type || null);
    setAssetFileBase64(
      file ? arrayBufferToBase64(await file.arrayBuffer()) : null,
    );
    if (file && !assetTitle.trim()) {
      setAssetTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  async function handlePreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsWorking(true);
    setStatus(null);

    try {
      const nextPreview = await previewSurveyImport({
        sourceText: sourceText.trim() || undefined,
        fileName: fileName ?? undefined,
        fileBase64: fileBase64 ?? undefined,
        studyName: studyName.trim() || undefined,
        targetDurationMinutes,
        customGptProjectId: customGptProjectId.trim() || null,
        assetTitle: assetTitle.trim() || undefined,
        assetDescription: assetDescription.trim() || undefined,
        assetStorageKey: assetStorageKey.trim() || undefined,
        assetFileName: assetFileName ?? undefined,
        assetFileBase64: assetFileBase64 ?? undefined,
        assetMimeType: assetMimeType ?? undefined,
      });
      setPreview(nextPreview);
      setStatus("Preview generated. Review it, then publish when ready.");
    } catch (error) {
      setPreview(null);
      setStatus(
        error instanceof Error ? error.message : "Unable to preview import.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function handlePublish() {
    if (!preview) {
      return;
    }

    setIsWorking(true);
    setStatus(null);

    try {
      const result = await publishSurveyImport(preview);
      router.push(`/research/studies/${result.study.id}`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to publish study.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="stack-lg">
      <form className="panel stack-md" onSubmit={handlePreview}>
        <div className="stack-sm">
          <span className="label">Import Survey Guide</span>
          <h2>DOCX or Raw Questions</h2>
          <p className="muted-copy">
            Upload a DOCX question list or paste the raw guide text. The
            importer creates modules, question nodes, sequential branch rules,
            attempt limits, and a default wrap-up question if needed.
          </p>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Study Name</span>
            <input
              onChange={(event) => setStudyName(event.target.value)}
              placeholder="BRUKINSA HCP Website Survey"
              value={studyName}
            />
          </label>
          <label className="form-field">
            <span>Target Minutes</span>
            <input
              min={1}
              onChange={(event) =>
                setTargetDurationMinutes(Number(event.target.value))
              }
              type="number"
              value={targetDurationMinutes}
            />
          </label>
          <label className="form-field">
            <span>CustomGPT Project ID</span>
            <input
              onChange={(event) => setCustomGptProjectId(event.target.value)}
              placeholder="Optional per-study project"
              value={customGptProjectId}
            />
          </label>
        </div>

        <label className="form-field">
          <span>Upload DOCX or Text File</span>
          <input
            accept=".docx,.txt,.md"
            onChange={handleFileChange}
            type="file"
          />
        </label>

        <label className="form-field">
          <span>Or Paste Raw Questions</span>
          <textarea
            onChange={(event) => setSourceText(event.target.value)}
            placeholder={
              "Section 1: First impressions\nQ1. What stood out first?\nQ2. What was unclear?"
            }
            rows={12}
            value={sourceText}
          />
        </label>

        <div className="stack-sm">
          <span className="label">Optional Side-Pane Asset</span>
          <p className="muted-copy">
            Attach a PDF, image, text file, or hosted URL to show beside the
            chat during the imported survey.
          </p>
        </div>

        <div className="form-grid">
          <label className="form-field">
            <span>Asset Title</span>
            <input
              onChange={(event) => setAssetTitle(event.target.value)}
              placeholder="BRUKINSA HCP Website"
              value={assetTitle}
            />
          </label>
          <label className="form-field">
            <span>Asset URL or Public Path</span>
            <input
              onChange={(event) => setAssetStorageKey(event.target.value)}
              placeholder="/assets/medical-concept-guide.pdf"
              value={assetStorageKey}
            />
          </label>
        </div>

        <label className="form-field">
          <span>Asset Description</span>
          <input
            onChange={(event) => setAssetDescription(event.target.value)}
            placeholder="Reference material shown in the side pane"
            value={assetDescription}
          />
        </label>

        <label className="form-field">
          <span>Upload Side-Pane Asset</span>
          <input
            accept=".pdf,.png,.jpg,.jpeg,.webp,.html,.htm,.txt,.md,.mp4,.webm"
            onChange={handleAssetFileChange}
            type="file"
          />
        </label>

        <div className="composer-actions">
          {status ? <p className="muted-copy">{status}</p> : null}
          <button className="button-primary" disabled={isWorking} type="submit">
            {isWorking ? "Generating..." : "Generate Preview"}
          </button>
        </div>
      </form>

      {preview ? (
        <section className="panel stack-md">
          <div className="graph-node-header">
            <div className="stack-sm">
              <span className="label">Preview</span>
              <h2>{preview.studyName}</h2>
              <p className="muted-copy">
                {preview.questions.length} questions across{" "}
                {preview.modules.length} module(s) |{" "}
                {preview.targetDurationSeconds / 60} minutes
                {preview.asset ? ` | asset: ${preview.asset.title}` : ""}
                {preview.questions.some((question) => question.condition)
                  ? ` | ${preview.questions.filter((question) => question.condition).length} conditional`
                  : ""}
              </p>
            </div>
            <button
              className="button-primary"
              disabled={isWorking}
              onClick={handlePublish}
              type="button"
            >
              Publish Study
            </button>
          </div>

          <div className="detail-grid">
            {(() => {
              const metrics = getPreviewMetrics(preview);

              return (
                <>
                  <article className="stack-sm">
                    <div className="panel-title-row">
                      <span className="label">Timing</span>
                      <span className="status-pill status-pill-muted">
                        {metrics.timingStatus}
                      </span>
                    </div>
                    <h3>
                      {formatMinutes(metrics.estimatedQuestionSeconds)} guide
                    </h3>
                    <p className="muted-copy">
                      {formatMinutes(preview.targetDurationSeconds)} target |{" "}
                      {formatMinutes(metrics.availableSeconds)} before wrap-up
                    </p>
                  </article>

                  <article className="stack-sm">
                    <div className="panel-title-row">
                      <span className="label">Question Mix</span>
                      <span className="status-pill status-pill-good">
                        {preview.questions.length} total
                      </span>
                    </div>
                    <h3>{metrics.mustAskCount} must-ask</h3>
                    <p className="muted-copy">
                      {metrics.optionalCount} optional |{" "}
                      {metrics.conditionalCount} conditional
                    </p>
                  </article>

                  <article className="stack-sm">
                    <div className="panel-title-row">
                      <span className="label">Grounding & Asset</span>
                      <span
                        className={
                          preview.customGptProjectId
                            ? "status-pill status-pill-good"
                            : "status-pill status-pill-muted"
                        }
                      >
                        {preview.customGptProjectId
                          ? "Project Set"
                          : "No Project"}
                      </span>
                    </div>
                    <h3>
                      {metrics.groundedContextCount} source-context question
                      {metrics.groundedContextCount === 1 ? "" : "s"}
                    </h3>
                    <p className="muted-copy">
                      {preview.asset
                        ? `${preview.asset.assetType} | ${preview.asset.displayMode}`
                        : "Attach a side-pane file or URL if respondents need source material."}
                    </p>
                  </article>
                </>
              );
            })()}
          </div>

          {preview.warnings.length > 0 ? (
            <ul>
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}

          {preview.asset ? (
            <article className="graph-node-card">
              <div className="graph-node-header">
                <div className="stack-sm">
                  <span className="label">Side-Pane Asset</span>
                  <h3>{preview.asset.title}</h3>
                </div>
                <div className="pill-row">
                  <span className="pill">{preview.asset.assetType}</span>
                  <span className="pill">{preview.asset.displayMode}</span>
                </div>
              </div>
              <p className="muted-copy">
                {preview.asset.description ??
                  "This asset will be shown beside the chat."}
              </p>
              <p className="micro-copy">
                source: {preview.asset.fileName ?? preview.asset.storageKey}
              </p>
            </article>
          ) : null}

          <div className="graph-list">
            {preview.questions.map((question) => (
              <article className="graph-node-card" key={question.key}>
                <div className="graph-node-header">
                  <div className="stack-sm">
                    <span className="label">{question.moduleKey}</span>
                    <h3>{question.title}</h3>
                  </div>
                  <div className="pill-row">
                    {question.mustAsk ? (
                      <span className="pill">Must Ask</span>
                    ) : null}
                    {question.condition ? (
                      <span className="pill">Conditional</span>
                    ) : null}
                    {question.requiresGroundedStudyContext ? (
                      <span className="pill">Source Context</span>
                    ) : null}
                    <span className="pill">{question.estimatedSeconds}s</span>
                  </div>
                </div>
                <p className="muted-copy">{question.prompt}</p>
                {question.condition ? (
                  <p className="micro-copy">
                    ask if previous answer contains:{" "}
                    {formatConditionKeywords(question.condition.matchKeywords)}
                    {question.condition.sourceQuestionKey
                      ? ` | based on ${question.condition.sourceQuestionKey}`
                      : ""}
                  </p>
                ) : null}
                {question.sourceContextHint ? (
                  <p className="micro-copy">
                    source context note: {question.sourceContextHint}
                  </p>
                ) : null}
                <p className="micro-copy">
                  facts: {question.factKeys.join(", ")}
                  {question.sourceLine ? ` | line ${question.sourceLine}` : ""}
                </p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
