import { websiteAnswerModelResultSchema, websiteAnswerRepairDetailSchema, type WebsiteAnswerRepairDetail, type ModeratorEvidenceSelectionInput } from "@interview/schemas";
import { normalizeSourceEvidenceSpanSelection } from "./source-evidence-spans";

const numbers = (text: string) => [...text.matchAll(/(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?![\p{L}\p{N}])/gu)].map(match => String(Number(match[0].replace(/,/g, ""))));
function reject(code: "invalid_output" | "unsupported_number" | "too_verbose" | "unrequested_endpoint", detail?: WebsiteAnswerRepairDetail) {
  throw Object.assign(new Error(`Website answer validation: ${code}`), { websiteAnswerFeedback: code, websiteAnswerRepairDetail: detail ?? null });
}
export function websiteAnswerRepairDetail(error: unknown) {
  const value = error && typeof error === "object" && "websiteAnswerRepairDetail" in error ? error.websiteAnswerRepairDetail : null;
  return websiteAnswerRepairDetailSchema.nullable().parse(value);
}

/** Provenance and output-contract checks, not an independent medical review. */
export function validateWebsiteAnswer(input: ModeratorEvidenceSelectionInput, output: unknown) {
  const result = websiteAnswerModelResultSchema.parse(output);
  const evidence = normalizeSourceEvidenceSpanSelection(input, { selections: result.selections, rationale: result.rationale });
  if (result.unavailableReason) {
    if (result.paragraphs.length || evidence.selections.length) reject("invalid_output");
    return { ...result, selections: evidence.selections };
  }
  if (!result.paragraphs.length || !evidence.selections.length) reject("invalid_output");
  // A PFS-only request does not authorize an unsolicited MFS/OS comparison.
  // Search expansions and broad page titles cannot widen the participant's ask.
  const pfs = /\b(?:r?pfs|(?:radiographic[ -])?progression[ -]free survival)\b/i;
  const otherEndpoints = /\b(?:mfs|os|metastasis[ -]free survival|overall survival)\b/i;
  const scope = input.presentationContext ? input.sourceTopicContext ?? input.query : input.query;
  if (pfs.test(scope) && !otherEndpoints.test(scope) && result.paragraphs.some(p => otherEndpoints.test(p.text))) reject("unrequested_endpoint");
  const cited = new Set<string>();
  for (const paragraph of result.paragraphs) {
    // Remove only redundant markers for this paragraph's explicitly declared
    // sources. The renderer adds numbered citations after ownership validation.
    // Unknown/internal IDs still fail rather than silently losing provenance.
    for (const sourceId of paragraph.sourceIds) paragraph.text = paragraph.text.split(`[${sourceId}]`).join("").trim();
    if (!paragraph.text || new Set(paragraph.sourceIds).size !== paragraph.sourceIds.length || /\[(?:\d+|db:[^\]]+)\]|https?:\/\//i.test(paragraph.text)) reject("invalid_output");
    const sources = paragraph.sourceIds.map(id => evidence.selections.find(source => source.sourceId === id));
    if (sources.some(source => !source)) reject("invalid_output");
    paragraph.sourceIds.forEach(id => cited.add(id));
    const supportedNumbers = new Set(numbers(sources.map(source => source!.supportExcerpt).join(" ")));
    const unsupportedNumbers = [...new Set(numbers(paragraph.text).filter(value => !supportedNumbers.has(value)))];
    if (unsupportedNumbers.length) reject("unsupported_number", { paragraph: paragraph.text, unsupportedNumbers, sourceIds: paragraph.sourceIds });
  }
  if (evidence.selections.some(source => !cited.has(source.sourceId) || source.contribution === "contrast_or_limit_only" || source.contribution === "essential_qualification" && source.assetIds.length)) reject("invalid_output");
  const wordCount = result.paragraphs.map(p => p.text).join(" ").split(/\s+/).length;
  if (input.presentationPlan?.maxFacts === 1 && (result.paragraphs.length !== 1 || wordCount > 45)) reject("too_verbose");
  if (input.presentationContext?.lastSourceAnswer && input.presentationPlan?.maxFacts === 1) {
    const previousWords = input.presentationContext.lastSourceAnswer.split(/\s+/).length;
    if (previousWords > 15 && wordCount >= previousWords) reject("too_verbose");
  }
  if (wordCount > 220) reject("too_verbose");
  return { ...result, selections: evidence.selections };
}
