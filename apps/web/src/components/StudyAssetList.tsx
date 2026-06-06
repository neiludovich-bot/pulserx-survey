"use client";

import { useState } from "react";
import type { AssetDisplayMode, StudyGraphResponse } from "@interview/schemas";
import {
  addStudyCustomGptAssetSource,
  addStudyCustomGptSitemapSource,
  updateStudyAssetDisplayMode,
} from "../api";
import { getSuggestedCustomGptSitemapUrl } from "../customgpt-source-url";

type StudyAsset = StudyGraphResponse["assets"][number];
type StudyAssetStageRule = StudyGraphResponse["assetStageRules"][number];

type Props = {
  assets: StudyAsset[];
  assetStageRules: StudyAssetStageRule[];
  studyId: string;
};

const displayModeLabels: Record<AssetDisplayMode, string> = {
  INLINE_PANE: "Inline side pane",
  MODAL: "Modal review",
  FULLSCREEN: "Fullscreen review",
  DOWNLOAD_LINK: "Open link only",
};

function assetStageRuleSummary(stageRules: StudyAssetStageRule[]) {
  if (stageRules.length === 0) {
    return "Not staged";
  }

  return stageRules
    .map(
      (stageRule) =>
        `${displayModeLabels[stageRule.displayMode]} before ${
          stageRule.triggerActionKey ?? stageRule.triggerType
        }`,
    )
    .join("; ");
}

function isWebsiteAsset(asset: StudyAsset) {
  return /^https?:\/\//i.test(asset.storageKey);
}

export function StudyAssetList({ assets, assetStageRules, studyId }: Props) {
  const [stageRules, setStageRules] = useState(assetStageRules);
  const [uploadingAssetId, setUploadingAssetId] = useState<string | null>(null);
  const [updatingDisplayAssetId, setUpdatingDisplayAssetId] = useState<
    string | null
  >(null);
  const [statusByAssetId, setStatusByAssetId] = useState<
    Record<string, string>
  >({});
  const stageRulesByAssetId = new Map<string, StudyAssetStageRule[]>();

  for (const stageRule of stageRules) {
    stageRulesByAssetId.set(stageRule.assetId, [
      ...(stageRulesByAssetId.get(stageRule.assetId) ?? []),
      stageRule,
    ]);
  }

  async function handleDisplayModeChange(
    asset: StudyAsset,
    displayMode: AssetDisplayMode,
  ) {
    setUpdatingDisplayAssetId(asset.id);
    setStatusByAssetId((current) => ({
      ...current,
      [asset.id]: "",
    }));

    try {
      const result = await updateStudyAssetDisplayMode(studyId, asset.id, {
        displayMode,
      });
      setStageRules((currentRules) => {
        const nextRules = currentRules.filter(
          (stageRule) => stageRule.assetId !== asset.id,
        );
        return [...nextRules, ...result.stageRules].sort(
          (left, right) => left.priority - right.priority,
        );
      });
      setStatusByAssetId((current) => ({
        ...current,
        [asset.id]: `${result.updatedStageRuleCount} staging rule${
          result.updatedStageRuleCount === 1 ? "" : "s"
        } updated to ${displayModeLabels[result.displayMode]}; ${
          result.updatedActiveSessionAssetCount
        } active/pending session asset${
          result.updatedActiveSessionAssetCount === 1 ? "" : "s"
        } updated.`,
      }));
    } catch (error) {
      setStatusByAssetId((current) => ({
        ...current,
        [asset.id]:
          error instanceof Error
            ? error.message
            : "Unable to update asset display mode.",
      }));
    } finally {
      setUpdatingDisplayAssetId(null);
    }
  }

  async function handleSendToCustomGpt(asset: StudyAsset) {
    setUploadingAssetId(asset.id);
    setStatusByAssetId((current) => ({
      ...current,
      [asset.id]: "",
    }));

    try {
      const result = isWebsiteAsset(asset)
        ? await addStudyCustomGptSitemapSource(studyId, {
            sitemapPath: getSuggestedCustomGptSitemapUrl(asset.storageKey),
          })
        : await addStudyCustomGptAssetSource(studyId, {
            assetId: asset.id,
          });
      const indexedPages = result.sources.reduce(
        (total, source) => total + source.indexedPageCount,
        0,
      );
      const queuedPages = result.sources.reduce(
        (total, source) => total + source.queuedPageCount,
        0,
      );

      setStatusByAssetId((current) => ({
        ...current,
        [asset.id]: `Submitted ${
          isWebsiteAsset(asset) ? "sitemap source" : "asset"
        } to CustomGPT. ${indexedPages} indexed page(s), ${queuedPages} queued page(s) across ${result.sources.length} source(s).`,
      }));
    } catch (error) {
      setStatusByAssetId((current) => ({
        ...current,
        [asset.id]:
          error instanceof Error
            ? error.message
            : "Unable to send this asset to CustomGPT.",
      }));
    } finally {
      setUploadingAssetId(null);
    }
  }

  if (assets.length === 0) {
    return (
      <p className="muted-copy">No assets are configured for this study yet.</p>
    );
  }

  return (
    <div className="graph-list">
      {assets.map((asset) => {
        const assetRules = stageRulesByAssetId.get(asset.id) ?? [];
        const primaryStageRule = assetRules[0] ?? null;

        return (
          <article className="graph-node-card" key={asset.id}>
            <div className="stack-sm">
              <span className="label">{asset.assetType}</span>
              <h3>{asset.title}</h3>
            </div>
            <p className="muted-copy">
              {asset.description ?? "No description has been added yet."}
            </p>
            <p className="micro-copy">
              {asset.key} | {asset.storageKey}
            </p>
            <p className="micro-copy">
              Display: {assetStageRuleSummary(assetRules)}
            </p>
            <label className="form-field">
              <span>Respondent Display</span>
              <select
                disabled={
                  !primaryStageRule || updatingDisplayAssetId === asset.id
                }
                onChange={(event) =>
                  void handleDisplayModeChange(
                    asset,
                    event.target.value as AssetDisplayMode,
                  )
                }
                value={primaryStageRule?.displayMode ?? "INLINE_PANE"}
              >
                {Object.entries(displayModeLabels).map(([mode, label]) => (
                  <option key={mode} value={mode}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="composer-actions">
              <button
                className="button-secondary"
                disabled={uploadingAssetId === asset.id}
                onClick={() => void handleSendToCustomGpt(asset)}
                type="button"
              >
                {uploadingAssetId === asset.id
                  ? "Sending..."
                  : isWebsiteAsset(asset)
                    ? "Add Sitemap to CustomGPT"
                    : "Send Asset to CustomGPT"}
              </button>
            </div>
            {statusByAssetId[asset.id] ? (
              <p className="micro-copy">{statusByAssetId[asset.id]}</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
