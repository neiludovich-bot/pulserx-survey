import {
  mvpTurnRouteAnalysisResultSchema,
  type MvpTurnRouteAnalysisResult,
  type MvpTurnRouteCandidate,
  type MvpDisplayTopic as SchemaMvpDisplayTopic,
} from "@interview/schemas";
import { env } from "../env";
import { getOptionalOpenAIGateway } from "./model-gateway";
import {
  classifyMvpTurnRoute,
  type MvpDisplayTopic,
  type MvpTurnRouteDecision,
} from "./mvp-turn-router";
import type { MvpSurveySlug } from "./mvp-survey-definition";
import { interpretMvpParticipantIntent, participantOnlyRequestsInformation, participantHasInSituQuestion, participantRequestsInformation, participantExplicitlyStatesPriority, type MvpParticipantIntent, type MvpParticipantIntentInput } from "./mvp-participant-intent";

export type MvpRouteAnalysisCandidate = MvpTurnRouteCandidate;

export type MvpHybridTurnRouteInput = MvpParticipantIntentInput & {
  surveySlug: MvpSurveySlug;
  sourceBrand: string;
  activeIntentSlug?: string | null;
  activeIntentLabel?: string | null;
  activeIntentSteeringRule?: string | null;
  participantContent: string;
  currentQuestionId?: string | null;
  currentQuestion?: string | null;
  selectedQuestionId?: string | null;
  selectedQuestionText?: string | null;
  selectedQuestionSourceContext?: string | null;
  recentInterviewerContext?: string | null;
  candidateQuestions: MvpRouteAnalysisCandidate[];
};

export type MvpHybridTurnRouteDecision = MvpParticipantIntent & {
  decision: MvpTurnRouteDecision;
  provider: "deterministic" | "openai_hybrid";
  suggestedQuestionIds: string[];
  modelResult: MvpTurnRouteAnalysisResult | null;
  error: string | null;
};

function shouldAskOpenAI(
  input: MvpHybridTurnRouteInput,
  deterministic: MvpTurnRouteDecision,
) {
  if (env.MVP_TURN_ROUTER_PROVIDER !== "openai_hybrid") {
    return false;
  }

  if (input.candidateQuestions.length === 0) {
    return false;
  }

  if (deterministic.isOutOfScope || input.currentQuestionId === "intro_consent") {
    return false;
  }

  return Boolean(input.participantContent.trim());
}

function topicFromResult(
  topic: SchemaMvpDisplayTopic | null,
): MvpDisplayTopic {
  return topic;
}

function uniqueAllowedQuestionIds(
  result: MvpTurnRouteAnalysisResult,
  candidateQuestions: MvpRouteAnalysisCandidate[],
) {
  const allowedIds = new Set(candidateQuestions.map((candidate) => candidate.id));
  const seen = new Set<string>();

  return result.suggestedQuestionIds.filter((questionId) => {
    if (!allowedIds.has(questionId) || seen.has(questionId)) {
      return false;
    }
    seen.add(questionId);
    return true;
  });
}

function decisionFromModelResult(result: MvpTurnRouteAnalysisResult): MvpTurnRouteDecision {
  const needsSource = result.needsSource;

  return {
    kind: result.kind,
    topic: topicFromResult(result.topic),
    needsSource,
    isOutOfScope: result.isOutOfScope,
    isUnanticipated: result.isUnanticipated,
    rationale: result.rationale,
    sourceDirective: needsSource ? result.sourceDirective : null,
  };
}

