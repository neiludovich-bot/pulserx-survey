import { env } from "../env";
import type { GroundedReference, ModeratorEvidencePacket } from "@interview/schemas";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import { askCustomGptForSurveyInterviewerTurn } from "./customgpt-service";
import type { CustomGptReference } from "./customgpt-service";
import { withExplicitSourceAssets } from "./focused-source-evidence";

export type SourceAnswerProviderInput = {
  surveySlug: "brukinsa" | "padcev" | "nubeqa";
  projectId?: string | null;
  conversationId?: string | null;
  participantMessage: string;
  surveyContext: string;
  currentQuestion: string | null;
  selectedNextQuestion: string | null;
  selectedQuestionSourceContext: string | null;
  recentInterviewerContext?: string | null;
  sourceTopicContext?: string | null;
  evidencePacket?: ModeratorEvidencePacket | null;
  remainingSeconds: number;
  askedQuestions: string[];
  responseMode?: "answer_only" | "answer_then_ask";
};

export type SourceAnswerProviderResult = {
  provider: "customgpt" | "controlled_rag";
  enabled: boolean;
  answer: string | null;
  references: GroundedReference[];
  citationIds: string[];
  conversationId: string | null;
  reason: string | null;
  evidencePacket?: ModeratorEvidencePacket | null;
  shadow?: {
    enabled: boolean;
    provider: "controlled_rag";
    referenceCount: number;
    reason: string | null;
    answerPreview: string | null;
    latencyMs: number;
  };
};

function groundedReferences(
  references: Array<CustomGptReference | GroundedReference>,
): GroundedReference[] {
  return references.map((reference, index) => withExplicitSourceAssets({
    citationId: reference.citationId || `source:${index + 1}`,
    title: reference.title ?? null,
    url: reference.url ?? null,
    description: reference.description ?? null,
    assets:
      "assets" in reference
        ? (reference.assets ?? []).map((asset) => ({
            title: asset.title,
            url: asset.url,
            description: asset.description ?? null,
            assetKind: asset.assetKind,
            tags: asset.tags ?? [],
            priority: asset.priority ?? 0,
          }))
        : [],
  }));
}

function preview(value: string | null) {
  if (!value) {
    return null;
  }

  return value.length <= 280 ? value : `${value.slice(0, 260).trimEnd()}...`;
}

async function timedControlledRag(input: SourceAnswerProviderInput) {
  const startedAt = Date.now();
  const result = await askControlledRagForSurveyInterviewerTurn({
    surveySlug: input.surveySlug,
    participantMessage: input.participantMessage,
    surveyContext: input.surveyContext,
    currentQuestion: input.currentQuestion,
    selectedNextQuestion: input.selectedNextQuestion,
    selectedQuestionSourceContext: input.selectedQuestionSourceContext,
    recentInterviewerContext: input.recentInterviewerContext,
    sourceTopicContext: input.sourceTopicContext,
    evidencePacket: input.evidencePacket,
    responseMode: input.responseMode,
  });

  return {
    result,
    latencyMs: Date.now() - startedAt,
  };
}

export async function askSourceProviderForSurveyInterviewerTurn(
  input: SourceAnswerProviderInput,
): Promise<SourceAnswerProviderResult> {
  if (env.MVP_SOURCE_PROVIDER === "controlled_rag") {
    const { result } = await timedControlledRag(input);
    return {
      ...result,
      provider: "controlled_rag",
      references: groundedReferences(result.references),
    };
  }

  const customGptResult = await askCustomGptForSurveyInterviewerTurn({
    projectId: input.projectId,
    conversationId: input.conversationId,
    participantMessage: input.participantMessage,
    surveyContext: [
      input.sourceTopicContext ? `Current source topic for referential follow-ups: ${input.sourceTopicContext}. Use this to interpret that/this/it; an explicit new participant question takes precedence.` : null,
      input.surveyContext,
    ].filter(Boolean).join("\n"),
    currentQuestion: input.currentQuestion,
    selectedNextQuestion: input.selectedNextQuestion,
    selectedQuestionSourceContext: input.selectedQuestionSourceContext,
    recentInterviewerContext: input.recentInterviewerContext,
    remainingSeconds: input.remainingSeconds,
    askedQuestions: input.askedQuestions,
    responseMode: input.responseMode,
  });

  if (env.MVP_SOURCE_PROVIDER !== "shadow") {
    return {
      ...customGptResult,
      provider: "customgpt",
      references: groundedReferences(customGptResult.references),
    };
  }

  const { result: shadowResult, latencyMs } = await timedControlledRag(input);

  return {
    ...customGptResult,
    provider: "customgpt",
    references: groundedReferences(customGptResult.references),
    shadow: {
      enabled: shadowResult.enabled,
      provider: "controlled_rag",
      referenceCount: shadowResult.references.length,
      reason: shadowResult.reason,
      answerPreview: preview(shadowResult.answer),
      latencyMs,
    },
  };
}
