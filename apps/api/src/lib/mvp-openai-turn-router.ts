import {
  mvpTurnRouteAnalysisResultSchema,
  mvpTurnRouteRepairContextSchema,
  type MvpTurnRouteAnalysisInput,
  type MvpTurnRouteAnalysisResult,
  type MvpTurnRouteCandidate,
  type ModeratorState,
  type ConversationInterpretationResult,
  type MvpDisplayTopic as SchemaMvpDisplayTopic,
} from "@interview/schemas";
import { env } from "../env";
import { sanitizeSourceFailure } from "@interview/engine";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { interpretWithWebsite } from "./single-call-conversation-service";
import type { SourceAnswerProviderResult } from "./source-answer-service";
import {
  classifyMvpTurnRoute,
  type MvpDisplayTopic,
  type MvpTurnRouteDecision,
} from "./mvp-turn-router";
import type { MvpSurveySlug } from "./mvp-survey-definition";
import { interpretMvpParticipantIntent, participantOnlyRequestsInformation, participantHasInSituQuestion, participantRequestsInformation, participantExplicitlyStatesPriority, type MvpParticipantIntent, type MvpParticipantIntentInput } from "./mvp-participant-intent";

export type MvpRouteAnalysisCandidate = MvpTurnRouteCandidate;

export type MvpHybridTurnRouteInput = MvpParticipantIntentInput & {
  conversationContext?: { state: ModeratorState; isPriorityQuestion: boolean; isResumeCue: boolean };
  understanding?: import("@interview/schemas").ParticipantUnderstanding;
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
  preparedSourceAnswer?: SourceAnswerProviderResult;
  conversationInterpretation?: ConversationInterpretationResult;
  sourceRequest?: MvpTurnRouteAnalysisResult["sourceRequest"];
  understandingUpdate?: MvpTurnRouteAnalysisResult["understandingUpdate"];
  decision: MvpTurnRouteDecision;
  provider: "deterministic" | "openai_hybrid";
  suggestedQuestionIds: string[];
  modelResult: MvpTurnRouteAnalysisResult | null;
  error: string | null;
  failureDiagnosis?: ReturnType<typeof sanitizeMvpRouteFailure>;
  modelAttempts?: number;
  modelFailures?: ReturnType<typeof sanitizeMvpRouteFailure>[];
  skipReason?: "provider_disabled" | "no_candidates" | "out_of_scope" | "consent" | "empty_message" | "gateway_unavailable";
};

const routeValidationCategories: Record<string, string> = {
  "Source requests require an exact participant excerpt.": "invalid_request_excerpt",
  "Source requests require exact current participant excerpts.": "invalid_request_excerpt",
  "Understanding updates require exact current participant excerpts.": "invalid_understanding_excerpt",
  "Understanding evidence must be an exact excerpt of the participant message.": "invalid_understanding_excerpt",
  "Route answer evidence must be an exact excerpt of the participant message.": "invalid_answer_excerpt",
  "An explicit statement of priorities must retain answer credit for the priorities question.": "lost_priority_credit",
  "A trailing information question must retain its source request separately from reaction evidence.": "lost_mixed_request",
  "Route analysis cannot credit an answer without an active research question.": "missing_active_question",
  "A turn containing only information requests cannot receive research-answer credit or close an active source discussion.": "invalid_question_credit",
  "Route analysis cannot select a source topic belonging to another survey.": "wrong_survey_topic",
};
const routeFields = new Set(["schemaVersion", "answerStatus", "asksSourceQuestion", "answerEvidence", "kind", "topic", "needsSource", "isOutOfScope", "isUnanticipated", "suggestedQuestionIds", "sourceDirective", "rationale", "sourceRequest", "participantEvidence", "resolvedQuestion", "understandingUpdate", "version", "productFamiliarity", "preferredDepth", "understanding", "candidateQuestions", "id", "question", "objective", "module", "allowedByIntent", "alreadyAsked", "routeKeywords", "sourceContextRequirement", "surveySlug", "sourceBrand", "activeIntentSlug", "activeIntentLabel", "activeIntentSteeringRule", "currentQuestionId", "currentQuestion", "currentQuestionObjective", "currentQuestionKeywords", "currentQuestionCompletionSignals", "sourceConversationActive", "participantMessage", "recentInterviewerContext"]);
for (const field of ["schemaVersion", "participantTokens", "index", "text", "participantEvidenceRange", "participantEvidenceRanges", "answerEvidenceRanges", "startToken", "endToken"]) routeFields.add(field);
export function sanitizeMvpRouteFailure(error: unknown) {
  const { stage: _stage, ...safe } = sanitizeSourceFailure(error, "composition");
  const raw = error !== null && typeof error === "object" ? error as Record<string, unknown> : {};
  const code = typeof raw.code === "string" && (raw.code === "invalid_evidence_range" || Object.values(routeValidationCategories).includes(raw.code)) ? raw.code : typeof raw.message === "string" && Object.prototype.hasOwnProperty.call(routeValidationCategories, raw.message) ? routeValidationCategories[raw.message]! : safe.code === "composition_unavailable" ? "routing_unavailable" : safe.code;
  const rawIssues = Array.isArray(raw.issues) ? raw.issues : [];
  return { ...safe, code, issues: safe.issues.map((issue, index) => {
    const item = rawIssues[index] as { path?: unknown[] } | undefined;
    return { ...issue, path: (Array.isArray(item?.path) ? item.path : []).slice(0, 6).map((part) => typeof part === "number" && Number.isInteger(part) && part >= 0 || part === "[]" ? "[]" : typeof part === "string" && routeFields.has(part) ? part : "[unknown]") };
  }) };
}