export async function classifyMvpTurnRouteHybrid(
  input: MvpHybridTurnRouteInput,
): Promise<MvpHybridTurnRouteDecision> {
  const deterministic = classifyMvpTurnRoute({
    surveySlug: input.surveySlug,
    activeIntentSlug: input.activeIntentSlug,
    participantContent: input.participantContent,
    currentQuestion: input.currentQuestion,
    selectedQuestionId: input.selectedQuestionId,
    selectedQuestionText: input.selectedQuestionText,
    selectedQuestionSourceContext: input.selectedQuestionSourceContext,
  });
  const localIntent = interpretMvpParticipantIntent(input);
  const fallbackIntent = deterministic.isOutOfScope
    ? { answerStatus: "not_answered" as const, answerEvidence: [], asksSourceQuestion: false }
    : localIntent;

  if (!shouldAskOpenAI(input, deterministic)) {
    return {
      ...fallbackIntent,
      decision: deterministic,
      provider: "deterministic",
      suggestedQuestionIds: [],
      modelResult: null,
      error: null,
    };
  }

  const gateway = getOptionalOpenAIGateway();
  if (!gateway) {
    return {
      ...fallbackIntent,
      decision: deterministic,
      provider: "deterministic",
      suggestedQuestionIds: [],
      modelResult: null,
      error: "OpenAI gateway is not configured.",
    };
  }

  try {
    const route = await gateway.analyzeMvpTurnRoute({
      surveySlug: input.surveySlug,
      sourceBrand: input.sourceBrand,
      activeIntentSlug: input.activeIntentSlug ?? null,
      activeIntentLabel: input.activeIntentLabel ?? null,
      activeIntentSteeringRule: input.activeIntentSteeringRule ?? null,
      currentQuestionId: input.currentQuestionId ?? null,
      currentQuestion: input.currentQuestion ?? null,
      currentQuestionObjective: input.currentQuestionObjective ?? null,
      currentQuestionKeywords: input.currentQuestionKeywords ?? [],
      currentQuestionCompletionSignals: input.currentQuestionCompletionSignals ?? [],
      sourceConversationActive: input.sourceConversationActive ?? false,
      participantMessage: input.participantContent,
      recentInterviewerContext: input.recentInterviewerContext ?? null,
      candidateQuestions: input.candidateQuestions,
    });
    const result = mvpTurnRouteAnalysisResultSchema.parse(route.result);
    if (result.answerStatus !== "answered" && localIntent.answerStatus === "answered" && participantExplicitlyStatesPriority(input)) {
      throw new Error("An explicit statement of priorities must retain answer credit for the priorities question.");
    }
    if (result.answerEvidence.some((excerpt) => !input.participantContent.includes(excerpt))) {
      throw new Error("Route answer evidence must be an exact excerpt of the participant message.");
    }
    if (participantHasInSituQuestion(input.participantContent) &&
        (!result.asksSourceQuestion || result.answerEvidence.some(participantRequestsInformation))) {
      throw new Error("A trailing information question must retain its source request separately from reaction evidence.");
    }
    if (result.answerStatus !== "not_answered" && !input.currentQuestion) {
      throw new Error("Route analysis cannot credit an answer without an active research question.");
    }
    if (
      participantOnlyRequestsInformation(input.participantContent) &&
      (result.answerStatus !== "not_answered" || (input.sourceConversationActive && !result.asksSourceQuestion))
    ) {
      throw new Error("A turn containing only information requests cannot receive research-answer credit or close an active source discussion.");
    }
    if (result.topic && result.topic !== "unknown_in_domain" && !result.topic.startsWith(`${input.surveySlug}_`)) {
      throw new Error("Route analysis cannot select a source topic belonging to another survey.");
    }
    const suggestedQuestionIds = uniqueAllowedQuestionIds(
      result,
      input.candidateQuestions,
    );

    return {
      answerStatus: result.answerStatus,
      asksSourceQuestion: result.asksSourceQuestion,
      answerEvidence: result.answerEvidence,
      decision: decisionFromModelResult(result),
      provider: "openai_hybrid",
      suggestedQuestionIds,
      modelResult: result,
      error: null,
    };
  } catch (error) {
    return {
      ...fallbackIntent,
      decision: deterministic,
      provider: "deterministic",
      suggestedQuestionIds: [],
      modelResult: null,
      error:
        error instanceof Error
          ? error.message
          : "OpenAI route analysis failed.",
    };
  }
}
