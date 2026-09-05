import {
  moderatorEvidenceSelectionInputSchema,
  moderatorEvidenceSelectionResultSchema,
  moderatorPlanInputSchema,
  moderatorPlanResultSchema,
  moderatorPhrasingInputSchema,
  moderatorPhrasingResultSchema,
  type ModeratorEvidenceSelectionInput,
  type ModeratorPlanInput,
  type ModeratorPhrasingInput,
} from "@interview/schemas";

export function validateModeratorPlan(input: ModeratorPlanInput, output: unknown) {
  const parsed = moderatorPlanInputSchema.parse(input);
  const result = moderatorPlanResultSchema.parse(output);
  const active = parsed.state.priorities.find((priority) => priority.id === parsed.state.activePriorityId);
  const selected = parsed.state.priorities.find((priority) => priority.id === result.selectedPriorityId);
  const excerpts = [
    ...result.newPriorities.map((priority) => priority.participantEvidence),
    ...result.reactionEvidence,
  ];
  if (excerpts.some((excerpt) => !parsed.participantMessage.includes(excerpt))) {
    throw new Error("Moderator evidence must be exact excerpts of the current participant message.");
  }
  if (parsed.isResumeCue && (result.newPriorities.length || result.reactionStatus !== "not_answered")) {
    throw new Error("A navigation cue cannot supply priorities or reaction evidence.");
  }
  if (result.reactionStatus !== "not_answered" && active?.status !== "presented") {
    throw new Error("Reaction credit requires an active presented priority.");
  }
  if (result.selectedPriorityId !== null && !selected) {
    throw new Error("The moderator selected an unknown priority ID.");
  }
  if (parsed.asksSourceQuestion && result.action !== "answer_source") {
    throw new Error("A participant source question must retain its source-answer action.");
  }
  if (result.action === "present_priority" &&
      (selected ? selected.status !== "pending" : result.newPriorities.length === 0)) {
    throw new Error("Presentation must select a pending or newly extracted priority.");
  }
  if (result.action === "probe_reaction" &&
      (!active || selected?.id !== active.id || active.status !== "presented" ||
       result.reactionStatus === "answered" || (active.probeCount >= 2 && !parsed.isResumeCue))) {
    throw new Error("A reaction probe requires an unanswered active presented priority within its probe budget.");
  }
  if (result.action === "resume_guide" && result.selectedPriorityId !== null) {
    throw new Error("Resuming the guide cannot select a priority.");
  }
  return result;
}

export function validateModeratorPhrasing(input: ModeratorPhrasingInput, output: unknown) {
  const parsed = moderatorPhrasingInputSchema.parse(input);
  const result = moderatorPhrasingResultSchema.parse(output);
  const questionCount = (result.text.match(/\?/g) ?? []).length;
  if (questionCount !== (parsed.action === "reaction" ? 1 : 0)) {
    throw new Error("A reaction must contain exactly one question; a transition must contain none.");
  }
  return result;
}

export function validateModeratorEvidenceSelection(input: ModeratorEvidenceSelectionInput, output: unknown) {
  const parsed = moderatorEvidenceSelectionInputSchema.parse(input);
  const result = moderatorEvidenceSelectionResultSchema.parse(output);
  const selectedSourceIds = new Set<string>();
  const selectedAssetIds = new Set<string>();
  for (const selection of result.selections) {
    const source = parsed.candidates.find((candidate) => candidate.id === selection.sourceId);
    if (!source || selectedSourceIds.has(selection.sourceId)) {
      throw new Error("Evidence selection must use distinct submitted source IDs.");
    }
    selectedSourceIds.add(selection.sourceId);
    for (const assetId of selection.assetIds) {
      if (!source.assets.some((asset) => asset.id === assetId) || selectedAssetIds.has(assetId)) {
        throw new Error("Selected assets must be unique and belong to their selected source.");
      }
      selectedAssetIds.add(assetId);
    }
  }
  return result;
}
