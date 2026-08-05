"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  SourceAssetKind,
  SourceDocumentStatus,
  SourceDocumentType,
  SourceLibraryBulkImport,
  SourceLibraryDocument,
} from "@interview/schemas";
import {
  createSourceLibraryDocument,
  getSourceLibraryDocuments,
  importSourceLibraryDocuments,
} from "../api";

const SURVEY_OPTIONS = [
  { slug: "padcev", brand: "PADCEV" },
  { slug: "brukinsa", brand: "BRUKINSA" },
  { slug: "nubeqa", brand: "NUBEQA" },
  { slug: "data", brand: "DATA" },
];

const SOURCE_TYPES: SourceDocumentType[] = [
  "URL",
  "PDF",
  "TEXT",
  "MANUAL_NOTE",
];

const STATUSES: SourceDocumentStatus[] = ["DRAFT", "ACTIVE", "ARCHIVED"];

const ASSET_KINDS: SourceAssetKind[] = [
  "CHART",
  "TABLE",
  "PDF",
  "IMAGE",
  "VIDEO",
  "LINK",
  "OTHER",
];

type SourceLibraryClientProps = {
  initialSurveySlug?: string;
};

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function SourceLibraryClient({
  initialSurveySlug = "padcev",
}: SourceLibraryClientProps = {}) {
  const initialSurvey =
    SURVEY_OPTIONS.find((option) => option.slug === initialSurveySlug)?.slug ??
    "padcev";
  const [surveySlug, setSurveySlug] = useState(initialSurvey);
  const [sourceBrand, setSourceBrand] = useState("PADCEV");
  const [sourceType, setSourceType] = useState<SourceDocumentType>("URL");
  const [status, setStatus] = useState<SourceDocumentStatus>("ACTIVE");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [priority, setPriority] = useState(50);
  const [assetTitle, setAssetTitle] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [assetKind, setAssetKind] = useState<SourceAssetKind>("CHART");
  const [assetTags, setAssetTags] = useState("");
  const [bulkJson, setBulkJson] = useState("");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [documents, setDocuments] = useState<SourceLibraryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedSurvey = useMemo(
    () => SURVEY_OPTIONS.find((option) => option.slug === surveySlug),
    [surveySlug],
  );

  useEffect(() => {
    setSourceBrand(selectedSurvey?.brand ?? surveySlug.toUpperCase());
  }, [selectedSurvey, surveySlug]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getSourceLibraryDocuments(surveySlug)
      .then((response) => {
        if (!cancelled) {
          setDocuments(response.documents);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load source library.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [surveySlug]);

  async function refresh() {
    const response = await getSourceLibraryDocuments(surveySlug);
    setDocuments(response.documents);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    try {
      const hasAsset = assetTitle.trim() && assetUrl.trim();
      const response = await createSourceLibraryDocument({
        surveySlug,
        sourceBrand,
        sourceType,
        status,
        title,
        url: url.trim() ? url.trim() : undefined,
        description: description.trim() ? description.trim() : undefined,
        content: content.trim() ? content.trim() : undefined,
        tags: parseTags(tags),
        priority,
        assets: hasAsset
          ? [
              {
                title: assetTitle,
                url: assetUrl,
                assetKind,
                tags: parseTags(assetTags),
                priority,
              },
            ]
          : [],
      });

      setMessage(
        `Added ${response.document.title} with ${response.document.chunkCount} chunk(s).`,
      );
      setTitle("");
      setUrl("");
      setDescription("");
      setContent("");
      setTags("");
      setAssetTitle("");
      setAssetUrl("");
      setAssetTags("");
      await refresh();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save source document.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleBulkImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImporting(true);
    setError(null);
    setMessage(null);

    try {
      const parsed = JSON.parse(bulkJson) as Record<string, unknown>;
      const payload = {
        ...parsed,
        surveySlug:
          typeof parsed.surveySlug === "string"
            ? parsed.surveySlug
            : surveySlug,
        sourceBrand:
          typeof parsed.sourceBrand === "string"
            ? parsed.sourceBrand
            : sourceBrand,
        replaceExisting,
      } as SourceLibraryBulkImport;
      const response = await importSourceLibraryDocuments(payload);

      const importedSurveySlug = response.documents[0]?.surveySlug;
      if (importedSurveySlug) {
        setSurveySlug(importedSurveySlug);
      }
      setMessage(
        `Imported ${response.importedCount} source document(s) into the library.`,
      );
      setBulkJson("");
      await refresh();
    } catch (importError) {
      setError(
        importError instanceof SyntaxError
          ? "The source pack is not valid JSON."
          : importError instanceof Error
            ? importError.message
            : "Unable to import source pack.",
      );
    } finally {
      setImporting(false);
    }
  }

  async function handleBulkFile(file: File | null) {
    if (!file) {
      return;
    }

    setBulkJson(await file.text());
  }

  return (
    <div className="stack-lg">
      <form className="panel stack-md" onSubmit={handleBulkImport}>
        <div className="panel-title-row">
          <div>
            <p className="label">Bulk Import</p>
            <h2>Load Source Pack JSON</h2>
          </div>
          <span className="status-pill status-pill-muted">JSON</span>
        </div>
        <p className="muted-copy">
          Paste or choose a source-pack JSON with documents, factual source
          notes, tags, and assets. This imports evidence records, not canned
          survey answers.
        </p>
        <div className="form-grid">
          <label className="form-field">
            <span>Choose JSON file</span>
            <input
              accept="application/json,.json"
              type="file"
              onChange={(event) =>
                void handleBulkFile(event.currentTarget.files?.[0] ?? null)
              }
            />
          </label>
          <label className="checkbox-field">
            <input
              checked={replaceExisting}
              type="checkbox"
              onChange={(event) => setReplaceExisting(event.target.checked)}
            />
            <span>Replace existing sources for this survey before import</span>
          </label>
        </div>
        <label className="form-field">
          <span>Source pack JSON</span>
          <textarea
            value={bulkJson}
            onChange={(event) => setBulkJson(event.target.value)}
            placeholder='{"surveySlug":"padcev","sourceBrand":"PADCEV","documents":[...]}'
          />
        </label>
        <div className="composer-actions">
          <button
            className="button-primary"
            type="submit"
            disabled={importing || !bulkJson.trim()}
          >
            {importing ? "Importing..." : "Import JSON Pack"}
          </button>
        </div>
      </form>

      <form className="panel stack-md" onSubmit={handleSubmit}>
        <div className="panel-title-row">
          <div>
            <p className="label">Source Library</p>
            <h2>Add Source Material</h2>
          </div>
          <span className="status-pill status-pill-good">
            {documents.length} loaded
          </span>
        </div>

        {message ? <p className="muted-copy">{message}</p> : null}
        {error ? <p className="error-copy">{error}</p> : null}

        <div className="form-grid">
          <label className="form-field">
            <span>Survey</span>
            <select
              value={surveySlug}
              onChange={(event) => setSurveySlug(event.target.value)}
            >
              {SURVEY_OPTIONS.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {option.brand}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Brand</span>
            <input
              value={sourceBrand}
              onChange={(event) => setSourceBrand(event.target.value)}
            />
          </label>
          <label className="form-field">
            <span>Type</span>
            <select
              value={sourceType}
              onChange={(event) =>
                setSourceType(event.target.value as SourceDocumentType)
              }
            >
              {SOURCE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span>Status</span>
            <select
              value={status}
              onChange={(event) =>
                setStatus(event.target.value as SourceDocumentStatus)
              }
            >
              {STATUSES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="form-field">
          <span>Title</span>
          <input
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="PADCEV adverse reactions monitoring checklist"
          />
        </label>

        <div className="form-grid">
          <label className="form-field">
            <span>Source URL</span>
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://..."
            />
          </label>
          <label className="form-field">
            <span>Priority</span>
            <input
              min={0}
              max={100}
              type="number"
              value={priority}
              onChange={(event) => setPriority(Number(event.target.value))}
            />
          </label>
          <label className="form-field">
            <span>Tags</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="neuropathy, rash, safety"
            />
          </label>
        </div>

        <label className="form-field">
          <span>Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What this source is meant to support"
          />
        </label>

        <label className="form-field">
          <span>Pasted source text or notes</span>
          <textarea
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Paste the key approved source text, study excerpt, label section, or guide notes here."
          />
        </label>

        <section className="route-test-panel stack-sm">
          <div>
            <p className="label">Optional Asset</p>
            <h3>Attach one surfaced asset</h3>
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>Asset title</span>
              <input
                value={assetTitle}
                onChange={(event) => setAssetTitle(event.target.value)}
                placeholder="Neuropathy management guide PDF"
              />
            </label>
            <label className="form-field">
              <span>Asset URL</span>
              <input
                value={assetUrl}
                onChange={(event) => setAssetUrl(event.target.value)}
                placeholder="https://..."
              />
            </label>
            <label className="form-field">
              <span>Asset kind</span>
              <select
                value={assetKind}
                onChange={(event) =>
                  setAssetKind(event.target.value as SourceAssetKind)
                }
              >
                {ASSET_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Asset tags</span>
              <input
                value={assetTags}
                onChange={(event) => setAssetTags(event.target.value)}
                placeholder="guide, dose modification"
              />
            </label>
          </div>
        </section>

        <div className="composer-actions">
          <button className="button-primary" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Add Source"}
          </button>
        </div>
      </form>

      <section className="panel stack-md">
        <div className="panel-title-row">
          <div>
            <p className="label">Loaded Sources</p>
            <h2>{sourceBrand} Library</h2>
          </div>
          <button
            className="button-secondary"
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p className="muted-copy">Loading source library...</p>
        ) : null}
        {!loading && documents.length === 0 ? (
          <p className="muted-copy">No sources loaded yet for this survey.</p>
        ) : null}

        <div className="graph-list">
          {documents.map((document) => (
            <article className="graph-node-card" key={document.id}>
              <div className="panel-title-row">
                <span className="label">{document.sourceType}</span>
                <span className="status-pill status-pill-muted">
                  {document.status}
                </span>
              </div>
              <h3>{document.title}</h3>
              {document.description ? (
                <p className="muted-copy">{document.description}</p>
              ) : null}
              {document.contentPreview ? (
                <p className="micro-copy">{document.contentPreview}</p>
              ) : null}
              <p className="micro-copy">
                {document.chunkCount} chunk(s) | {document.assetCount} asset(s)
                | priority {document.priority} | updated{" "}
                {formatDate(document.updatedAt)}
              </p>
              <div className="pill-row">
                {document.tags.map((tag) => (
                  <span className="pill" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              {document.url ? (
                <a
                  className="text-link"
                  href={document.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Open source
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
