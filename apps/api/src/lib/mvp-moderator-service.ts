import { randomUUID } from "node:crypto";
import { moderatorPlanRepairContextSchema, type ModeratorPlanRepairContext } from "@interview/schemas";
import { moderatorReactionEvidenceOutsideRequest } from "@interview/engine";
import { moderatorPlanInputSchema, moderatorPlanResultSchema, moderatorStateSchema, type ModeratorState, type ModeratorPlanInput, type ModeratorPlanResult, type ModeratorEvidencePacket, type GroundedReference, type SourceQuestionPlan, type SourceAnswerGroundingAudit } from "@interview/schemas";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { askSourceProviderForSurveyInterviewerTurn } from "./source-answer-service";
import { isReferentialClarification } from "./controlled-rag-service";
import { beginSourceDiscussion, completeSourceDiscussion, failSourceDiscussion, isSourceRetryCue, sourceRequestForTurn, sourceDiscussionFailure, sourceDiscussionContextForTurn, sourceFailureParticipantMessage, withSourceNavigationHint } from "./mvp-source-discussion";
import { presentationFor } from "./mvp-presentation";
import { sanitizeModeratorPlanningFailure } from "./synthetic-moderator-diagnostics";
import { prioritySourceLabel, prioritySourceQuestion } from "./mvp-priority-source-scope";

