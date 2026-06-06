import Link from "next/link";
import {
  getStudyGraph,
  getStudyCustomGptSources,
  getStudySettings,
} from "../../../../../src/api";
import { getSuggestedCustomGptSitemapUrl } from "../../../../../src/customgpt-source-url";
import { StudySettingsForm } from "../../../../../src/components/StudySettingsForm";

export default async function StudySettingsPage({
  params,
}: {
  params: Promise<{ studyId: string }>;
}) {
  const { studyId } = await params;
  const [settings, graph, customGptSources] = await Promise.all([
    getStudySettings(studyId),
    getStudyGraph(studyId).catch(() => null),
    getStudyCustomGptSources(studyId).catch(() => null),
  ]);
  const sourceAssetSuggestions =
    graph?.assets
      .filter((asset) => /^https?:\/\//i.test(asset.storageKey))
      .map((asset) => ({
        id: asset.id,
        sitemapPath: getSuggestedCustomGptSitemapUrl(asset.storageKey),
        title: asset.title,
        storageKey: asset.storageKey,
      })) ?? [];

  return (
    <main className="shell">
      <section className="page-header">
        <Link className="back-link" href={`/research/studies/${studyId}`}>
          Back to study
        </Link>
        <p className="eyebrow">Admin Settings</p>
        <h1>Study Configuration</h1>
        <p className="lede">
          Connect the study to a CustomGPT project and tune runtime limits
          without changing the question guide.
        </p>
      </section>

      <StudySettingsForm
        initialCustomGptSources={customGptSources}
        initialSettings={settings}
        sourceAssetSuggestions={sourceAssetSuggestions}
      />
    </main>
  );
}
