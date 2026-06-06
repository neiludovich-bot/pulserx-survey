"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type {
  StudyGraphResponse,
  StudyQuestionGroundingPreviewResponse,
} from "@interview/schemas";
import {
  previewStudyQuestionGrounding,
  updateStudyQuestionGrounding,
} from "../api";

type StudyGraphNode = StudyGraphResponse["nodes"][number];

function previewSourceLabel(
  source: StudyQuestionGroundingPreviewResponse["source"],
) {
  if (source === "customgpt") {
    return "CustomGPT";
  }

  if (source === "imported_guide") {
    return "Imported guide";
  }

  return "No source";
}

type Props = {
  initialNodes: StudyGraphNode[];
  studyId: string;
};

export function StudyQuestionNodeList({ initialNodes, studyId }: Props) {
  const router = useRouter();
  const [nodes, setNodes] = useState(initialNodes);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [previewingNodeId, setPreviewingNodeId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<
    Record<string, StudyQuestionGroundingPreviewResponse>
  >({});
  const [status, setStatus] = useState<string | null>(null);

  async function handleGroundingChange(node: StudyGraphNode, enabled: boolean) {
    setSavingNodeId(node.id);
    setStatus(null);

    try {
      const updated = await updateStudyQuestionGrounding(studyId, node.id, {
        requiresGroundedStudyContext: enabled,
      });
      setNodes((currentNodes) =>
        currentNodes.map((currentNode) =>
          currentNode.id === node.id
            ? {
                ...currentNode,
                requiresGroundedStudyContext:
                  updated.requiresGroundedStudyContext,
                sourceContextDetected: updated.sourceContextDetected,
                sourceContextOverride: updated.sourceContextOverride,
                sourceContextHint: updated.sourceContextHint,
                sourceContextReferences: updated.sourceContextReferences,
              }
            : currentNode,
        ),
      );
      setStatus(
        enabled
          ? "Source-context grounding enabled for that question."
          : "Source-context grounding disabled for that question.",
      );
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to update source-context grounding.",
      );
    } finally {
      setSavingNodeId(null);
    }
  }

  async function handlePreview(node: StudyGraphNode) {
    setPreviewingNodeId(node.id);
    setStatus(null);

    try {
      const preview = await previewStudyQuestionGrounding(studyId, node.id);
      setPreviews((currentPreviews) => ({
        ...currentPreviews,
        [node.id]: preview,
      }));
      setStatus(
        preview.status === "passed"
          ? "Source-context preview returned from CustomGPT."
          : (preview.reason ??
              "Source-context preview did not return content."),
      );
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "Unable to preview source-context grounding.",
      );
    } finally {
      setPreviewingNodeId(null);
    }
  }

  return (
    <div className="stack-md">
      {status ? <p className="muted-copy">{status}</p> : null}
      <div className="graph-list">
        {nodes.map((node) => (
          <article className="graph-node-card" key={node.id}>
            <div className="graph-node-header">
              <div className="stack-sm">
                <span className="label">
                  {node.moduleTitle ?? "Unassigned"}
                </span>
                <h3>{node.title}</h3>
              </div>
              <div className="pill-row">
                {node.isEntry ? <span className="pill">Entry</span> : null}
                {node.isTerminal ? (
                  <span className="pill">Terminal</span>
                ) : null}
                {node.mustAsk ? <span className="pill">Must Ask</span> : null}
                {node.requiresGroundedStudyContext ? (
                  <span className="pill">Source Context</span>
                ) : null}
              </div>
            </div>
            <p className="muted-copy">{node.prompt}</p>
            <label className="checkbox-field">
              <input
                checked={node.requiresGroundedStudyContext}
                disabled={savingNodeId === node.id}
                onChange={(event) =>
                  void handleGroundingChange(node, event.target.checked)
                }
                type="checkbox"
              />
              <span>
                Proactively pull CustomGPT study/source context before this
                question
              </span>
            </label>
            <button
              className="button-secondary"
              disabled={previewingNodeId === node.id}
              onClick={() => void handlePreview(node)}
              type="button"
            >
              {previewingNodeId === node.id
                ? "Previewing..."
                : "Preview Source Context"}
            </button>
            {previews[node.id] ? (
              <div className="source-preview stack-sm">
                <div className="panel-title-row">
                  <div className="stack-sm">
                    <span className="label">Source Context Preview</span>
                    <h4>{previews[node.id].questionTitle}</h4>
                  </div>
                  <span
                    className={
                      previews[node.id].status === "passed"
                        ? "status-pill status-pill-good"
                        : previews[node.id].status === "failed"
                          ? "status-pill status-pill-bad"
                          : "status-pill status-pill-muted"
                    }
                  >
                    {previews[node.id].status}
                  </span>
                </div>
                {previews[node.id].assetTitle ? (
                  <p className="micro-copy">
                    Asset: {previews[node.id].assetTitle}
                  </p>
                ) : null}
                <p className="micro-copy">
                  Source: {previewSourceLabel(previews[node.id].source)}
                </p>
                {previews[node.id].answer ? (
                  <p className="source-preview-answer">
                    {previews[node.id].answer}
                  </p>
                ) : (
                  <p className="muted-copy">
                    {previews[node.id].reason ??
                      "No source context was returned."}
                  </p>
                )}
                {previews[node.id].references.length > 0 ? (
                  <ul className="plain-list audit-reference-list">
                    {previews[node.id].references.map((reference, index) => (
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
                          <p className="muted-copy">{reference.description}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {node.sourceContextDetected ? (
              <p className="micro-copy">
                Suggested by prompt scan
                {node.sourceContextOverride !== null
                  ? " | researcher override saved"
                  : ""}
              </p>
            ) : node.sourceContextOverride !== null ? (
              <p className="micro-copy">Researcher override saved</p>
            ) : null}
            <p className="micro-copy">
              {node.key} | {node.nodeType}
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}
