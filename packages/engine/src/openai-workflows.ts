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
  mvpTurnRouteAnalysisIndexedInputSchema,
  mvpTurnRouteAnalysisIndexedModelResultSchema,
  type MvpTurnRouteAnalysisIndexedModelResult,
  moderatorPlanInputSchema,
  moderatorPlanTokenModelResultSchema,
  moderatorPlanTokenInputSchema,
  type ModeratorPlanTokenModelResult,
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
  type OpenAIDebugTrace,
  type PhrasingInput,
  type PhrasingResult
} from "@interview/schemas";
import type { CompiledStudy } from "./study-compiler";
import { participantTokensForModel, evidenceFromTokenRange } from "./evidence-ranges";
import { validateModeratorPhrasing, validateModeratorEvidenceSelection } from "./moderator-planning";
import { normalizeModeratorPlanTokenResult } from "./moderator-evidence-ranges";
import { sanitizeSourceFailure, type SourceFailureMetadata } from "./source-failure";
import { getModelCallTimingContext } from "./model-call-timing-context";
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
  reasoningEffort?: "none" | "low" | "medium" | "high";
  groundingReasoningEffort?: "none" | "low" | "medium" | "high";
  interpretationReasoningEffort?: "none" | "low" | "medium" | "high";
  moderatorReasoningEffort?: "none" | "low" | "medium" | "high";
  compositionReasoningEffort?: "none" | "low" | "medium" | "high";
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
    input_tokens_details?: { cached_tokens?: number | null } | null;
    output_tokens_details?: { reasoning_tokens?: number | null } | null;
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

