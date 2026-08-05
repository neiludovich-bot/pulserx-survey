import { env } from "../env";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import { askCustomGptForSurveyInterviewerTurn } from "./customgpt-service";

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
  remainingSeconds: number;
  askedQuestions: string[];
};

export type SourceAnswerProviderResult = Awaited<
  ReturnType<typeof askCustomGptForSurveyInterviewerTurn>
> & {
  provider: "customgpt" | "controlled_rag";
  shadow?: {
    enabled: boolean;
    provider: "controlled_rag";
    referenceCount: number;
    reason: string | null;
    answerPreview: string | null;
    latencyMs: number;
  };
};

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
    };
  }

  const customGptResult = await askCustomGptForSurveyInterviewerTurn({
    projectId: input.projectId,
    conversationId: input.conversationId,
    participantMessage: input.participantMessage,
    surveyContext: input.surveyContext,
    currentQuestion: input.currentQuestion,
    selectedNextQuestion: input.selectedNextQuestion,
    selectedQuestionSourceContext: input.selectedQuestionSourceContext,
    recentInterviewerContext: input.recentInterviewerContext,
    remainingSeconds: input.remainingSeconds,
    askedQuestions: input.askedQuestions,
  });

  if (env.MVP_SOURCE_PROVIDER !== "shadow") {
    return {
      ...customGptResult,
      provider: "customgpt",
    };
  }

  const { result: shadowResult, latencyMs } = await timedControlledRag(input);

  return {
    ...customGptResult,
    provider: "customgpt",
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
