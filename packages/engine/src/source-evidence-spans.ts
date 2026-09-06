import { sourceEvidenceSpanRangeSchema, sourceEvidenceSpanSelectionModelResultSchema, type ModeratorEvidenceSelectionInput } from "@interview/schemas";
import { validateModeratorEvidenceSelection } from "./moderator-planning";

/** Keep original offsets: joining normalized sentences can alter clinical text. */
export function indexedSourceSpans(text: string) {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const spans: Array<{ index: number; text: string; start: number; end: number }> = [];
  for (const segment of segmenter.segment(text)) {
    const leading = segment.segment.search(/\S/u);
    if (leading < 0) continue;
    const start = segment.index + leading;
    const end = segment.index + segment.segment.trimEnd().length;
    const previous = spans.at(-1);
    // Intl can split after abbreviations or standalone numbered-list markers.
    // Keep these attached to the following sentence without rewriting bytes.
    if (previous && (/(?:\b(?:vs|e\.g|i\.e|Dr|Mr|Mrs|Ms|Prof|Fig|No)\.|(?:\b[A-Z]\.){2,})$/iu.test(previous.text) || /^\d+\.$/u.test(previous.text))) {
      previous.end = end;
      previous.text = text.slice(previous.start, end);
      continue;
    }
    spans.push({ index: spans.length, text: text.slice(start, end), start, end });
  }
  return spans;
}

export function normalizeSourceEvidenceSpanSelection(input: ModeratorEvidenceSelectionInput, output: unknown) {
  const selected = sourceEvidenceSpanSelectionModelResultSchema.parse(output);
  const result = { ...selected, selections: selected.selections.map(({ supportSpanRange, ...selection }) => {
    const source = input.candidates.find((candidate) => candidate.id === selection.sourceId);
    if (!source) throw new Error("Evidence span selection must use a submitted source ID.");
    const range = sourceEvidenceSpanRangeSchema.parse(supportSpanRange);
    const spans = indexedSourceSpans(source.text);
    const first = spans[range.startSpan];
    const last = spans[range.endSpan];
    if (!first || !last || range.startSpan > range.endSpan) throw new Error("Evidence span range is outside its source or reversed.");
    const supportExcerpt = source.text.slice(first.start, last.end);
    if (supportExcerpt.length > 1500) throw new Error("Evidence span range exceeds the 1500-character excerpt bound.");
    return { ...selection, supportExcerpt };
  }) };
  return validateModeratorEvidenceSelection(input, result);
}
