import type { ModeratorState, ParticipantUnderstandingUpdate, PresentationPlan } from "@interview/schemas";

export function applyParticipantUnderstanding(state: ModeratorState, update: ParticipantUnderstandingUpdate | null | undefined, message: string) {
  if (!update || !update.participantEvidence.length || update.participantEvidence.some((excerpt) => !message.includes(excerpt))) return;
  const prior = state.understanding;
  state.understanding = {
    version: 1,
    productFamiliarity: update.productFamiliarity ?? prior?.productFamiliarity ?? "unknown",
    preferredDepth: update.preferredDepth ?? (prior?.depthPreferenceExplicit ? prior.preferredDepth : update.productFamiliarity === "low" ? "brief" : prior?.preferredDepth ?? "standard"),
    depthPreferenceExplicit: Boolean(update.preferredDepth || prior?.depthPreferenceExplicit),
    participantEvidence: [...new Set([...(prior?.participantEvidence ?? []), ...update.participantEvidence])].slice(-16),
  };
  return update;
}

export function presentationFor(state: ModeratorState, purpose: PresentationPlan["purpose"]): PresentationPlan {
  const depth = state.understanding?.preferredDepth ?? "standard";
  return { version: 1, purpose, depth, maxFacts: depth === "brief" ? 3 : depth === "detailed" ? 6 : 4, maxTopics: depth === "brief" ? 1 : 2, askReadiness: purpose === "orientation" };
}