function modelSkipReason(
  input: MvpHybridTurnRouteInput,
  deterministic: MvpTurnRouteDecision,
): MvpHybridTurnRouteDecision["skipReason"] | undefined {
  if (env.MVP_TURN_ROUTER_PROVIDER !== "openai_hybrid") {
    return "provider_disabled";
  }

  if (input.candidateQuestions.length === 0) {
    return "no_candidates";
  }

  if (deterministic.isOutOfScope) return "out_of_scope";
  if (input.currentQuestionId === "intro_consent") return "consent";

  return input.participantContent.trim() ? undefined : "empty_message";
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

  const skipReason = modelSkipReason(input, deterministic);
  if (skipReason) {
    return {
      ...fallbackIntent,
      decision: deterministic,
      provider: "deterministic",
      suggestedQuestionIds: [],
      modelResult: null,
      error: null,
      skipReason,
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
      skipReason: "gateway_unavailable",
    };
  }

  const modelInput: MvpTurnRouteAnalysisInput = {
      surveySlug: input.surveySlug,
      sourceBrand: input.sourceBrand,
      understanding: input.understanding,
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
    };
  const modelFailures: ReturnType<typeof sanitizeMvpRouteFailure>[] = [];
  let repairContext: MvpTurnRouteAnalysisInput["repairContext"];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
  try {
    const callInput = { ...modelInput, ...(repairContext ? { repairContext } : {}) };
    const route = input.conversationContext?.state.runtime === "single_call_v1"
      ? await interpretWithWebsite({ ...callInput, ...input.conversationContext })
      : input.conversationContext && gateway.interpretConversation
      ? await gateway.interpretConversation({ ...callInput, ...input.conversationContext })
      : await gateway.analyzeMvpTurnRoute(callInput);
    const result = mvpTurnRouteAnalysisResultSchema.parse(route.result);
    if (result.sourceRequest && !input.participantContent.includes(result.sourceRequest.participantEvidence)) {
      throw new Error("Source requests require an exact participant excerpt.");
    }
    if (result.answerStatus !== "answered" && localIntent.answerStatus === "answered" && participantExplicitlyStatesPriority(input)) {
      throw new Error("An explicit statement of priorities must retain answer credit for the priorities question.");
    }
    if (result.answerEvidence.some((excerpt) => !input.participantContent.includes(excerpt))) {
      throw new Error("Route answer evidence must be an exact excerpt of the participant message.");
    }
    if (result.understandingUpdate?.participantEvidence.some((excerpt) => !input.participantContent.includes(excerpt))) {
      throw new Error("Understanding evidence must be an exact excerpt of the participant message.");
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
      ((result.answerStatus !== "not_answered" && input.currentQuestionId !== "familiarity_information_need") || (input.sourceConversationActive && !result.asksSourceQuestion))
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
      sourceRequest: result.sourceRequest,
      asksSourceQuestion: result.asksSourceQuestion,
      answerEvidence: result.answerEvidence,
      understandingUpdate: result.understandingUpdate ?? null,
      decision: decisionFromModelResult(result),
      provider: "openai_hybrid",
      suggestedQuestionIds,
      modelResult: result,
      error: null,
      modelAttempts: attempt,
      modelFailures,
      ...("interpretation" in route ? { conversationInterpretation: route.interpretation as ConversationInterpretationResult } : {}),
      ...("preparedSourceAnswer" in route ? { preparedSourceAnswer: route.preparedSourceAnswer as SourceAnswerProviderResult | undefined } : {}),
    };
  } catch (error) {
    const failureDiagnosis = sanitizeMvpRouteFailure(error);
    modelFailures.push(failureDiagnosis);
    const repair = mvpTurnRouteRepairContextSchema.safeParse({ version: 1, validationCategory: failureDiagnosis.code });
    // Only retry a local typed interpretation failure. Provider/access failures
    // are not corrected by asking the same provider again immediately.
    if (attempt === 1 && failureDiagnosis.status === null && repair.success) {
      repairContext = repair.data;
      continue;
    }
    return {
      failureDiagnosis,
      ...fallbackIntent,
      // A rejected model interpretation cannot establish research coverage.
      // Retain local source requests so a failure cannot strand a detour.
      answerStatus: "not_answered",
      answerEvidence: [],
      decision: deterministic,
      provider: "deterministic",
      suggestedQuestionIds: [],
      modelResult: null,
      modelAttempts: attempt,
      modelFailures,
      error:
        error instanceof Error
          ? error.message
          : "OpenAI route analysis failed.",
    };
  }
  }
  throw new Error("Route interpretation exceeded its bounded attempt limit.");
}
