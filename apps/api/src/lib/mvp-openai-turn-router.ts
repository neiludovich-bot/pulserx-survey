import type {
  MvpDisplayTopic as SchemaMvpDisplayTopic,
  MvpTurnRouteAnalysisResult,
  MvpTurnRouteCandidate,
} from "@interview/schemas";
import { env } from "../env";
import { getOptionalOpenAIGateway } from "./model-gateway";
import {
  classifyMvpTurnRoute,
  type MvpDisplayTopic,
  type MvpTurnRouteDecision,
} from "./mvp-turn-router";
import type { MvpSurveySlug } from "./mvp-survey-definition";

export type MvpRouteAnalysisCandidate = MvpTurnRouteCandidate;

export type MvpHybridTurnRouteInput = {
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

export type MvpHybridTurnRouteDecision = {
  decision: MvpTurnRouteDecision;
  provider: "deterministic" | "openai_hybrid";
  suggestedQuestionIds: string[];
  modelResult: MvpTurnRouteAnalysisResult | null;
  error: string | null;
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/+-]+/g, " ")
    .trim();
}

function contentLooksClinicallyMeaningful(value: string) {
  const normalized = normalizeText(value);

  return /\b(?:adverse|benefit|candidate|caution|cautious|clinical|complete response|cr|data|dose|efficacy|eligible|ev 302|ev302|guideline|inclusion|exclusion|keynote|management|monitor|neuropathy|orr|patient|pfs|population|rash|resource|safety|side effect|study|toxicity|trial)\b/.test(
    normalized,
  );
}

function contentLooksTooSimpleForModel(value: string) {
  const normalized = normalizeText(value);

  return (
    normalized.length < 24 &&
    /^(?:yes|yeah|yep|no|nope|ok|okay|sure|agree|disagree|none|not sure|maybe)$/.test(
      normalized,
    )
  );
}

function shouldAskOpenAI(
  input: MvpHybridTurnRouteInput,
  deterministic: MvpTurnRouteDecision,
) {
  if (env.MVP_TURN_ROUTER_PROVIDER !== "openai_hybrid") {
    return false;
  }

  if (process.env.NODE_ENV === "test") {
    return false;
  }

  if (input.candidateQuestions.length === 0) {
    return false;
  }

  if (deterministic.isOutOfScope || input.currentQuestionId === "intro_consent") {
    return false;
  }

  if (contentLooksTooSimpleForModel(input.participantContent)) {
    return false;
  }

  return (
    deterministic.kind === "unknown_in_domain" ||
    deterministic.kind === "source_question" ||
    deterministic.isUnanticipated ||
    contentLooksClinicallyMeaningful(input.participantContent)
  );
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

function decisionFromModelResult(
  deterministic: MvpTurnRouteDecision,
  result: MvpTurnRouteAnalysisResult,
): MvpTurnRouteDecision {
  const needsSource = deterministic.needsSource || result.needsSource;
  const sourceDirective =
    result.sourceDirective ?? deterministic.sourceDirective ?? null;

  return {
    kind: result.kind,
    topic: topicFromResult(result.topic),
    needsSource,
    isOutOfScope: result.isOutOfScope,
    isUnanticipated: result.isUnanticipated,
    rationale: result.rationale,
    sourceDirective: needsSource ? sourceDirective : null,
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

  if (!shouldAskOpenAI(input, deterministic)) {
    return {
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
      participantMessage: input.participantContent,
      recentInterviewerContext: input.recentInterviewerContext ?? null,
      candidateQuestions: input.candidateQuestions,
    });
    const suggestedQuestionIds = uniqueAllowedQuestionIds(
      route.result,
      input.candidateQuestions,
    );

    return {
      decision: decisionFromModelResult(deterministic, route.result),
      provider: "openai_hybrid",
      suggestedQuestionIds,
      modelResult: route.result,
      error: null,
    };
  } catch (error) {
    return {
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
