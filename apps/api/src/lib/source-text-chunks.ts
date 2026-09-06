/** Sentence-preserving chunks. An oversized sentence stays intact for review. */
export function chunkSourceText(value: string) {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const units = value.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .flatMap(p => p.length <= 1200 ? [p] : [...segmenter.segment(p)].map(s => s.segment.trim()).filter(Boolean));
  const chunks: string[] = []; let current = "";
  for (const unit of units) {
    if (unit.length > 11000) throw new Error("Source contains an oversized unsegmented passage; review extraction before importing.");
    if (current && current.length + unit.length + 2 > 1200) { chunks.push(current); current = ""; }
    current = current ? `${current}\n\n${unit}` : unit;
  }
  if (current) chunks.push(current);
  return chunks;
}