function logModelCallTiming(input: {
  callType: CallType; model: string; schemaName: string; metadata?: Record<string, string>;
  elapsedMs: number; reasoningEffort?: string; response?: ResponsesParseResult<unknown>;
}) {
  const counter = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const candidateSlug = input.metadata?.survey_slug ?? input.metadata?.brand?.toLowerCase();
  const usage = input.response?.usage;
  try {
    console.info(JSON.stringify({ event: "model_call_timing", callType: input.callType, model: input.model,
      callGroupId: getModelCallTimingContext()?.callGroupId ?? null,
      schemaName: input.schemaName, survey_slug: candidateSlug && ["nubeqa", "brukinsa", "padcev"].includes(candidateSlug) ? candidateSlug : null,
      status: input.response?.output_parsed === undefined ? "failure" : "success", elapsedMs: input.elapsedMs,
      reasoningEffort: input.reasoningEffort ?? null, inputTokens: counter(usage?.input_tokens),
      outputTokens: counter(usage?.output_tokens), reasoningTokens: counter(usage?.output_tokens_details?.reasoning_tokens),
      cachedInputTokens: counter(usage?.input_tokens_details?.cached_tokens),
    }));
  } catch { /* Diagnostics must never change a model call's outcome. */ }
}

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

    const call = await this.runStructuredCall<MvpTurnRouteAnalysisIndexedModelResult>({
      callType: "turn_route",
      model: this.config.analysisModel,
      promptVersion: mvpTurnRouterSystemPrompt.version,
      schemaName: "mvp_turn_route_analysis_result_v6",
      schema: mvpTurnRouteAnalysisIndexedModelResultSchema,
      instructions: mvpTurnRouterSystemPrompt.instructions,
      input: mvpTurnRouteAnalysisIndexedInputSchema.parse({ ...parsed, participantTokens: participantTokensForModel(parsed.participantMessage) }),
      metadata: {
        survey_slug: parsed.surveySlug,
        intent_slug: parsed.activeIntentSlug ?? "none",
        current_question_id: parsed.currentQuestionId ?? "none"
      }
    });
    const { answerEvidenceRanges, sourceRequest, understandingUpdate, ...wire } = mvpTurnRouteAnalysisIndexedModelResultSchema.parse(call.result);
    const result = mvpTurnRouteAnalysisResultSchema.parse({ ...wire, schemaVersion: 5,
      answerEvidence: answerEvidenceRanges.map((range) => evidenceFromTokenRange(parsed.participantMessage, range)),
      sourceRequest: sourceRequest ? { kind: sourceRequest.kind, resolvedQuestion: sourceRequest.resolvedQuestion, participantEvidence: evidenceFromTokenRange(parsed.participantMessage, sourceRequest.participantEvidenceRange) } : null,
      understandingUpdate: understandingUpdate ? { version: understandingUpdate.version, productFamiliarity: understandingUpdate.productFamiliarity, preferredDepth: understandingUpdate.preferredDepth, participantEvidence: understandingUpdate.participantEvidenceRanges.map((range) => evidenceFromTokenRange(parsed.participantMessage, range)) } : null,
    });
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
    const contextual = parsed.sourceQuestionPlan?.answerApproach === "contextual_explanation" || parsed.sources.some((source) => source.evidenceRole === "contextual");
    return this.composeGroundedSourceAnswer(parsed, contextual);
  }

  private async composeGroundedSourceAnswer(input: ControlledRagCompositionInput, contextual: boolean) {
    const prompt = contextual ? contextualSourceCompositionSystemPrompt : directSourceCompositionSystemPrompt;
    const attempts: Array<{ trace?: OpenAIDebugTrace; groundingTrace?: OpenAIDebugTrace; error: string | null; failure?: SourceFailureMetadata }> = [];
    let groundingViolations: SourceGroundingReviewResult["unsupportedClaims"] = [];
    let previousDraft: Pick<ControlledRagContextualCompositionResult, "practicalAnswer" | "qualification"> | undefined;
    let compositionFailures = 0;
    let groundingReviews = 0;
    // A formatting correction must not consume the first grounded draft's repair.
    // Each stage gets at most one repair, with three drafts and two reviews total.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let trace: OpenAIDebugTrace | undefined;
      let groundingTrace: OpenAIDebugTrace | undefined;
      let failureStage: SourceFailureMetadata["stage"] = "composition";
      try {
        const call = await this.runStructuredCall<ControlledRagContextualCompositionResult | ControlledRagCompositionResult>({
          callType: "source_composition",
          model: this.config.sourceModel ?? this.config.phrasingModel,
          promptVersion: prompt.version,
          schemaName: contextual ? "controlled_rag_contextual_composition_result_v1" : "controlled_rag_composition_result_v2",
          schema: contextual ? controlledRagContextualCompositionResultSchema : controlledRagCompositionModelResultSchema,
          instructions: [
            ...prompt.instructions,
            ...(attempt > 1 ? prompt.repairInstructions : []),
          ],
          input: contextualSourceCompositionInputSchema.parse({ ...input, groundingViolations, ...(previousDraft ? { previousDraft } : {}) }),
          metadata: { survey_slug: input.surveySlug, composition_attempt: String(attempt) },
        });
        trace = call.trace;
        const directResult = contextual ? null : controlledRagCompositionResultSchema.parse(call.result);
        const result = directResult ? {
          practicalAnswer: directResult.answerBody,
          qualification: directResult.limitations.length ? directResult.limitations.join("\n") : null,
          usedSourceIndexes: directResult.usedSourceIndexes,
        } : controlledRagContextualCompositionResultSchema.parse(call.result);
        // The next call edits this actual draft; it remains separate from source evidence.
        previousDraft = { practicalAnswer: result.practicalAnswer, qualification: result.qualification };
        const reviewedText = [result.practicalAnswer, result.qualification].filter(Boolean).join("\n\n");
        const answerBody = directResult ? directResult.answerBody : reviewedText;
        const maxWords = input.presentationPlan?.maxWords;
        const wordCount = reviewedText.replace(/\[\d+\]/g, " ").trim().split(/\s+/).filter(Boolean).length;
        if (maxWords !== undefined && wordCount > maxWords) {
          throw Object.assign(new Error("Source composition exceeded the requested word budget."), { code: "word_budget_exceeded" });
        }
        const citations = [...reviewedText.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
        const practicalCitations = [...result.practicalAnswer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
        const sourceIndexes = new Set(input.sources.map((source) => source.index));
        if (!practicalCitations.length || /\[[\d\s,–-]+\]/.test(reviewedText.replace(/\[\d+\]/g, "")) ||
            citations.some((index) => !sourceIndexes.has(index)) ||
            new Set(result.usedSourceIndexes).size !== result.usedSourceIndexes.length ||
            result.usedSourceIndexes.some((index) => !citations.includes(index)) ||
            citations.some((index) => !result.usedSourceIndexes.includes(index))) {
          throw new Error("Source composition requires individual citations matching its supplied and used source indexes.");
        }
        // Requested context is an explicit selected information need, unlike an
        // optional contextual source or essential qualification. Keep it in the
        // substantive answer, not only in a limitations/caveat field.
        const requestedContext = input.sources.filter((source) => source.contribution === "requested_context");
        if (requestedContext.length && !requestedContext.some((source) => practicalCitations.includes(source.index))) {
          groundingViolations = [{ excerpt: result.practicalAnswer.slice(0, 2500), reason: "The answer omits the selected requested context. Include a supported practical detail from at least one source marked requested_context, with its citation and applicability conditions, instead of repeating only the prior relationship." }];
          throw Object.assign(new Error("Source composition omitted requested contextual source evidence."), { code: "missing_contextual_citation" });
        }
        if (reviewedText.includes("?")) throw new Error("Source composition cannot append a question.");
        failureStage = "grounding";
        groundingReviews += 1;
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
            answerScope: {
              version: 1,
              currentParticipantRequest: input.participantMessage.slice(0, 12000),
              resolvedSourceQuestion: input.resolvedSourceQuestion?.slice(0, 12000) ?? null,
              sourceTopicContext: input.sourceTopicContext ?? null,
              sourceQuestionPlan: input.sourceQuestionPlan ?? null,
              presentationPlan: input.presentationPlan ?? null,
            },
          }),
          metadata: { survey_slug: input.surveySlug, composition_attempt: String(attempt) },
        });
        groundingTrace = review.trace;
        const grounding = sourceGroundingReviewResultSchema.parse(review.result);
        if (grounding.supported !== (grounding.unsupportedClaims.length === 0) ||
            grounding.unsupportedClaims.some(({ excerpt }) => !result.practicalAnswer.includes(excerpt) && !result.qualification?.includes(excerpt))) {
          throw new Error("Grounding review requires consistent status and exact draft excerpts.");
        }
        groundingViolations = grounding.unsupportedClaims;
        if (!grounding.supported) throw new Error("Source composition contains unsupported claims.");
        attempts.push({ trace, groundingTrace, error: null });
        return { ...call, result: directResult ?? controlledRagCompositionResultSchema.parse({ answerBody, usedSourceIndexes: result.usedSourceIndexes, limitations: [] }), contextualCompositionAttempts: attempts,
          groundingReview: sourceAnswerGroundingAuditSchema.parse({ version: 1, status: "supported", attempt, model: review.trace.response.model ?? review.trace.request.model, responseId: review.trace.response.id }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Source composition validation failed.";
        const failure = sanitizeSourceFailure(error, failureStage);
        attempts.push({ trace, groundingTrace, error: failure.code, failure });
        const recoverable = trace || (error instanceof Error && (error.name === "ZodError" || message.includes("returned no parsed output")));
        if (failureStage === "composition") compositionFailures += 1;
        if (!recoverable || attempt === 3 || compositionFailures >= 2 || groundingReviews >= 2) {
          throw Object.assign(error instanceof Error ? error : new Error(message), { contextualCompositionAttempts: attempts });
        }
      }
    }
    throw new Error("Source composition did not produce a validated answer.");
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
    const call = await this.runStructuredCall<ModeratorPlanTokenModelResult>({
      callType: "moderator_plan",
      model: this.config.decisionModel,
      promptVersion: moderatorPlannerSystemPrompt.version,
      schemaName: "moderator_plan_result_v4",
      schema: moderatorPlanTokenModelResultSchema,
      instructions: moderatorPlannerSystemPrompt.instructions,
      input: moderatorPlanTokenInputSchema.parse({ ...planningContext, schemaVersion: 4, participantTokens: participantTokensForModel(parsed.participantMessage) }),
      metadata: { brand: parsed.brand },
    });
    return { ...call, result: normalizeModeratorPlanTokenResult(parsed, call.result) };
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
    const baseSchema = parsed.evidenceFocus === "contextual" ? moderatorContextualEvidenceSelectionModelResultSchema : moderatorEvidenceSelectionModelResultSchema;
    const singleFact = parsed.presentationPlan?.maxFacts === 1;
    const call = await this.runStructuredCall<ModeratorEvidenceSelectionResult>({
      callType: "moderator_evidence",
      model: this.config.sourceModel ?? this.config.analysisModel,
      promptVersion: moderatorEvidenceSelectorSystemPrompt.version,
      schemaName: singleFact ? `moderator_${parsed.evidenceFocus}_single_fact_selection_result_v2` : parsed.evidenceFocus === "contextual" ? "moderator_contextual_evidence_selection_result_v2" : "moderator_evidence_selection_result_v4",
      schema: singleFact ? baseSchema.extend({ selections: baseSchema.shape.selections.max(1) }) : baseSchema,
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
    // Explicit reasoning for interpretation and evidence checks; phrasing keeps
    // its fast path. Only send the parameter to documented supported families.
    const reasoningEffort = /^gpt-5\.(?:4(?:-mini|-nano)?|5)(?:-\d{4}-\d{2}-\d{2})?$/.test(model) && !["phrasing", "moderator_phrasing"].includes(callType)
      ? (callType === "source_grounding_review" ? this.config.groundingReasoningEffort : callType === "source_composition" ? this.config.compositionReasoningEffort : callType === "moderator_plan" ? this.config.moderatorReasoningEffort ?? this.config.interpretationReasoningEffort : callType === "turn_route" ? this.config.interpretationReasoningEffort : undefined) ?? this.config.reasoningEffort ?? "medium" : undefined;
    const effectiveMetadata = { ...metadata, ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}) };
    const requestPayload = {
      model,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      instructions: instructions.join("\n"),
      input: buildMessages(input),
      text: {
        format: zodTextFormat(schema as never, schemaName)
      },
      metadata: effectiveMetadata,
      store: true
    };

    let response: ResponsesParseResult<TOutput> | undefined;
    let elapsedMs = 0;
    const modelStartedAt = performance.now();
    try {
      response = (await this.client.parse(requestPayload)) as ResponsesParseResult<TOutput>;
    } catch (error) {
      const failure = sanitizeSourceFailure(error, "composition");
      if (failure.status !== null) {
        try { console.warn(JSON.stringify({ event: "model_provider_failure", callType, status: failure.status, providerCode: failure.providerCode,
          ...(failure.limitKind ? { limitKind: failure.limitKind } : {}), ...(failure.retryAfter !== null ? { retryAfter: failure.retryAfter } : {}) })); } catch { /* Logging must preserve the provider failure. */ }
      }
      throw error;
    } finally {
      elapsedMs = Math.max(0, Math.round(performance.now() - modelStartedAt));
      logModelCallTiming({ callType, model, schemaName, metadata, elapsedMs, reasoningEffort, response });
    }

    if (response?.output_parsed === undefined) {
      throw new Error(`OpenAI ${callType} call returned no parsed output.`);
    }

    const trace = openAIDebugTraceSchema.parse({
      callType,
      promptVersion,
      requestedAt,
      elapsedMs,
      request: {
        model,
        schemaName,
        input,
        metadata: effectiveMetadata
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
