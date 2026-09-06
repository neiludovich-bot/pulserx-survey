import { researchPlanStateSchema, type ResearchPlanState, type ConversationObservation } from "@interview/schemas";

/** Coverage is derived from validated participant excerpts, never from the bot's answer. */
export function updateResearchCoverage(original: ResearchPlanState, observation: ConversationObservation | null, message: string) {
  const plan = researchPlanStateSchema.parse(structuredClone(original));
  plan.turn++;
  for (const signal of observation?.researchSignals ?? []) {
    const objective = plan.objectives.find(item => item.id === signal.objectiveId);
    if (!objective || !objective.criteria.some(criterion => criterion.id === signal.criterionId)) throw new Error("Unknown research objective or criterion.");
    if (!message.includes(signal.evidence)) throw new Error("Research evidence must be a current-message excerpt.");
    const request = observation?.request?.evidence;
    if (request && (request.includes(signal.evidence) || signal.evidence.includes(request))) continue;
    // Naming a feature and reacting to it cannot count twice as its own
    // explanation. A reason needs a separately identified supporting clause.
    if (signal.criterionId === "reason") {
      const perspectives = [...objective.evidence, ...(observation?.researchSignals ?? [])]
        .filter(item => item.objectiveId === signal.objectiveId && item.criterionId === "perspective");
      if (perspectives.some(item => item.evidence.trim() === signal.evidence.trim())) continue;
    }
    if (!objective.evidence.some(item => item.criterionId === signal.criterionId && item.evidence === signal.evidence)) {
      objective.evidence.push({ ...signal, turn: plan.turn });
    }
    const complete = objective.criteria.every(criterion => objective.evidence.some(item => item.criterionId === criterion.id));
    objective.status = complete ? "covered" : objective.status === "deferred" ? "deferred" : "partial";
  }
  return plan;
}

export function objectiveForQuestion(plan: ResearchPlanState | undefined, id: string | undefined) {
  return plan?.objectives.find(objective => objective.questionIds.includes(id ?? "") || id === `objective-probe:${objective.id}`);
}

/** Selection returns a missing criterion; phrasing is supplied by the configured guide. */
export function selectObjectiveFollowUp(plan: ResearchPlanState, questionId: string | undefined) {
  const objective = objectiveForQuestion(plan, questionId);
  if (!objective || ["covered", "deferred"].includes(objective.status) || objective.followUpsAsked >= 1) return null;
  const criterion = objective.criteria.find(item => !objective.evidence.some(evidence => evidence.criterionId === item.id));
  return criterion ? { objective, criterion } : null;
}
