/** Exposure duration is a distinct measure, not an adverse-reaction profile.
 * Gate by the asset's own metadata, never its containing page's safety tags. */
export function sourceAssetMeasureEligible(asset: { title: string; description?: string | null }, query: string) {
  const label = `${asset.title} ${asset.description ?? ""}`;
  const exposureDuration = /\bdurations?\b.{0,80}\bexposure\b|\bexposure\b.{0,80}\bdurations?\b/i.test(label);
  const treatment = /\bexposure\b|\btreat(?:ment|ed)\b|\btherapy\b/i.test(query);
  const asksDuration = /\bduration\b|\bhow long\b|\btime on\b/i.test(query);
  return !exposureDuration || treatment && asksDuration;
}

/** A numbered-study graphic cannot silently illustrate a different trial. */
export function sourceAssetAnswerEligible(asset: { title: string; description?: string | null }, answer: string) {
  if (!sourceAssetMeasureEligible(asset, answer)) return false;
  const studies = asset.title.match(/\bstudy\s+\d+\b/gi) ?? [];
  const normalized = answer.toLowerCase().replace(/\s+/g, ' ');
  return studies.every(study => normalized.includes(study.toLowerCase().replace(/\s+/g, ' ')));
}
