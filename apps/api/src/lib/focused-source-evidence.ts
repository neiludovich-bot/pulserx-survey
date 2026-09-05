import type { GroundedReference, ModeratorEvidenceSelectionInput } from "@interview/schemas";
import type { ControlledRagChunk } from "./controlled-rag-source-packs";
import { getOptionalOpenAIGateway } from "./model-gateway";

type EvidenceAsset = NonNullable<ControlledRagChunk["assets"]>[number];
const QUERY_STOP_WORDS = new Set("a an and are as at be can could do does for from how i in is it me my of on or please show tell that the their there these this to us was we were what when where which with would you your".split(" "));

function terms(value: string, brand: string) {
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter(
    (term) => term.length > 1 && term !== brand && !QUERY_STOP_WORDS.has(term),
  ));
}

/** A reference without a selected figure must stay a source link, not trigger page scraping. */
export function withExplicitSourceAssets(reference: GroundedReference): GroundedReference {
  if (reference.assets.length || !reference.url) return reference;
  return { ...reference, assets: [{
    title: reference.title ?? "Source reference", url: reference.url,
    description: reference.description, assetKind: "LINK", tags: [], priority: 0,
  }] };
}

/** Keep numeric markers and the displayed reference list in the same order. */
export function alignCitedSourceReferences(answer: string, references: GroundedReference[]) {
  const cited = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
  if (cited.some((index) => index < 1 || index > references.length)) throw new Error("Answer cited an unselected evidence source.");
  if (!cited.length) return { answer, references };
  return {
    answer: answer.replace(/\[(\d+)\]/g, (_marker, index: string) => `[${cited.indexOf(Number(index)) + 1}]`),
    references: cited.map((index) => references[index - 1]),
  };
}

function fallbackAssets(chunk: ControlledRagChunk, query: string): EvidenceAsset[] {
  const queryTerms = terms(query, chunk.surveySlug);
  // Match the asset's own metadata. Document-level tags and global visual
  // priority cannot establish that a figure supports the selected evidence.
  const scored = (chunk.assets ?? []).map((asset) => {
    const identity = terms([asset.title, asset.description, ...asset.tags].join(" "), chunk.surveySlug);
    return { asset, score: [...queryTerms].filter((term) => identity.has(term)).length };
  }).filter(({ score }) => score > 0).sort((a, b) => b.score - a.score || b.asset.priority - a.asset.priority);
  return scored.slice(0, 1).map(({ asset }) => asset);
}

export async function selectFocusedSourceEvidence(input: {
  surveySlug: ControlledRagChunk["surveySlug"];
  query: string;
  candidates: ControlledRagChunk[];
  fallbackSourceIds: string[];
}): Promise<{ chunks: ControlledRagChunk[]; mode: "semantic" | "fallback" }> {
  const candidates = input.candidates.slice(0, 24);
  const selectionInput: ModeratorEvidenceSelectionInput = {
    surveySlug: input.surveySlug, query: input.query.slice(0, 4000),
    candidates: candidates.map((chunk) => ({
      id: chunk.id, title: chunk.title, url: chunk.url, description: chunk.description,
      text: chunk.text.slice(0, 12000), tags: chunk.tags,
      assets: (chunk.assets ?? []).map((asset, index) => ({
        id: `${chunk.id}:asset:${index}`, title: asset.title, url: asset.url,
        description: asset.description ?? "", assetKind: asset.assetKind, tags: asset.tags,
      })),
    })),
  };
  const gateway = getOptionalOpenAIGateway();
  if (gateway && candidates.length) {
    try {
      const selection = await gateway.selectModeratorEvidence(selectionInput);
      if (selection.result.selections.length > 3) throw new Error("Too many selected sources.");
      const seen = new Set<string>();
      const chunks = selection.result.selections.map(({ sourceId, assetIds }) => {
        const sourceIndex = candidates.findIndex((chunk) => chunk.id === sourceId);
        const source = candidates[sourceIndex];
        if (!source || seen.has(sourceId)) throw new Error("Invalid evidence source selection.");
        if (new Set(assetIds).size !== assetIds.length || assetIds.length > 6) throw new Error("Invalid evidence asset selection.");
        seen.add(sourceId);
        const assets = assetIds.map((assetId) => {
          const assetIndex = selectionInput.candidates[sourceIndex].assets.findIndex((asset) => asset.id === assetId);
          const asset = source.assets?.[assetIndex];
          if (!asset) throw new Error("Selected asset does not belong to its evidence source.");
          return asset;
        });
        return { ...source, assets };
      });
      return { chunks, mode: "semantic" };
    } catch {
      // A failed selection cannot borrow evidence or assets. The bounded
      // deterministic path remains available when the gateway is unavailable.
    }
  }
  const preferred = input.fallbackSourceIds.flatMap((id) => candidates.filter((chunk) => chunk.id === id));
  const selected = preferred.slice(0, 3);
  return { mode: "fallback", chunks: selected.map((chunk) => ({
    ...chunk, assets: fallbackAssets(chunk, input.query),
  })) };
}
