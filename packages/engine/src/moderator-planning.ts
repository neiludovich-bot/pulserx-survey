import {
  moderatorEvidenceSelectionInputSchema,
  moderatorEvidenceSelectionResultSchema,
  moderatorPlanInputSchema,
  moderatorPlanResultSchema,
  moderatorPlanModelResultSchema,
  moderatorPhrasingInputSchema,
  moderatorPhrasingResultSchema,
  type ModeratorEvidenceSelectionInput,
  type ModeratorPlanInput,
  type ModeratorPhrasingInput,
} from "@interview/schemas";

function hasExplicitAdditionEvidence(evidence: string) {
  // This checks an explicit conversational addition, not medical topic words.
  // A reaction's consequence ("I would review concomitant medicines") is not
  // permission to reopen the same priority under a different label.
  return /\b(?:also|another|additional|in addition|as well|too|besides|alongside|on top of|one more)\b|\b(?:add|include)\b|\b(?:want|need|like) to (?:discuss|explore|cover|consider)\b/i.test(evidence);
}

export function normalizeModeratorPlanModelResult(input: ModeratorPlanInput, output: unknown) {
  const parsed = moderatorPlanInputSchema.parse(input);
  const model = moderatorPlanModelResultSchema.parse(output);
  const active = parsed.state.priorities.find((priority) => priority.id === parsed.state.activePriorityId && priority.status === "presented");
  const sourceOnly = (parsed.asksSourceQuestion || model.action === "answer_source") && parsed.answerStatus === "not_answered";
  const canCreditReaction = active && !parsed.isResumeCue && !sourceOnly;
  const reactionStatus = canCreditReaction ? model.reactionStatus : "not_answered";
  const reactionEvidence = canCreditReaction ? model.reactionEvidence : [];
  // Validate research evidence independently. A bad action/ID must not erase
  // a genuine reaction, but invented reaction evidence must still fail closed.
  validateModeratorPlan(parsed, {
    newPriorities: [],
    reactionStatus,
    reactionEvidence,
    action: parsed.asksSourceQuestion ? "answer_source" : "resume_guide",
    selectedPriorityId: null,
    rationale: model.rationale,
  });
  const newPriorities: Array<{ label: string; participantEvidence: string; sourceQuestion: string }> = [];
  const labels = new Set(parsed.state.priorities.map((priority) => priority.label.toLowerCase().trim()));
  for (const mention of parsed.isResumeCue ? [] : model.priorityMentions) {
    if (!parsed.participantMessage.includes(mention.participantEvidence) ||
        (mention.additionEvidence !== null && !parsed.participantMessage.includes(mention.additionEvidence))) {
      continue;
    }
    if (mention.existingPriorityId !== null &&
        !parsed.state.priorities.some((priority) => priority.id === mention.existingPriorityId)) {
      continue;
    }
    if (mention.existingPriorityId !== null ||
        mention.kind === "existing_priority" || mention.kind === "reaction_detail") continue;
    if (!parsed.isPriorityQuestion &&
        (mention.kind !== "additional_priority" || !mention.additionEvidence ||
         !hasExplicitAdditionEvidence(mention.additionEvidence))) continue;
    const labelKey = mention.label.toLowerCase().trim();
    if (labels.has(labelKey)) continue;
    labels.add(labelKey);
    newPriorities.push({ label: mention.label, participantEvidence: mention.participantEvidence, sourceQuestion: mention.sourceQuestion });
  }

  const selected = parsed.state.priorities.find((priority) => priority.id === model.selectedPriorityId);
  const pending = selected?.status === "pending" ? selected : parsed.state.priorities.find((priority) => priority.status === "pending");
  let action: typeof model.action;
  let selectedPriorityId: string | null;
  // The model supplies interpretation and a preference among valid pending
  // priorities. The engine reconciles that preference with actual state.
  if (!parsed.isResumeCue && (parsed.asksSourceQuestion || model.action === "answer_source")) {
    action = "answer_source";
    selectedPriorityId = active?.id ?? null;
  } else if (active && reactionStatus !== "answered" && (active.probeCount < 2 || parsed.isResumeCue)) {
    action = "probe_reaction";
    selectedPriorityId = active.id;
  } else if (pending || newPriorities.length) {
    action = "present_priority";
    selectedPriorityId = pending?.id ?? null;
  } else {
    action = "resume_guide";
    selectedPriorityId = null;
  }
  return validateModeratorPlan(parsed, {
    newPriorities,
    reactionStatus,
    reactionEvidence,
    action,
    selectedPriorityId,
    rationale: model.rationale,
  });
}

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
  if (!parsed.isResumeCue && parsed.asksSourceQuestion && result.action !== "answer_source") {
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
  if (parsed.action === "reaction") {
    if (!result.text.endsWith("?") || /[\r\n]/.test(result.text)) {
      throw new Error("A reaction must be a single question paragraph ending at its question mark.");
    }
    const words = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).map((word) => word.replace(/s$/, ""));
    const genericWords = new Set(["a", "an", "and", "the", "with", "of", "in", "for", "on", "to", "at", "information", "data", "evidence"]);
    const anchors = [...new Set(words(parsed.priorityLabel).filter((word) => word.length > 1 && !genericWords.has(word)))];
    const textWords = new Set(words(result.text));
    if (anchors.length && anchors.filter((word) => textWords.has(word)).length < Math.min(2, anchors.length)) {
      throw new Error("A reaction question must explicitly name its selected priority.");
    }
  }
  return result;
}

export function validateModeratorEvidenceSelection(input: ModeratorEvidenceSelectionInput, output: unknown) {
  const parsed = moderatorEvidenceSelectionInputSchema.parse(input);
  const result = moderatorEvidenceSelectionResultSchema.parse(output);
  const selectedSourceIds = new Set<string>();
  const selectedAssetIds = new Set<string>();
  for (const selection of result.selections) {
    if (parsed.evidenceFocus === "contextual" && selection.evidenceRole !== "contextual") {
      throw new Error("A contextual evidence search cannot select direct evidence.");
    }
    const source = parsed.candidates.find((candidate) => candidate.id === selection.sourceId);
    if (!source || selectedSourceIds.has(selection.sourceId)) {
      throw new Error("Evidence selection must use distinct submitted source IDs.");
    }
    selectedSourceIds.add(selection.sourceId);
    if (!source.text.includes(selection.supportExcerpt)) {
      throw new Error("Selected evidence requires an exact supporting excerpt from its candidate text.");
    }
    for (const assetId of selection.assetIds) {
      if (!source.assets.some((asset) => asset.id === assetId) || selectedAssetIds.has(assetId)) {
        throw new Error("Selected assets must be unique and belong to their selected source.");
      }
      selectedAssetIds.add(assetId);
    }
  }
  return result;
}
