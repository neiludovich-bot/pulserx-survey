export function shouldProactivelyGroundClinicalStudyQuestion(prompt: string) {
  const referencesLikelyNamedEvidence =
    /\b[A-Z][A-Z0-9]+(?:[-\s][A-Z0-9]+)+\s+(?:data|evidence|results?|study|trial)\b/.test(
      prompt,
    );
  const namesSpecificStudy =
    /\b(ALPINE|SEQUOIA|ASPEN|ROSEWOOD|MAGNOLIA|BGB[-\s]?\d+|NCT\d+)\b/i.test(
      prompt,
    ) ||
    referencesLikelyNamedEvidence ||
    /\b[A-Z0-9][A-Z0-9-]{2,}\s+(study|trial)\b/.test(prompt) ||
    /\b(study|trial)\s+(called|named)\s+["']?[A-Z0-9][A-Z0-9-]{2,}/.test(
      prompt,
    );
  const referencesClinicalSourceMaterial =
    /\b(evidence|data|results?|study details?|trial details?|study design|trial design|clinical story|clinical profile|efficacy profile|safety profile|tolerability profile|guideline positioning|NCCN|accelerated approval|approval caveat|endpoints?|PFS|OS|ORR|HR|CI|hazard ratio|confidence interval|progression-free survival|overall survival|response rate|head-to-head|comparator|Kaplan-Meier|adverse events?|AEs?|phase\s*[123]|follow-up|confirmatory)\b/i.test(
      prompt,
    );
  const referencesPresentedClinicalSourceMaterial =
    /\b(?:this|that|these|those|above|below|shown|presented|following|table|chart|figure|slide|material|source)\b/i.test(
      prompt,
    ) &&
    /\b(?:study|trial|evidence|data|results?|clinical|efficacy|safety|tolerability|endpoint|PFS|OS|ORR|hazard ratio|adverse events?)\b/i.test(
      prompt,
    );
  const asksForSourceMaterialReaction =
    /\b(react|reaction|affect|impact|influence|view|perception|confidence|credible|convincing|persuasive|meaningful|differentiat|fit in your thinking|strengthen|move|limit|limits|weigh|stand out|stands out|compelling|relevant|useful|concerning|concerns|believable)\b/i.test(
      prompt,
    ) || /^based on\b/i.test(prompt);

  return (
    namesSpecificStudy ||
    ((referencesClinicalSourceMaterial ||
      referencesPresentedClinicalSourceMaterial) &&
      asksForSourceMaterialReaction)
  );
}

export function resolveGroundedStudyContextRequirement(input: {
  prompt: string;
  requiresGroundedStudyContext?: unknown;
}) {
  const detectedByPrompt = shouldProactivelyGroundClinicalStudyQuestion(
    input.prompt,
  );
  const sourceContextOverride =
    typeof input.requiresGroundedStudyContext === "boolean"
      ? input.requiresGroundedStudyContext
      : null;

  return {
    detectedByPrompt,
    sourceContextOverride,
    requiresGroundedStudyContext: sourceContextOverride ?? detectedByPrompt,
  } as const;
}
