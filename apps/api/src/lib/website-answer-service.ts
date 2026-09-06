import type { ModeratorEvidenceSelectionInput, ModeratorEvidenceSelectionResult, WebsiteAnswerModelResult } from "@interview/schemas";
import type { ControlledRagChunk } from "./controlled-rag-source-packs";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { sourceAssetAnswerEligible } from "./source-asset-measure";

export type WebsiteAnswerInput = Omit<ModeratorEvidenceSelectionInput, "candidates"> & { candidates: ControlledRagChunk[] };

export function websiteCandidatesForModel(candidates: ControlledRagChunk[]) {
  return candidates.slice(0, 24).map(source => ({
    id: source.id, title: source.title, url: source.url, description: source.description, tags: source.tags, text: source.text.slice(0, 12000),
    assets: (source.assets ?? []).map(({ priority: _priority, ...asset }, index) => ({ ...asset, id: `${source.id}:asset:${index}`, description: asset.description ?? "" })),
  }));
}

export function websiteAnswerChunks(candidates: ControlledRagChunk[], result: ModeratorEvidenceSelectionResult & Pick<WebsiteAnswerModelResult, "paragraphs" | "unavailableReason">) {
  return result.selections.map(selection => {
    const source = candidates.find(candidate => candidate.id === selection.sourceId);
    if (!source || !source.text.includes(selection.supportExcerpt)) throw new Error("Website response selected invalid source evidence.");
    const assets = selection.assetIds.map(id => {
      const index = (source.assets ?? []).findIndex((_asset, index) => `${source.id}:asset:${index}` === id);
      if (index < 0) throw new Error("Website response selected an asset from another source.");
      return source.assets![index];
    }).filter(asset => sourceAssetAnswerEligible(asset, result.paragraphs.map(paragraph => paragraph.text).join(" ")));
    return { ...source, text: selection.supportExcerpt, evidenceRole: selection.evidenceRole, contribution: selection.contribution, assets };
  });
}

/** Generate from the bot's existing website catalog, with source-owned assets. */
export async function answerFromWebsite(input: WebsiteAnswerInput) {
  const gateway = getOptionalOpenAIGateway();
  if (!gateway?.answerFromWebsite) return null;
  if (input.candidates.some(source => source.surveySlug !== input.surveySlug)) throw new Error("Website answer candidates must belong to the current bot.");
  const candidates = input.candidates.slice(0, 24);
  const call = await gateway.answerFromWebsite({ ...input, candidates: websiteCandidatesForModel(candidates) });
  const chunks = websiteAnswerChunks(candidates, call.result);
  return { chunks, paragraphs: call.result.paragraphs, unavailableReason: call.result.unavailableReason,
    // This identifies provenance validation accurately; it is not recorded as
    // the old independent medical-review model's approval.
    outcome: { version: 1 as const, status: "success" as const, attempts: [{ stage: "composition" as const, code: "source_linked",
      model: call.trace.response.model ?? null, responseId: call.trace.response.id ?? null }] },
  };
}

export function renderWebsiteAnswer(paragraphs: Array<{ text: string; sourceIds: string[] }>, chunks: ControlledRagChunk[]) {
  return paragraphs.map(paragraph => {
    const citations = paragraph.sourceIds.map(id => {
      const index = chunks.findIndex(source => source.id === id);
      if (index < 0) throw new Error("Website paragraph cites an unselected source.");
      return `[${index + 1}]`;
    }).join(" ");
    return `${paragraph.text} ${citations}`;
  }).join("\n\n");
}
