import type { MvpCustomGptSourcePreviewResponse, MvpCustomGptSurveyMessage } from "@interview/schemas";

export type SourcePanelReference = {
  messageId: string;
  index: number;
  reference: MvpCustomGptSurveyMessage["references"][number];
  preview?: MvpCustomGptSourcePreviewResponse | null;
};

/** Only evidence-selected figures can automatically occupy the conversation panel. */
export function selectedSourceFigure(input: SourcePanelReference): SourcePanelReference | null {
  const { reference } = input;
  if (!reference.url) return null;
  const seen = new Set<string>();
  const images = reference.assets.filter((asset) => {
    if (!["CHART", "TABLE", "IMAGE"].includes(asset.assetKind.toUpperCase())) return false;
    try {
      const url = new URL(asset.url);
      if (!["https:", "http:"].includes(url.protocol) || !/\.(?:png|jpe?g|webp|gif|svg)$/i.test(url.pathname) || seen.has(asset.url)) return false;
      seen.add(asset.url);
      return true;
    } catch { return false; }
  }).slice(0, 6).map((asset) => ({
    url: asset.url, alt: asset.description ?? asset.title,
    width: null, height: null, source: "source_library" as const,
  }));
  if (images.length) return {
    ...input,
    preview: { sourceUrl: reference.url, title: reference.title, images, documents: [], reason: null },
  };
  return null;
}

export function selectAutomaticSourcePanel(message: MvpCustomGptSurveyMessage, suppressedMessageId?: string | null): SourcePanelReference | null {
  if (message.id === suppressedMessageId) return null;
  for (const [index, reference] of message.references.entries()) {
    const selected = selectedSourceFigure({ messageId: message.id, index: index + 1, reference });
    if (selected) return selected;
  }
  return null;
}
