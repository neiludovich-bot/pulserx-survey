import { moderatorEvidenceSelectionResultSchema, type GroundedReference, type ModeratorEvidenceSelectionInput, type SourceQuestionPlan } from "@interview/schemas";
import type { ControlledRagChunk } from "./controlled-rag-source-packs";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { sourceContentSearchTerms } from "./source-retrieval-query";

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

/** Expand numeric citation groups before validating or attaching references. */
export function normalizeSourceCitationMarkers(answer: string, sourceCount: number) {
  return answer.replace(/\[(\d+(?:\s*(?:[,;]|[-–])\s*\d+)*)\]/g, (_marker, group: string) => {
    const indexes = group.split(/\s*[,;]\s*/).flatMap((part) => {
      const bounds = part.split(/\s*[-–]\s*/).map(Number);
      const first = bounds[0];
      const last = bounds[1] ?? first;
      if (first < 1 || last < first || last > sourceCount) throw new Error("Answer cited an unselected evidence source.");
      return Array.from({ length: last - first + 1 }, (_value, index) => first + index);
    });
    return [...new Set(indexes)].map((index) => `[${index}]`).join(" ");
  });
}

/** Keep numeric markers and the displayed reference list in the same order. */
export function alignCitedSourceReferences(answer: string, references: GroundedReference[]) {
  answer = normalizeSourceCitationMarkers(answer, references.length);
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

type FocusedEvidenceInput = {
  surveySlug: ControlledRagChunk["surveySlug"];
  query: string;
  candidates: ControlledRagChunk[];
  fallbackSourceIds: string[];
  sourceTopicContext?: string | null;
  priorSourceIds?: string[];
  sourceQuestionPlan?: SourceQuestionPlan | null;
  presentationPlan?: ModeratorEvidenceSelectionInput["presentationPlan"];
  presentationContext?: ModeratorEvidenceSelectionInput["presentationContext"];
  evidenceFocus?: "all" | "contextual";
};
type EvidenceContribution = NonNullable<import("@interview/schemas").ModeratorEvidenceSelectionResult["selections"][number]["contribution"]>;
type EvidenceUnit = { chunk: ControlledRagChunk; contribution: EvidenceContribution };
type FocusedEvidenceResult = { chunks: ControlledRagChunk[]; mode: "semantic" | "fallback" | "unavailable"; units?: EvidenceUnit[] };
const isAnswerUnit = (unit: EvidenceUnit) => unit.contribution === "answer" || unit.contribution === "requested_context";

export async function selectFocusedSourceEvidence(input: FocusedEvidenceInput): Promise<Omit<FocusedEvidenceResult, "units">> {
  const { chunks, mode } = await selectEvidenceUnits(input);
  return { chunks, mode };
}

async function selectEvidenceUnits(input: FocusedEvidenceInput, hasPriorAnswer = false): Promise<FocusedEvidenceResult> {
  const candidates = input.candidates.slice(0, 24);
  const selectionInput: ModeratorEvidenceSelectionInput = {
    surveySlug: input.surveySlug, query: input.query.slice(0, 4000),
    sourceTopicContext: input.sourceTopicContext?.trim().slice(0, 6000) || null,
    priorSourceIds: input.priorSourceIds ?? [],
    sourceQuestionPlan: input.sourceQuestionPlan ?? null,
    presentationPlan: input.presentationPlan,
    presentationContext: input.presentationContext,
    evidenceFocus: input.evidenceFocus ?? "all",
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
    for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const selection = await gateway.selectModeratorEvidence(selectionInput);
      const selected = moderatorEvidenceSelectionResultSchema.parse(selection.result);
      const selectionLimit = input.presentationPlan?.maxFacts === 1 ? 1 : 3;
      if (selected.selections.length > selectionLimit) throw new Error("Too many selected sources.");
      const seen = new Set<string>();
      const hasAnswer = hasPriorAnswer || selected.selections.some(({ contribution }) => contribution === undefined || contribution === "answer" || contribution === "requested_context");
      const units: EvidenceUnit[] = selected.selections.flatMap(({ sourceId, assetIds, supportExcerpt, evidenceRole, contribution }) => {
        const sourceIndex = candidates.findIndex((chunk) => chunk.id === sourceId);
        const source = candidates[sourceIndex];
        if (!source || seen.has(sourceId)) throw new Error("Invalid evidence source selection.");
        if (!supportExcerpt?.trim() || !source.text.includes(supportExcerpt)) throw new Error("Evidence support must quote its selected source exactly.");
        if (new Set(assetIds).size !== assetIds.length || assetIds.length > 6) throw new Error("Invalid evidence asset selection.");
        seen.add(sourceId);
        const assets = assetIds.map((assetId) => {
          const assetIndex = selectionInput.candidates[sourceIndex].assets.findIndex((asset) => asset.id === assetId);
          const asset = source.assets?.[assetIndex];
          if (!asset) throw new Error("Selected asset does not belong to its evidence source.");
          return asset;
        });
        // A true statement about an unasked contrast/absence is not an answer.
        // Remove it before composition so it cannot bring its chart along.
        if (contribution === "contrast_or_limit_only" || contribution === "essential_qualification" && !hasAnswer) return [];
        return [{ chunk: { ...source, text: supportExcerpt, assets: contribution === "essential_qualification" ? [] : assets, ...(evidenceRole ? { evidenceRole } : {}) }, contribution: contribution ?? "answer" }];
      });
      if (input.presentationPlan?.maxFacts !== 1 && input.evidenceFocus !== "contextual" && input.sourceQuestionPlan?.answerApproach === "contextual_explanation") {
        // The original relation and the useful background are different evidence
        // needs. Always run the focused pass: a contextual label on the first
        // selection alone cannot establish that it contains useful background.
        // The plan's complementary search hints remain available, but the
        // selected request still owns scope in this focused pass.
        const focused = await selectEvidenceUnits({ ...input, evidenceFocus: "contextual", fallbackSourceIds: [] }, units.some(isAnswerUnit));
        const context = (focused.units ?? []).filter((unit) => unit.chunk.evidenceRole === "contextual" &&
          // A qualifier from the same document cannot replace the actual answer.
          !(unit.contribution === "essential_qualification" && units.some((prior) => prior.chunk.id === unit.chunk.id && isAnswerUnit(prior))))
          .sort((left, right) => Number(!isAnswerUnit(left)) - Number(!isAnswerUnit(right))).slice(0, 2);
        if (context.length) {
          const remaining = units.filter((unit) => !context.some((other) => other.chunk.id === unit.chunk.id))
            .sort((left, right) => Number(!isAnswerUnit(left)) - Number(!isAnswerUnit(right)) || Number(left.chunk.evidenceRole === "contextual") - Number(right.chunk.evidenceRole === "contextual"));
          const combined = [...remaining.slice(0, 3 - context.length), ...context]
            .sort((left, right) => Number(!isAnswerUnit(left)) - Number(!isAnswerUnit(right)));
          // Re-check the final bounded merge, not the pre-merge candidates.
          const accepted = combined.some(isAnswerUnit) ? combined : [];
          return { mode: "semantic", chunks: accepted.map((unit) => unit.chunk), units: accepted };
        }
      }
      const chunks = units.map((unit) => unit.chunk);
      if (!chunks.length) console.info({ event: "source_evidence_selection_empty", candidateCount: candidates.length });
      return { chunks, mode: "semantic", units };
    } catch (error) {
      const record = error !== null && typeof error === "object" ? error as { name?: unknown; status?: unknown; message?: unknown } : {};
      const names = new Set(["Error", "ZodError", "APIError", "AuthenticationError", "PermissionDeniedError", "RateLimitError", "APIConnectionError", "APIConnectionTimeoutError", "BadRequestError", "InternalServerError"]);
      const message = typeof record.message === "string" ? record.message : "";
      const code = /exact supporting excerpt|support must quote/.test(message) ? "nonverbatim_excerpt"
        : /distinct submitted source IDs|Invalid evidence source/.test(message) ? "invalid_source_id"
        : /assets must be unique|asset does not belong|Invalid evidence asset/.test(message) ? "invalid_asset_id"
        : /contextual evidence search/.test(message) ? "wrong_evidence_role"
        : /no parsed output/.test(message) ? "missing_structured_output"
        : record.name === "ZodError" ? "invalid_schema" : "provider_failure";
      console.warn({ event: "source_evidence_selection_failed", attempt,
        code,
        category: typeof record.name === "string" && names.has(record.name) ? record.name : "Error",
        status: typeof record.status === "number" ? record.status : null,
        reason: "No validated evidence selection was available." });
    }
    }
    // A model failure is not permission to substitute a broad heuristic card.
    return { chunks: [], mode: "unavailable" };
  }
  const queryTerms = sourceContentSearchTerms(input.query, input.surveySlug);
  const preferred = input.fallbackSourceIds.flatMap((id) => candidates.filter((chunk) => {
    if (chunk.id !== id) return false;
    const content = terms(chunk.text, input.surveySlug);
    // Initialisms are derived from actual contiguous source words, not
    // topic aliases or inherited document tags (for example, a three-word term).
    const words = chunk.text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const queryInitialisms = new Set(input.query.match(/\b[A-Z]{2,5}\b/g)?.map((term) => term.toLowerCase()) ?? []);
    return queryTerms.some((term) => content.has(term) || content.has(term.replace(/s$/, "")) ||
      queryInitialisms.has(term) && words.some((_word, index) => words.slice(index, index + term.length).map((word) => word[0]).join("") === term));
  }));
  // A full heuristic card cannot isolate one complete fact safely.
  if (input.presentationPlan?.maxFacts === 1) return { chunks: [], mode: "unavailable" };
  const selected = preferred.slice(0, 3);
  return { mode: "fallback", chunks: selected.map((chunk) => ({
    ...chunk, assets: fallbackAssets(chunk, input.query),
  })) };
}
