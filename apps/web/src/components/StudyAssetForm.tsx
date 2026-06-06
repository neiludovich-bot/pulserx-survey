"use client";

import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent } from "react";
import type { AssetDisplayMode, StudyGraphResponse } from "@interview/schemas";
import { createStudyAsset } from "../api";

type StudyGraphNode = StudyGraphResponse["nodes"][number];

type Props = {
  nodes: StudyGraphNode[];
  studyId: string;
};

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

export function StudyAssetForm({ nodes, studyId }: Props) {
  const router = useRouter();
  const stageableNodes = nodes.filter((node) => !node.isTerminal);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [storageKey, setStorageKey] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [displayMode, setDisplayMode] =
    useState<AssetDisplayMode>("INLINE_PANE");
  const [stageNodeId, setStageNodeId] = useState(stageableNodes[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setFileName(file?.name ?? null);
    setMimeType(file?.type || null);
    setFileBase64(file ? arrayBufferToBase64(await file.arrayBuffer()) : null);
    if (file && !title.trim()) {
      setTitle(file.name.replace(/\.[^.]+$/, ""));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setStatus(null);

    try {
      await createStudyAsset(studyId, {
        title,
        description: description.trim() || undefined,
        storageKey: storageKey.trim() || undefined,
        fileName: fileName ?? undefined,
        fileBase64: fileBase64 ?? undefined,
        mimeType: mimeType ?? undefined,
        displayMode,
        stageNodeId: stageNodeId || undefined,
      });
      setTitle("");
      setDescription("");
      setStorageKey("");
      setFileName(null);
      setFileBase64(null);
      setMimeType(null);
      setDisplayMode("INLINE_PANE");
      setStatus("Asset staged for the respondent side pane.");
      router.refresh();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to add study asset.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (stageableNodes.length === 0) {
    return null;
  }

  return (
    <form className="stack-md" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="form-field">
          <span>Asset Title</span>
          <input
            onChange={(event) => setTitle(event.target.value)}
            placeholder="BRUKINSA HCP Website"
            value={title}
          />
        </label>

        <label className="form-field">
          <span>Show Before Question</span>
          <select
            onChange={(event) => setStageNodeId(event.target.value)}
            value={stageNodeId}
          >
            {stageableNodes.map((node) => (
              <option key={node.id} value={node.id}>
                {node.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="form-field">
        <span>Asset Description</span>
        <input
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Reference material shown in the side pane"
          value={description}
        />
      </label>

      <div className="form-grid">
        <label className="form-field">
          <span>Asset URL or Public Path</span>
          <input
            onChange={(event) => setStorageKey(event.target.value)}
            placeholder="/assets/medical-concept-guide.pdf"
            value={storageKey}
          />
        </label>

        <label className="form-field">
          <span>Display</span>
          <select
            onChange={(event) =>
              setDisplayMode(event.target.value as AssetDisplayMode)
            }
            value={displayMode}
          >
            <option value="INLINE_PANE">Inline pane</option>
            <option value="MODAL">Modal</option>
            <option value="DOWNLOAD_LINK">Download link</option>
          </select>
        </label>
      </div>

      <label className="form-field">
        <span>Upload Asset</span>
        <input
          accept=".pdf,.png,.jpg,.jpeg,.webp,.html,.htm,.txt,.md,.mp4,.webm"
          onChange={handleFileChange}
          type="file"
        />
      </label>

      <div className="composer-footer">
        {status ? <p className="muted-copy">{status}</p> : <span />}
        <button
          className="button-secondary"
          disabled={saving || !title.trim() || (!storageKey.trim() && !fileBase64)}
          type="submit"
        >
          {saving ? "Adding..." : "Add Side-Pane Asset"}
        </button>
      </div>
    </form>
  );
}
