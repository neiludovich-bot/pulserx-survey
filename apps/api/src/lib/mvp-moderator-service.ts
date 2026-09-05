import { randomUUID } from "node:crypto";
import { moderatorPlanInputSchema, moderatorPlanResultSchema, moderatorStateSchema, type ModeratorState, type ModeratorPlanInput, type ModeratorPlanResult, type ModeratorEvidencePacket, type GroundedReference } from "@interview/schemas";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { askSourceProviderForSurveyInterviewerTurn } from "./source-answer-service";

export const emptyModeratorState = (): ModeratorState => moderatorStateSchema.parse({ version: 1, priorities: [], activePriorityId: null });
type Input = ModeratorPlanInput & { surveySlug: "nubeqa" | "brukinsa" | "padcev"; projectId?: string | null; surveyContext: string };
const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function runModeratorTurn(input: Input) {
  const gateway = getOptionalOpenAIGateway();
  const state = moderatorStateSchema.parse(structuredClone(input.state));
  const hadOpenPriorities = state.priorities.some((p) => p.status === "pending" || p.status === "presented");
  if (!state.priorities.length && !gateway) return null;
  const planningInput = moderatorPlanInputSchema.parse({ brand: input.brand, currentQuestion: input.currentQuestion, participantMessage: input.participantMessage, recentTurns: input.recentTurns, state, isPriorityQuestion: input.isPriorityQuestion, asksSourceQuestion: input.asksSourceQuestion, answerStatus: input.answerStatus, isResumeCue: input.isResumeCue });
  let plan: ModeratorPlanResult;
  let plannerError: string | null = null;
  try {
    if (!gateway) throw new Error("Moderator model unavailable.");
    plan = moderatorPlanResultSchema.parse((await gateway.planModeratorTurn(planningInput)).result);
    if (plan.newPriorities.some((p) => !input.participantMessage.includes(p.participantEvidence)) || plan.reactionEvidence.some((e) => !input.participantMessage.includes(e))) throw new Error("Moderator evidence must be an exact participant excerpt.");
  } catch (error) {
    plannerError = error instanceof Error ? error.message : "Moderator planning failed.";
    // Preserve explicit lists during an API outage. This does not infer medical
    // meaning or manufacture research answers from a navigation message.
    const labels = input.isPriorityQuestion && input.answerStatus !== "not_answered" && !input.asksSourceQuestion
      ? input.participantMessage.split(/\s*(?:,|;|\band\b|&)\s*/i).filter(Boolean).slice(0, 16) : [];
    plan = { newPriorities: labels.map((label) => ({ label: label.slice(0, 200), participantEvidence: label, sourceQuestion: `What approved evidence about ${label} is available for ${input.brand}?` })), reactionStatus: "not_answered", reactionEvidence: [], action: "probe_reaction", selectedPriorityId: null, rationale: "Retain pending topics and ask for clarification while model planning is unavailable." };
  }
  const previousActive = state.priorities.find((p) => p.id === state.activePriorityId);
  if (!hadOpenPriorities && plan.newPriorities.length === 0) return null;
  for (const priority of plan.newPriorities) {
    if (state.priorities.length >= 64) break;
    if (!state.priorities.some((p) => normalized(p.label) === normalized(priority.label))) {
      state.priorities.push({ ...priority, id: randomUUID(), status: "pending", reactionEvidence: [], referenceIds: [], probeCount: 0 });
    }
  }
  if (!state.priorities.length) return null;
  const explicitSkip = /^(?:please )?(?:skip (?:this|that)(?: topic| question)?|move on from (?:this|that))$/i.test(input.participantMessage.trim().replace(/[.!]+$/, ""));
  const skipAgenda = /^(?:(?:i'm|i am) done with (?:these|those|my) (?:topics|priorities)[;,.]?\s*(?:move on)?|skip (?:these|all|the remaining) (?:topics|priorities))$/i.test(input.participantMessage.trim().replace(/[.!]+$/, ""));
  if (skipAgenda) {
    for (const priority of state.priorities) if (["pending", "presented"].includes(priority.status)) priority.status = "skipped";
    state.activePriorityId = null;
  } else if (explicitSkip && !previousActive) {
    const pending = state.priorities.find((p) => p.status === "pending");
    if (pending) pending.status = "skipped";
  }
  if (previousActive?.status === "presented") {
    if (explicitSkip) previousActive.status = "skipped";
    else if (!input.isResumeCue && plan.reactionStatus !== "not_answered") {
      previousActive.reactionEvidence = [...new Set([...previousActive.reactionEvidence, ...plan.reactionEvidence])].slice(-32);
      if (plan.reactionStatus === "answered") previousActive.status = "reacted";
    }
    if (["reacted", "skipped"].includes(previousActive.status)) state.activePriorityId = null;
  }
  let action: ModeratorPlanResult["action"] = "resume_guide";
  let sourceUsed = false;
  let references: GroundedReference[] = [];
  let content: string | null = null;
  let question: string | null = null;
  let sourceReason: string | null = null;
  let sourceEvidencePacket: ModeratorEvidencePacket | undefined;
  const creditOriginalAnswer = !previousActive && input.answerStatus === "answered" && plan.newPriorities.length > 0;
  const phrase = async (kind: "reaction" | "transition", label: string) => {
    try {
      if (!gateway) throw new Error("No phrasing model");
      const text = (await gateway.phraseModeratorTurn({ brand: input.brand, action: kind, priorityLabel: label, participantMessage: input.participantMessage, previousPriorityLabel: previousActive?.label ?? null })).result.text;
      if (kind === "reaction" && (text.match(/\?/g)?.length !== 1)) throw new Error("A reaction prompt must contain one question.");
      return text;
    } catch {
      return kind === "reaction" ? `How does this information about ${label} affect your assessment of ${input.brand}?` : `You also mentioned ${label}. Let's look at that next.`;
    }
  };
  const source = async (query: string, sourceTopicContext: string | null = null, evidencePacket?: ModeratorEvidencePacket) => {
    sourceUsed = true;
    try {
      const answer = await askSourceProviderForSurveyInterviewerTurn({ surveySlug: input.surveySlug, projectId: input.projectId, participantMessage: query, sourceTopicContext, evidencePacket, surveyContext: input.surveyContext, currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, recentInterviewerContext: input.recentTurns.slice(-2).map((t) => `${t.role}: ${t.content}`).join("\n"), remainingSeconds: 600, askedQuestions: [], responseMode: "answer_only" });
      if (!answer.enabled || !answer.answer || !answer.references.length) { sourceReason = answer.reason ?? "No supporting evidence returned."; return null; }
      references = answer.references;
      sourceEvidencePacket = answer.evidencePacket ?? undefined;
      return answer.answer;
    } catch (error) { sourceReason = error instanceof Error ? error.message : "Evidence unavailable."; return null; }
  };
  if ((input.asksSourceQuestion || plan.action === "answer_source") && !input.isResumeCue) {
    action = "answer_source";
    const answer = await source(input.participantMessage, previousActive?.sourceQuestion ?? null, previousActive?.evidencePacket);
    content = answer ? `${answer}\n\nWhat else would you like to explore? Say "continue" when you're ready to return to the interview.` : 'I could not find supporting evidence for that question. You can clarify your question, or say "continue" to return to the interview.';
  } else {
    const active = state.priorities.find((p) => p.id === state.activePriorityId && p.status === "presented");
    if (active) {
      action = "probe_reaction";
      // A source detour/navigation cue does not use up a research probe.
      if (!input.isResumeCue) active.probeCount += 1;
      if (active.probeCount > 2) {
        active.status = "skipped";
        state.activePriorityId = null;
      } else {
        question = await phrase("reaction", active.label);
        content = question;
      }
    }
    if (!content) {
      const next = state.priorities.find((p) => p.id === plan.selectedPriorityId && p.status === "pending") ?? state.priorities.find((p) => p.status === "pending");
      if (next) {
        action = "present_priority";
        const answer = await source(next.sourceQuestion);
        if (answer) {
          next.status = "presented";
          next.referenceIds = references.map((r) => r.citationId);
          if (sourceEvidencePacket) next.evidencePacket = structuredClone(sourceEvidencePacket);
          state.activePriorityId = next.id;
          const acknowledgement = state.priorities.filter((p) => p.status === "pending" || p.id === next.id).map((p) => p.label).join(" and ");
          const transition = previousActive ? await phrase("transition", next.label) : `You mentioned ${acknowledgement}. Let's start with ${next.label}.`;
          question = await phrase("reaction", next.label);
          content = `${transition}\n\n${answer}\n\n${question}`;
        } else content = `I couldn't retrieve supporting evidence about ${next.label}. I've kept it on our list. Say "continue" to retry, or ask a more specific question.`;
      } else { action = "resume_guide"; state.activePriorityId = null; }
    }
  }
  return { state: moderatorStateSchema.parse(state), content, question, references, sourceUsed, creditOriginalAnswer, decision: { plan, action, selectedPriorityId: state.activePriorityId, plannerError, sourceReason } };
}
