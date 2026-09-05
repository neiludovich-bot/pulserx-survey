import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  analysisSystemPrompt,
  decisionSystemPrompt,
  mvpTurnRouterSystemPrompt,
  moderatorPlannerSystemPrompt,
  moderatorPhraserSystemPrompt,
  moderatorEvidenceSelectorSystemPrompt,
  sourceQuestionPlannerSystemPrompt,
  contextualSourceCompositionSystemPrompt,
  sourceGroundingReviewSystemPrompt,
  directSourceCompositionSystemPrompt,
  phraserSystemPrompt
} from "@interview/prompts";
import {
  analysisInputSchema,
  analysisResultSchema,
  controlledRagCompositionInputSchema,
  controlledRagCompositionResultSchema,
  controlledRagCompositionModelResultSchema,
  controlledRagContextualCompositionResultSchema,
  type ControlledRagContextualCompositionResult,
  contextualSourceCompositionInputSchema,
  sourceGroundingReviewInputSchema,
  sourceGroundingReviewResultSchema,
  sourceAnswerGroundingAuditSchema,
  type SourceGroundingReviewResult,
  decisionInputSchema,
  decisionResultSchema,
  mvpTurnRouteAnalysisInputSchema,
  mvpTurnRouteAnalysisResultSchema,
  mvpTurnRouteAnalysisModelResultSchema,
  moderatorPlanInputSchema,
  moderatorPlanModelResultSchema,
  moderatorPhrasingInputSchema,
  moderatorPhrasingResultSchema,
  moderatorEvidenceSelectionInputSchema,
  moderatorEvidenceSelectionResultSchema,
  moderatorEvidenceSelectionModelResultSchema,
  moderatorContextualEvidenceSelectionModelResultSchema,
  sourceQuestionPlanInputSchema,
  sourceQuestionPlanSchema,
  type SourceQuestionPlanInput,
  type SourceQuestionPlan,
  type ModeratorPlanInput,
  type ModeratorPlanModelResult,
  type ModeratorPhrasingInput,
  type ModeratorPhrasingResult,
  type ModeratorEvidenceSelectionInput,
  type ModeratorEvidenceSelectionResult,
  openAIDebugTraceSchema,
  phrasingInputSchema,
  phrasingResultSchema,
  type AnalysisInput,
  type AnalysisResult,
  type ControlledRagCompositionInput,
  type ControlledRagCompositionResult,
  type DecisionInput,
  type DecisionResult,
  type MvpTurnRouteAnalysisInput,
  type MvpTurnRouteAnalysisResult,
  type OpenAIDebugTrace,
  type PhrasingInput,
  type PhrasingResult
} from "@interview/schemas";
import type { CompiledStudy } from "./study-compiler";
import { normalizeModeratorPlanModelResult, validateModeratorPhrasing, validateModeratorEvidenceSelection } from "./moderator-planning";
import {
  buildDecisionCandidates,
  commitSelection,
  createSessionState,
  prepareDecisionTurn,
} from "./turn-orchestrator";

type CallType =
  | "analysis"
  | "decision"
  | "phrasing"
  | "source_composition"
  | "source_grounding_review"
  | "moderator_plan"
  | "moderator_phrasing"
  | "moderator_evidence"
  | "source_question_plan"
  | "turn_route";

type ModelConfig = {
  analysisModel: string;
  decisionModel: string;
  phrasingModel: string;
  sourceModel?: string;
};

type DebugTraceStore = {
  save(trace: OpenAIDebugTrace): Promise<string | void>;
};

type ResponsesParseResult<T> = {
  id?: string | null;
  model?: string | null;
  status?: string | null;
  created_at?: number | null;
  output_text?: string;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
  output_parsed?: T;
  [key: string]: unknown;
};

type ResponsesApiLike = {
  parse(request: Record<string, unknown>): Promise<ResponsesParseResult<unknown>>;
};

type StructuredCallParams<TOutput> = {
  callType: CallType;
  model: string;
  promptVersion: string;
  schemaName: string;
  schema: unknown;
  instructions: string[];
  input: unknown;
  metadata?: Record<string, string>;
};