export const emptyModeratorState = (): ModeratorState => moderatorStateSchema.parse({ version: 1, priorities: [], activePriorityId: null });
type Input = ModeratorPlanInput & { surveySlug: "nubeqa" | "brukinsa" | "padcev"; projectId?: string | null; surveyContext: string };
const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function runModeratorTurn(input: Input) {
  if (input.sourceRequest !== undefined) input = { ...input, asksSourceQuestion: Boolean(input.sourceRequest) };
  const gateway = getOptionalOpenAIGateway();
  const state = moderatorStateSchema.parse(structuredClone(input.state));
  const hadOpenPriorities = state.priorities.some((p) => p.status === "pending" || p.status === "presented");
  if (!state.priorities.length && !gateway) return null;
  const planningInput = moderatorPlanInputSchema.parse({ brand: input.brand, currentQuestion: input.currentQuestion, participantMessage: input.participantMessage, recentTurns: input.recentTurns, state, isPriorityQuestion: input.isPriorityQuestion, asksSourceQuestion: input.asksSourceQuestion, sourceRequest: input.sourceRequest, answerStatus: input.answerStatus, isResumeCue: input.isResumeCue });
  let plan: ModeratorPlanResult | null = null;
  let plannerError: string | null = null;
  let plannerAttempts = 0;
  const plannerErrors: string[] = [];
  const plannerFailures: ReturnType<typeof sanitizeModeratorPlanningFailure>[] = [];
  let repairContext: ModeratorPlanRepairContext | undefined;
  // Retry the typed planning boundary once before mutating state or calling
  // the source/phrasing providers. Invalid output must not consume a probe.
  while (gateway && plannerAttempts < 2 && plan === null) {
    plannerAttempts += 1;
    try {
      const candidate = moderatorPlanResultSchema.parse((await gateway.planModeratorTurn({ ...planningInput, ...(repairContext ? { repairContext } : {}) })).result);
      if (candidate.sourceRequest && !input.participantMessage.includes(candidate.sourceRequest.participantEvidence)) throw new Error("Source request evidence must be an exact participant excerpt.");
      if (candidate.newPriorities.some((p) => !input.participantMessage.includes(p.participantEvidence)) || candidate.reactionEvidence.some((e) => !input.participantMessage.includes(e))) throw new Error("Moderator evidence must be an exact participant excerpt.");
      plan = candidate;
    } catch (error) {
      const repair = moderatorPlanRepairContextSchema.safeParse(error && typeof error === "object" && "repairContext" in error ? error.repairContext : undefined);
      repairContext = repair.success ? repair.data : undefined;
      plannerFailures.push(sanitizeModeratorPlanningFailure(error));
      plannerErrors.push(error instanceof Error ? error.message : "Moderator planning failed.");
    }
  }
  const plannerRecovered = plan !== null && plannerAttempts > 1;
  if (plan === null) {
    plannerError = plannerErrors.at(-1) ?? "Moderator model unavailable.";
    // Preserve explicit lists during an API outage. This does not infer medical
    // meaning or manufacture research answers from a navigation message.
    const labels = input.isPriorityQuestion && input.answerStatus !== "not_answered" && !input.asksSourceQuestion
      ? input.participantMessage.split(/\s*(?:,|;|\band\b|&)\s*/i).filter(Boolean).slice(0, 16) : [];
    plan = { newPriorities: labels.map((label) => ({ label: label.slice(0, 200), participantEvidence: label, sourceQuestion: `What approved evidence about ${label} is available for ${input.brand}?` })), reactionStatus: "not_answered", reactionEvidence: [], action: "probe_reaction", selectedPriorityId: null, rationale: "Retain pending topics and ask for clarification while model planning is unavailable." };
  }
  const previousActive = state.priorities.find((p) => p.id === state.activePriorityId);
  const retryRequested = Boolean(state.sourceDiscussion && isSourceRetryCue(input.participantMessage));
  const sourceRequested = plan.sourceRequest !== undefined ? Boolean(plan.sourceRequest) : input.asksSourceQuestion || plan.action === "answer_source";
  const requestForReaction = plan.sourceRequest ?? input.sourceRequest;
  const legacySourceOnlyTurn = sourceRequested && !requestForReaction && input.answerStatus === "not_answered";
  const reactionEvidence = previousActive?.status === "presented" && !retryRequested && !input.isResumeCue && !legacySourceOnlyTurn
    ? moderatorReactionEvidenceOutsideRequest(input.participantMessage, plan.reactionEvidence, requestForReaction) : [];
  plan = { ...plan, reactionEvidence, reactionStatus: reactionEvidence.length ? plan.reactionStatus : "not_answered" };
  if (plan.newPriorities.length === 0 && ((!hadOpenPriorities && !state.sourceDiscussion) || state.priorities.length === 0)) {
    if (!plan.sourceRequest) return null;
    // The legacy guide orchestrator owns the exact return target outside a
    // priority agenda. Return the recovered request instead of losing it or
    // manufacturing an agenda entry solely to answer a participant question.
    return { state, content: null, question: null, references: [] as GroundedReference[], sourceUsed: false, creditOriginalAnswer: false,
      recoveredSourceRequest: plan.sourceRequest, decision: { plan, action: "answer_source", selectedPriorityId: null, plannerError, plannerAttempts, plannerErrors, plannerFailures, plannerRecovered } };
  }
  for (const priority of plan.newPriorities) {
    if (state.priorities.length >= 64) break;
    const label = prioritySourceLabel(priority);
    if (!state.priorities.some((p) => normalized(p.label) === normalized(label))) {
      state.priorities.push({ ...priority, label, sourceQuestion: prioritySourceQuestion(priority, input.brand), id: randomUUID(), status: "pending", reactionEvidence: [], referenceIds: [], probeCount: 0 });
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
    else if (!input.isResumeCue && !retryRequested && plan.reactionStatus !== "not_answered") {
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
  const sourcePlanning: { plan: SourceQuestionPlan | null; grounding: SourceAnswerGroundingAudit | null; outcome?: import("@interview/schemas").SourceTurnOutcome } = { plan: null, grounding: null };
  const creditOriginalAnswer = !previousActive && input.answerStatus === "answered" && plan.newPriorities.length > 0;
  const phrase = async (kind: "reaction" | "transition", label: string) => {
    const targetPriority = state.priorities.find((priority) => priority.id === state.activePriorityId);
    const probeIntent = targetPriority?.probeCount ? "clarification" as const : state.understanding?.productFamiliarity === "low" ? "first_impression" as const : "implication" as const;
    try {
      if (!gateway) throw new Error("No phrasing model");
      const text = (await gateway.phraseModeratorTurn({ brand: input.brand, action: kind, priorityLabel: label, participantMessage: input.participantMessage, previousPriorityLabel: previousActive?.label ?? null,
        understanding: state.understanding, presentationPlan: presentationFor(state, "reaction_setup"), selectedObjective: kind === "transition" ? `Introduce the next selected priority: ${label}.` : targetPriority?.probeCount ? `Clarify the participant's reaction to the evidence presented for ${label}.` : `Capture the participant's initial reaction to the evidence just presented for ${label}.`,
        evidenceSummary: (sourceEvidencePacket ?? targetPriority?.evidencePacket)?.sources.map((source) => source.text).join("\n").slice(0, 6000),
        reactionEvidence: targetPriority?.reactionEvidence.slice(-16) ?? [],
        recentQuestionTexts: input.recentTurns.filter((turn) => turn.role === "interviewer").flatMap((turn) => turn.content.split(/\n+/).filter((line) => line.includes("?"))).slice(-8).map((line) => line.slice(0, 1000)),
        probeIntent,
      })).result.text;
      if (kind === "reaction" && (text.match(/\?/g)?.length !== 1)) throw new Error("A reaction prompt must contain one question.");
      return text;
    } catch {
      return kind === "reaction" ? probeIntent === "first_impression" ? `What is your initial reaction to this information about ${label}?` : `How does this information about ${label} affect your assessment of ${input.brand}?` : `You also mentioned ${label}. Let's look at that next.`;
    }
  };
  const source = async (query: string, sourceTopicContext: string | null = null, evidencePacket?: ModeratorEvidencePacket) => {
    sourceUsed = true;
    try {
      const answer = await askSourceProviderForSurveyInterviewerTurn({ surveySlug: input.surveySlug, projectId: input.projectId, participantMessage: query, sourceTopicContext, evidencePacket, presentationPlan: presentationFor(state, "source_answer"), surveyContext: input.surveyContext, currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, recentTurns: input.recentTurns.slice(-12), recentInterviewerContext: input.recentTurns.slice(-12).map((t) => `${t.role}: ${t.content}`).join("\n"), remainingSeconds: 600, askedQuestions: [], responseMode: "answer_only" });
      sourcePlanning.plan = answer.sourceQuestionPlan ?? null;
      sourcePlanning.grounding = answer.sourceAnswerGrounding ?? null;
      sourcePlanning.outcome = answer.sourceOutcome;
      if (!answer.enabled || !answer.answer || !answer.references.length) { sourceReason = answer.reason ?? "No supporting evidence returned."; return null; }
      references = answer.references;
      sourceEvidencePacket = answer.evidencePacket ?? undefined;
      return answer.answer;
    } catch (error) { sourceReason = error instanceof Error ? error.message : "Evidence unavailable."; return null; }
  };
  const retryPendingPresentation = retryRequested && state.priorities.some((p) => p.id === state.sourceDiscussion?.returnTarget?.id && p.status === "pending");
  if ((sourceRequested || retryRequested) && !input.isResumeCue && !retryPendingPresentation) {
    action = "answer_source";
    const discussion = state.sourceDiscussion;
    const discussionContext = sourceDiscussionContextForTurn(discussion, isReferentialClarification(input.participantMessage));
    const sourceTopic = discussionContext.sourceTopicContext ?? (previousActive ? prioritySourceQuestion(previousActive, input.brand) : null);
    const retainedPacket = discussion ? discussionContext.evidencePacket : previousActive?.evidencePacket;
    const request = sourceRequestForTurn(state, input.participantMessage);
    if (!discussion && sourceTopic) state.sourceDiscussion = { query: sourceTopic, ...(retainedPacket ? { evidencePacket: structuredClone(retainedPacket) } : {}) };
    beginSourceDiscussion(state, request, previousActive ? { kind: "priority", id: previousActive.id } : null, discussionContext.pendingQuestion);
    if (retainedPacket && !state.sourceDiscussion!.evidencePacket) state.sourceDiscussion!.evidencePacket = structuredClone(retainedPacket);
    const answer = await source(request, sourceTopic, retainedPacket);
    if (answer) {
      completeSourceDiscussion(state, discussionContext.pendingQuestion ?? (isReferentialClarification(request) && sourceTopic ? sourceTopic : request), sourceEvidencePacket);
    } else failSourceDiscussion(state, sourceDiscussionFailure(sourcePlanning.outcome, sourceReason ?? "Source answer unavailable."));
    content = withSourceNavigationHint(state, answer ?? sourceFailureParticipantMessage(sourcePlanning.outcome));
  } else {
    const pendingPresentation = state.sourceDiscussion?.returnTarget?.kind === "priority" && state.priorities.some((p) => p.id === state.sourceDiscussion?.returnTarget?.id && p.status === "pending");
    if (!pendingPresentation) delete state.sourceDiscussion;
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
        next.label = prioritySourceLabel(next);
        next.sourceQuestion = prioritySourceQuestion(next, input.brand);
        beginSourceDiscussion(state, next.sourceQuestion, { kind: "priority", id: next.id });
        const answer = await source(next.sourceQuestion);
        if (answer) {
          delete state.sourceDiscussion;
          next.status = "presented";
          next.referenceIds = references.map((r) => r.citationId);
          if (sourceEvidencePacket) next.evidencePacket = structuredClone(sourceEvidencePacket);
          state.activePriorityId = next.id;
          const acknowledgement = state.priorities.filter((p) => p.status === "pending" || p.id === next.id).map((p) => p.label).join(" and ");
          const transition = previousActive ? await phrase("transition", next.label) : `You mentioned ${acknowledgement}. Let's start with ${next.label}.`;
          question = await phrase("reaction", next.label);
          content = `${transition}\n\n${answer}\n\n${question}`;
        } else {
          failSourceDiscussion(state, sourceDiscussionFailure(sourcePlanning.outcome, sourceReason ?? "Priority evidence unavailable."));
          content = withSourceNavigationHint(state, `I couldn't retrieve supporting evidence about ${next.label}. I've kept it on our list.`);
        }
      } else { action = "resume_guide"; state.activePriorityId = null; }
    }
  }
  return { state: moderatorStateSchema.parse(state), content, question, references, sourceUsed, creditOriginalAnswer, recoveredSourceRequest: null, decision: { plan, action, selectedPriorityId: state.activePriorityId, plannerError, plannerAttempts, plannerErrors, plannerFailures, plannerRecovered, sourceReason, sourceQuestionPlan: sourcePlanning.plan, sourceAnswerGrounding: sourcePlanning.grounding, sourceOutcome: sourcePlanning.outcome ?? null } };
}
