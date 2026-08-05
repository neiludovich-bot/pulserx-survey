"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type {
  StudyGraphResponse,
  StudyLaunchCheckResponse,
  StudySummary,
} from "@interview/schemas";
import { getStudies, getStudyGraph, getStudyLaunchCheck } from "../api";
import { AdminGate } from "./AdminGate";
import { StudyAssetForm } from "./StudyAssetForm";

type Props = {
  surveySlug: "data" | "padcev" | "brukinsa" | "nubeqa";
  surveyName: string;
  surveyMode: string;
  liveHref: string;
};

function findStudy(studies: StudySummary[], slug: string) {
  return studies.find(
    (study) =>
      study.slug === slug ||
      study.name.toLowerCase().includes(slug.toLowerCase()),
  );
}

function formatNodeType(type: string) {
  return type
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function assetHref(asset: StudyGraphResponse["assets"][number]) {
  if (/^https?:\/\//i.test(asset.storageKey)) {
    return asset.storageKey;
  }

  return `/assets/${asset.id}/content`;
}

export function SurveyAdminClient({
  surveySlug,
  surveyName,
  surveyMode,
  liveHref,
}: Props) {
  const [studies, setStudies] = useState<StudySummary[]>([]);
  const [graph, setGraph] = useState<StudyGraphResponse | null>(null);
  const [launchCheck, setLaunchCheck] =
    useState<StudyLaunchCheckResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const study = useMemo(
    () => findStudy(studies, surveySlug),
    [studies, surveySlug],
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const nextStudies = await getStudies();
        if (cancelled) {
          return;
        }
        setStudies(nextStudies);
        const nextStudy = findStudy(nextStudies, surveySlug);
        if (!nextStudy) {
          setGraph(null);
          setLaunchCheck(null);
          return;
        }
        const [nextGraph, nextLaunchCheck] = await Promise.all([
          getStudyGraph(nextStudy.id),
          getStudyLaunchCheck(nextStudy.id),
        ]);
        if (!cancelled) {
          setGraph(nextGraph);
          setLaunchCheck(nextLaunchCheck);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load survey admin.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [surveySlug]);

  const nodes = graph?.nodes.filter((node) => !node.isTerminal) ?? [];
  const questionCount = nodes.length;
  const assetCount = graph?.assets.length ?? 0;
  const sourceContextCount =
    graph?.nodes.filter((node) => node.requiresGroundedStudyContext).length ??
    0;
  const status = launchCheck?.status ?? study?.status ?? "not configured";
  const actionById = new Map(
    graph?.actions.map((action) => [action.id, action]),
  );
  const assetsById = new Map(graph?.assets.map((asset) => [asset.id, asset]));

  return (
    <AdminGate>
      {(_session, { logout }) => (
        <main className="admin-page">
          <section className="admin-shell">
            <header className="admin-topbar">
              <div>
                <Link className="admin-back-link" href="/admin/">
                  Survey Admin
                </Link>
                <p className="admin-kicker">{surveyMode}</p>
                <h1>{surveyName}</h1>
                <p>
                  Manage this survey&apos;s guide, source context, staged
                  assets, and readiness from one page.
                </p>
              </div>
              <div className="admin-actions">
                <Link className="admin-button" href={liveHref}>
                  Live survey
                </Link>
                <button className="admin-button" onClick={logout} type="button">
                  Sign out
                </button>
              </div>
            </header>

            {error ? <p className="admin-error">{error}</p> : null}

            {!loading && !study ? (
              <section className="admin-empty-card">
                <p className="admin-kicker">Not configured</p>
                <h2>{surveyName} has not been imported as a study yet.</h2>
                <p>
                  Use the import page to publish a guide, then return here to
                  stage assets and review the question sequence.
                </p>
                <Link
                  className="admin-button admin-button-primary"
                  href={`/admin/import/?survey=${surveySlug}`}
                >
                  Import guide
                </Link>
              </section>
            ) : null}

            {study ? (
              <>
                <section className="admin-stat-grid">
                  <article>
                    <span>Status</span>
                    <strong>{loading ? "..." : status}</strong>
                  </article>
                  <article>
                    <span>Questions</span>
                    <strong>{loading ? "..." : questionCount}</strong>
                  </article>
                  <article>
                    <span>Assets</span>
                    <strong>{loading ? "..." : assetCount}</strong>
                  </article>
                  <article>
                    <span>Source context</span>
                    <strong>{loading ? "..." : sourceContextCount}</strong>
                  </article>
                  <article>
                    <span>Sessions</span>
                    <strong>{loading ? "..." : study.sessionCount}</strong>
                  </article>
                </section>

                {launchCheck?.recommendedActions.length ? (
                  <section className="admin-panel">
                    <div className="admin-section-header">
                      <div>
                        <h2>Launch Readiness</h2>
                        <p>
                          {launchCheck.blockingItemCount} blocker
                          {launchCheck.blockingItemCount === 1
                            ? ""
                            : "s"} and {launchCheck.warningItemCount} warning
                          {launchCheck.warningItemCount === 1 ? "" : "s"}.
                        </p>
                      </div>
                      <span
                        className={
                          launchCheck.status === "ready"
                            ? "admin-status active"
                            : "admin-status warning"
                        }
                      >
                        {launchCheck.status}
                      </span>
                    </div>
                    <div className="admin-list">
                      {launchCheck.recommendedActions
                        .slice(0, 5)
                        .map((item) => (
                          <article className="admin-list-item" key={item.key}>
                            <strong>{item.label}</strong>
                            <p>{item.action}</p>
                          </article>
                        ))}
                    </div>
                  </section>
                ) : null}

                <section className="admin-section-header">
                  <div>
                    <h2>Management Tools</h2>
                    <p>Update the guide, source library, or live asset map.</p>
                  </div>
                  <div className="admin-actions">
                    <Link
                      className="admin-button"
                      href={`/admin/import/?survey=${surveySlug}`}
                    >
                      Import / update guide
                    </Link>
                    <Link
                      className="admin-button"
                      href={`/admin/source-library/?survey=${surveySlug}`}
                    >
                      Source library
                    </Link>
                  </div>
                </section>

                {graph ? (
                  <>
                    <section className="admin-panel">
                      <div className="admin-section-header">
                        <div>
                          <h2>Question Flow</h2>
                          <p>
                            Ordered view of participant-facing questions with
                            source-context and staged-asset flags.
                          </p>
                        </div>
                      </div>
                      <div className="admin-question-list">
                        {nodes.map((node, index) => {
                          const nodeActions = graph.actions.filter(
                            (action) => action.nodeId === node.id,
                          );
                          const stagedAssetIds = graph.assetStageRules
                            .filter((rule) =>
                              nodeActions.some(
                                (action) => action.id === rule.triggerActionId,
                              ),
                            )
                            .map((rule) => rule.assetId);
                          const stagedAssets = Array.from(
                            new Set(stagedAssetIds),
                          )
                            .map((assetId) => assetsById.get(assetId))
                            .filter(Boolean);
                          const outboundRules = graph.edges.filter(
                            (edge) => edge.fromNodeId === node.id,
                          );

                          return (
                            <article
                              className="admin-question-card"
                              key={node.id}
                            >
                              <div className="admin-question-index">
                                {index + 1}
                              </div>
                              <div>
                                <div className="admin-card-head">
                                  <h3>{node.title}</h3>
                                  <div className="admin-actions compact">
                                    <span className="admin-chip">
                                      {formatNodeType(node.nodeType)}
                                    </span>
                                    {node.requiresGroundedStudyContext ? (
                                      <span className="admin-chip accent">
                                        Source
                                      </span>
                                    ) : null}
                                    {node.mustAsk ? (
                                      <span className="admin-chip">
                                        Must ask
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                                <p>{node.prompt}</p>
                                {node.sourceContextHint ? (
                                  <p className="admin-card-meta">
                                    Source note: {node.sourceContextHint}
                                  </p>
                                ) : null}
                                {stagedAssets.length ? (
                                  <div className="admin-pill-row">
                                    {stagedAssets.map((asset) =>
                                      asset ? (
                                        <a
                                          className="admin-pill"
                                          href={assetHref(asset)}
                                          key={asset.id}
                                          rel="noreferrer"
                                          target="_blank"
                                        >
                                          {asset.title}
                                        </a>
                                      ) : null,
                                    )}
                                  </div>
                                ) : null}
                                {outboundRules.length ? (
                                  <p className="admin-card-meta">
                                    {outboundRules.length} route
                                    {outboundRules.length === 1 ? "" : "s"} from
                                    this question.
                                  </p>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>

                    <section className="admin-panel">
                      <div className="admin-section-header">
                        <div>
                          <h2>Side-Panel Assets</h2>
                          <p>
                            Add a file or URL and choose the question where it
                            should appear.
                          </p>
                        </div>
                      </div>
                      <StudyAssetForm nodes={graph.nodes} studyId={study.id} />
                    </section>

                    <section className="admin-panel">
                      <div className="admin-section-header">
                        <div>
                          <h2>Loaded Assets</h2>
                          <p>
                            Current assets available to stage in the survey.
                          </p>
                        </div>
                      </div>
                      <div className="admin-card-grid slim">
                        {graph.assets.length ? (
                          graph.assets.map((asset) => {
                            const stageRules = graph.assetStageRules.filter(
                              (rule) => rule.assetId === asset.id,
                            );
                            const stagedAt = stageRules
                              .map((rule) => {
                                const action = rule.triggerActionId
                                  ? actionById.get(rule.triggerActionId)
                                  : null;
                                return (
                                  graph.nodes.find(
                                    (node) => node.id === action?.nodeId,
                                  )?.title ?? null
                                );
                              })
                              .filter(Boolean);

                            return (
                              <article className="admin-card" key={asset.id}>
                                <div className="admin-card-head">
                                  <h3>{asset.title}</h3>
                                  <span className="admin-chip">
                                    {asset.assetType}
                                  </span>
                                </div>
                                <p>
                                  {asset.description ??
                                    "No description has been added yet."}
                                </p>
                                {stagedAt.length ? (
                                  <p className="admin-card-meta">
                                    Shows near: {stagedAt.join(", ")}
                                  </p>
                                ) : (
                                  <p className="admin-card-meta">
                                    Not staged to a question yet.
                                  </p>
                                )}
                                <a
                                  className="admin-button"
                                  href={assetHref(asset)}
                                  rel="noreferrer"
                                  target="_blank"
                                >
                                  Open
                                </a>
                              </article>
                            );
                          })
                        ) : (
                          <p className="admin-card-meta">
                            No side-panel assets have been added yet.
                          </p>
                        )}
                      </div>
                    </section>
                  </>
                ) : null}
              </>
            ) : null}
          </section>
        </main>
      )}
    </AdminGate>
  );
}