function toIsoDate(value?: number | null) {
  if (!value) {
    return null;
  }

  return new Date(value * 1000).toISOString();
}

function buildMessages(input: unknown) {
  return [
    {
      role: "user",
      content: [
        {
          type: "input_text",
          text: JSON.stringify(input, null, 2)
        }
      ]
    }
  ];
}

export class FileDebugTraceStore implements DebugTraceStore {
  constructor(private readonly directory: string) {}

  async save(trace: OpenAIDebugTrace) {
    await mkdir(this.directory, { recursive: true });
    const filename = `${trace.callType}-${trace.requestedAt.replace(/[:.]/g, "-")}.json`;
    const filepath = join(this.directory, filename);
    await writeFile(filepath, JSON.stringify(trace, null, 2), "utf8");
    return filepath;
  }
}

export class OpenAIResponsesGateway {
  readonly client: ResponsesApiLike;

  constructor(
    apiKey: string,
    private readonly config: ModelConfig,
    private readonly debugStore?: DebugTraceStore,
    client?: ResponsesApiLike
  ) {
    this.client =
      client ??
      (new OpenAI({
        apiKey
      }).responses as unknown as ResponsesApiLike);
  }

  async analyzeAnswer(input: AnalysisInput) {
    return this.runStructuredCall<AnalysisResult>({
      callType: "analysis",
      model: this.config.analysisModel,
      promptVersion: analysisSystemPrompt.version,
      schemaName: "analysis_result",
      schema: analysisResultSchema,
      instructions: analysisSystemPrompt.instructions,
      input: analysisInputSchema.parse(input),
      metadata: {
        session_id: input.sessionId,
        study_id: input.studyId,
        node_key: input.nodeKey
      }
    });
  }

  async decideNextQuestion(input: DecisionInput) {
    return this.runStructuredCall<DecisionResult>({
      callType: "decision",
      model: this.config.decisionModel,
      promptVersion: decisionSystemPrompt.version,
      schemaName: "decision_result",
      schema: decisionResultSchema,
      instructions: decisionSystemPrompt.instructions,
      input: decisionInputSchema.parse(input),
      metadata: {
        session_id: input.sessionId,
        study_id: input.studyId
      }
    });
  }

  async analyzeMvpTurnRoute(input: MvpTurnRouteAnalysisInput) {
    const parsed = mvpTurnRouteAnalysisInputSchema.parse(input);

    const call = await this.runStructuredCall<MvpTurnRouteAnalysisResult>({
      callType: "turn_route",
      model: this.config.analysisModel,
      promptVersion: mvpTurnRouterSystemPrompt.version,
      schemaName: "mvp_turn_route_analysis_result_v5",
      schema: mvpTurnRouteAnalysisModelResultSchema,
      instructions: mvpTurnRouterSystemPrompt.instructions,
      input: parsed,
      metadata: {
        survey_slug: parsed.surveySlug,
        intent_slug: parsed.activeIntentSlug ?? "none",
        current_question_id: parsed.currentQuestionId ?? "none"
      }
    });
    const result = mvpTurnRouteAnalysisResultSchema.parse(mvpTurnRouteAnalysisModelResultSchema.parse(call.result));
    if (result.sourceRequest && !parsed.participantMessage.includes(result.sourceRequest.participantEvidence)) {
      throw new Error("Source requests require exact current participant excerpts.");
    }
    if (result.understandingUpdate?.participantEvidence.some((excerpt) => !parsed.participantMessage.includes(excerpt))) {
      throw new Error("Understanding updates require exact current participant excerpts.");
    }
    return { ...call, result };
  }

  async phraseNextQuestion(input: PhrasingInput) {
    const phrasingInput = phrasingInputSchema.parse(input);

    return this.runStructuredCall<PhrasingResult>({
      callType: "phrasing",
      model: this.config.phrasingModel,
      promptVersion: phraserSystemPrompt.version,
      schemaName: "phrasing_result",
      schema: phrasingResultSchema,
      instructions: phraserSystemPrompt.instructions,
      input: phrasingInput,
      metadata: {
        session_id: phrasingInput.sessionId,
        question_id: phrasingInput.selectedQuestion.id
      }
    });
  }

  async composeControlledRagAnswer(input: ControlledRagCompositionInput) {
    const parsed = controlledRagCompositionInputSchema.parse(input);

    if (parsed.sourceQuestionPlan?.answerApproach === "contextual_explanation" || parsed.sources.some((source) => source.evidenceRole === "contextual")) {
      return this.composeContextualSourceAnswer(parsed);
    }

    return this.runStructuredCall<ControlledRagCompositionResult>({
      callType: "source_composition",
      model: this.config.sourceModel ?? this.config.phrasingModel,
      promptVersion: directSourceCompositionSystemPrompt.version,
      schemaName: "controlled_rag_composition_result_v2",
      schema: controlledRagCompositionModelResultSchema,
      instructions: directSourceCompositionSystemPrompt.instructions,
      input: parsed,
      metadata: {
        survey_slug: parsed.surveySlug
      }
    });
  }

  private async composeContextualSourceAnswer(input: ControlledRagCompositionInput) {
    const contextualIndexes = input.sources.filter((source) => source.evidenceRole === "contextual").map((source) => source.index);
    const attempts: Array<{ trace?: OpenAIDebugTrace; groundingTrace?: OpenAIDebugTrace; error: string | null }> = [];
    let groundingViolations: SourceGroundingReviewResult["unsupportedClaims"] = [];
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let trace: OpenAIDebugTrace | undefined;
      let groundingTrace: OpenAIDebugTrace | undefined;
      try {
        const call = await this.runStructuredCall<ControlledRagContextualCompositionResult>({
          callType: "source_composition",
          model: this.config.sourceModel ?? this.config.phrasingModel,
          promptVersion: contextualSourceCompositionSystemPrompt.version,
          schemaName: "controlled_rag_contextual_composition_result_v1",
          schema: controlledRagContextualCompositionResultSchema,
          instructions: [
            ...contextualSourceCompositionSystemPrompt.instructions,
            ...(attempt === 2 ? contextualSourceCompositionSystemPrompt.repairInstructions : []),
          ],
          input: contextualSourceCompositionInputSchema.parse({ ...input, groundingViolations }),
          metadata: { survey_slug: input.surveySlug, composition_attempt: String(attempt) },
        });
        trace = call.trace;
        const result = controlledRagContextualCompositionResultSchema.parse(call.result);
        const answerBody = [result.practicalAnswer, result.qualification].filter(Boolean).join("\n\n");
        const citations = [...answerBody.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
        const practicalCitations = [...result.practicalAnswer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
        const sourceIndexes = new Set(input.sources.map((source) => source.index));
        if (/\[[\d\s,–-]+\]/.test(answerBody.replace(/\[\d+\]/g, "")) ||
            citations.some((index) => !sourceIndexes.has(index)) ||
            new Set(result.usedSourceIndexes).size !== result.usedSourceIndexes.length ||
            result.usedSourceIndexes.some((index) => !citations.includes(index)) ||
            citations.some((index) => !result.usedSourceIndexes.includes(index))) {
          throw new Error("Contextual composition requires individual citations matching its supplied and used source indexes.");
        }
        if (contextualIndexes.length && !contextualIndexes.some((index) => practicalCitations.includes(index))) {
          throw new Error("Practical answer must cite at least one supplied contextual source.");
        }
        if (answerBody.includes("?")) throw new Error("Contextual composition cannot append a question.");
        const review = await this.runStructuredCall<SourceGroundingReviewResult>({
          callType: "source_grounding_review",
          model: this.config.sourceModel ?? this.config.phrasingModel,
          promptVersion: sourceGroundingReviewSystemPrompt.version,
          schemaName: "source_grounding_review_result_v1",
          schema: sourceGroundingReviewResultSchema,
          instructions: sourceGroundingReviewSystemPrompt.instructions,
          input: sourceGroundingReviewInputSchema.parse({
            draft: { practicalAnswer: result.practicalAnswer, qualification: result.qualification },
            sources: input.sources.map(({ index, text }) => ({ index, text })),
          }),
          metadata: { composition_attempt: String(attempt) },
        });
        groundingTrace = review.trace;
        const grounding = sourceGroundingReviewResultSchema.parse(review.result);
        if (grounding.supported !== (grounding.unsupportedClaims.length === 0) ||
            grounding.unsupportedClaims.some(({ excerpt }) => !result.practicalAnswer.includes(excerpt) && !result.qualification?.includes(excerpt))) {
          throw new Error("Grounding review requires consistent status and exact draft excerpts.");
        }
        groundingViolations = grounding.unsupportedClaims;
        if (!grounding.supported) throw new Error("Contextual composition contains unsupported claims.");
        attempts.push({ trace, groundingTrace, error: null });
        return { ...call, result: controlledRagCompositionResultSchema.parse({ answerBody, usedSourceIndexes: result.usedSourceIndexes, limitations: [] }), contextualCompositionAttempts: attempts,
          groundingReview: sourceAnswerGroundingAuditSchema.parse({ version: 1, status: "supported", attempt, model: review.trace.response.model ?? review.trace.request.model, responseId: review.trace.response.id }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Contextual composition validation failed.";
        attempts.push({ trace, groundingTrace, error: message });
        const recoverable = trace || (error instanceof Error && (error.name === "ZodError" || message.includes("returned no parsed output")));
        if (!recoverable || attempt === 2) {
          throw Object.assign(error instanceof Error ? error : new Error(message), { contextualCompositionAttempts: attempts });
        }
      }
    }
    throw new Error("Contextual composition did not produce a validated answer.");
  }

  async planSourceQuestion(input: SourceQuestionPlanInput) {
    const parsed = sourceQuestionPlanInputSchema.parse(input);
    const call = await this.runStructuredCall<SourceQuestionPlan>({
      callType: "source_question_plan",
      model: this.config.sourceModel ?? this.config.analysisModel,
      promptVersion: sourceQuestionPlannerSystemPrompt.version,
      schemaName: "source_question_plan_v1",
      schema: sourceQuestionPlanSchema,
      instructions: sourceQuestionPlannerSystemPrompt.instructions,
      input: parsed,
      metadata: { survey_slug: parsed.surveySlug },
    });
    return { ...call, result: sourceQuestionPlanSchema.parse(call.result) };
  }

  async planModeratorTurn(input: ModeratorPlanInput) {
    const parsed = moderatorPlanInputSchema.parse(input);
    const { evidencePacket: _discussionEvidence, ...discussionContext } = parsed.state.sourceDiscussion ?? {};
    const planningContext = {
      ...parsed,
      state: {
        ...parsed.state,
        ...(parsed.state.sourceDiscussion ? { sourceDiscussion: discussionContext } : {}),
        priorities: parsed.state.priorities.map(({ evidencePacket: _evidencePacket, ...priority }) => priority),
      },
    };
    const call = await this.runStructuredCall<ModeratorPlanModelResult>({
      callType: "moderator_plan",
      model: this.config.decisionModel,
      promptVersion: moderatorPlannerSystemPrompt.version,
      schemaName: "moderator_plan_result_v3",
      schema: moderatorPlanModelResultSchema,
      instructions: moderatorPlannerSystemPrompt.instructions,
      input: planningContext,
      metadata: { brand: parsed.brand },
    });
    return { ...call, result: normalizeModeratorPlanModelResult(parsed, call.result) };
  }

  async phraseModeratorTurn(input: ModeratorPhrasingInput) {
    const parsed = moderatorPhrasingInputSchema.parse(input);
    const call = await this.runStructuredCall<ModeratorPhrasingResult>({
      callType: "moderator_phrasing",
      model: this.config.phrasingModel,
      promptVersion: moderatorPhraserSystemPrompt.version,
      schemaName: "moderator_phrasing_result_v1",
      schema: moderatorPhrasingResultSchema,
      instructions: moderatorPhraserSystemPrompt.instructions,
      input: parsed,
      metadata: { brand: parsed.brand, action: parsed.action,
        ...(parsed.action === "guide_resume" ? { selected_question_id: parsed.selectedQuestion.id } : {}),
      },
    });
    return { ...call, result: validateModeratorPhrasing(parsed, call.result) };
  }

  async selectModeratorEvidence(input: ModeratorEvidenceSelectionInput) {
    const parsed = moderatorEvidenceSelectionInputSchema.parse(input);
    const call = await this.runStructuredCall<ModeratorEvidenceSelectionResult>({
      callType: "moderator_evidence",
      model: this.config.sourceModel ?? this.config.analysisModel,
      promptVersion: moderatorEvidenceSelectorSystemPrompt.version,
      schemaName: parsed.evidenceFocus === "contextual" ? "moderator_contextual_evidence_selection_result_v1" : "moderator_evidence_selection_result_v3",
      schema: parsed.evidenceFocus === "contextual" ? moderatorContextualEvidenceSelectionModelResultSchema : moderatorEvidenceSelectionModelResultSchema,
      instructions: moderatorEvidenceSelectorSystemPrompt.instructions,
      input: parsed,
      metadata: { survey_slug: parsed.surveySlug },
    });
    return { ...call, result: validateModeratorEvidenceSelection(parsed, call.result) };
  }

  private async runStructuredCall<TOutput>({
    callType,
    model,
    promptVersion,
    schemaName,
    schema,
    instructions,
    input,
    metadata
  }: StructuredCallParams<TOutput>) {
    const requestedAt = new Date().toISOString();
    const requestPayload = {
      model,
      instructions: instructions.join("\n"),
      input: buildMessages(input),
      text: {
        format: zodTextFormat(schema as never, schemaName)
      },
      metadata,
      store: true
    };

    const response = (await this.client.parse(
      requestPayload
    )) as ResponsesParseResult<TOutput>;

    if (response.output_parsed === undefined) {
      throw new Error(`OpenAI ${callType} call returned no parsed output.`);
    }

    const trace = openAIDebugTraceSchema.parse({
      callType,
      promptVersion,
      requestedAt,
      request: {
        model,
        schemaName,
        input,
        metadata: metadata ?? {}
      },
      response: {
        id: response.id ?? null,
        model: response.model ?? null,
        status: response.status ?? null,
        createdAt: toIsoDate(response.created_at),
        outputText: response.output_text ?? null,
        usage: response.usage
          ? {
              inputTokens: response.usage.input_tokens ?? null,
              outputTokens: response.usage.output_tokens ?? null,
              totalTokens: response.usage.total_tokens ?? null
            }
          : null,
        raw: response
      }
    });

    let debugPath: string | void = undefined;
    let debugError: string | null = null;
    try {
      debugPath = await this.debugStore?.save(trace);
    } catch (error) {
      // The caller persists the canonical decision. A diagnostic file write
      // must not turn a valid model response into a failed research turn.
      debugError = error instanceof Error ? error.message : "Debug trace storage failed.";
    }

    return {
      result: response.output_parsed,
      trace,
      debugPath,
      debugError,
    };
  }
}

export type ReplayOpenAIResult = {
  analysisResult: AnalysisResult;
  decisionResult: DecisionResult;
  nextQuestion: string;
  traces: {
    analysis?: string | void;
    decision?: string | void;
    phrasing?: string | void;
  };
};

export async function replaySampleAnswerWithOpenAI(params: {
  compiledStudy: CompiledStudy;
  gateway: OpenAIResponsesGateway;
  sampleAnswer: string;
}) {
  const initialPreparedTurn = prepareDecisionTurn({
    compiledStudy: params.compiledStudy,
    sessionState: createSessionState(
      params.compiledStudy,
      "session_openai_replay"
    ),
    participantTurn: undefined
  });

  if (
    !initialPreparedTurn.deterministicSelection ||
    initialPreparedTurn.deterministicSelection.action === "close"
  ) {
    throw new Error("Unable to create the initial entry selection for replay.");
  }

  const initialStateResult = commitSelection(
    initialPreparedTurn.sessionState,
    initialPreparedTurn.deterministicSelection
  );

  const currentNode =
    params.compiledStudy.nodeById.get(initialStateResult.sessionState.currentNodeId ?? "") ??
    null;

  if (!currentNode) {
    throw new Error("Unable to resolve the entry node for replay.");
  }

  const analysisCall = await params.gateway.analyzeAnswer({
    sessionId: initialStateResult.sessionState.sessionId,
    studyId: params.compiledStudy.study.id,
    nodeId: currentNode.id,
    nodeKey: currentNode.key,
    nodeTitle: currentNode.title,
    questionPrompt: currentNode.prompt,
    expectedFactKeys: currentNode.config.factKeys,
    sessionState: {
      facts: initialStateResult.sessionState.facts,
      history: initialStateResult.sessionState.history
    },
    participantAnswer: params.sampleAnswer
  });

  const preparedTurn = prepareDecisionTurn({
    compiledStudy: params.compiledStudy,
    sessionState: initialStateResult.sessionState,
    participantTurn: {
      content: params.sampleAnswer,
      extractedFacts: analysisCall.result.extractedFacts,
      offTopic: analysisCall.result.offTopic,
      answerQuality: analysisCall.result.answerQuality,
      shouldAdvance: analysisCall.result.shouldAdvance
    }
  });

  if (
    preparedTurn.deterministicSelection?.action === "close" ||
    preparedTurn.candidateNodeIds.length === 0
  ) {
    throw new Error("Replay did not produce a next-question candidate.");
  }

  const decisionCandidateIds = preparedTurn.deterministicSelection?.selectedNodeId
    ? [preparedTurn.deterministicSelection.selectedNodeId]
    : preparedTurn.candidateNodeIds;

  const decisionCandidates = buildDecisionCandidates(
    params.compiledStudy,
    decisionCandidateIds
  );

  const decisionCall = await params.gateway.decideNextQuestion({
    sessionId: preparedTurn.sessionState.sessionId,
    studyId: preparedTurn.sessionState.studyId,
    currentNodeId: preparedTurn.sessionState.currentNodeId,
    currentNodeKey: preparedTurn.sessionState.currentNodeKey,
    sessionState: preparedTurn.sessionState,
    analysis: analysisCall.result,
    allowedCandidates: decisionCandidates
  });

  const selectedNode =
    params.compiledStudy.nodeById.get(decisionCall.result.selectedNodeId) ?? null;
  if (!selectedNode) {
    throw new Error(
      `Decision model selected unknown node ${decisionCall.result.selectedNodeId}.`
    );
  }

  if (!decisionCandidateIds.includes(selectedNode.id)) {
    throw new Error(
      `Decision model selected disallowed node ${decisionCall.result.selectedNodeId}.`
    );
  }

  const phrasingCall = await params.gateway.phraseNextQuestion({
    sessionId: preparedTurn.sessionState.sessionId,
    selectedQuestion: {
      id: selectedNode.id,
      kind: selectedNode.isTerminal ? "close" : "primary",
      objective: selectedNode.title,
      promptSeed: selectedNode.prompt,
      tags: selectedNode.config.factKeys
    },
    participantContext: {
      tone: "warm",
      lastAnswerSummary: analysisCall.result.summary
    },
    deliveryContext: {
      interactionType: "ask",
      answerQuality: analysisCall.result.answerQuality,
      groundedReferences: [],
      missingTopics: []
    }
  });

  return {
    analysisResult: analysisCall.result,
    decisionResult: decisionCall.result,
    nextQuestion: phrasingCall.result.utterance,
    traces: {
      analysis: analysisCall.debugPath,
      decision: decisionCall.debugPath,
      phrasing: phrasingCall.debugPath
    }
  } satisfies ReplayOpenAIResult;
}
