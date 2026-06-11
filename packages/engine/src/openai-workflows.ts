import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import {
  analysisSystemPrompt,
  decisionSystemPrompt,
  phraserSystemPrompt
} from "@interview/prompts";
import {
  analysisInputSchema,
  analysisResultSchema,
  controlledRagCompositionInputSchema,
  controlledRagCompositionResultSchema,
  decisionInputSchema,
  decisionResultSchema,
  openAIDebugTraceSchema,
  phrasingInputSchema,
  phrasingResultSchema,
  type AnalysisInput,
  type AnalysisResult,
  type ControlledRagCompositionInput,
  type ControlledRagCompositionResult,
  type DecisionInput,
  type DecisionResult,
  type OpenAIDebugTrace,
  type PhrasingInput,
  type PhrasingResult
} from "@interview/schemas";
import type { CompiledStudy } from "./study-compiler";
import {
  buildDecisionCandidates,
  commitSelection,
  createSessionState,
  prepareDecisionTurn,
} from "./turn-orchestrator";

type CallType = "analysis" | "decision" | "phrasing" | "source_composition";

type ModelConfig = {
  analysisModel: string;
  decisionModel: string;
  phrasingModel: string;
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

    return this.runStructuredCall<ControlledRagCompositionResult>({
      callType: "source_composition",
      model: this.config.phrasingModel,
      promptVersion: "controlled-rag-composition-v1",
      schemaName: "controlled_rag_composition_result",
      schema: controlledRagCompositionResultSchema,
      instructions: [
        "You compose source-grounded interviewer context for a structured medical market research interview.",
        "Use only the provided source snippets. Do not add facts, claims, trial outcomes, labels, guidance, or caveats that are not supported by those snippets.",
        "Do not choose the next survey question. The application has already selected it. Your job is only to answer or orient from the sources.",
        "Write for an HCP respondent: concise, specific, and clinically useful. Avoid vague marketing language.",
        "State source facts neutrally. Do not characterize data as strong, compelling, impressive, meaningful, substantial, important, or as what stands out unless that exact characterization appears in the source snippets.",
        "If asked what data show, report the study population, comparator, endpoints, and numeric results available in the snippets. Do not infer clinical significance or recommend a conclusion.",
        "If the participant asks a direct source question, answer that question first. If the source snippets are thin, say what the provided sources do and do not support.",
        "Avoid repeating context already covered in recent interviewer turns. Focus on the current angle.",
        "Use one short paragraph or 2-4 focused bullets. Do not write a full label-style inventory unless the participant explicitly asked for a broad label summary.",
        "Use plain text. Do not use Markdown emphasis. Cite factual claims with bracket markers like [1] or [2] matching the source index.",
        "Do not include the selected next question in answerBody."
      ],
      input: parsed,
      metadata: {
        survey_slug: parsed.surveySlug
      }
    });
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

    const debugPath = await this.debugStore?.save(trace);

    return {
      result: response.output_parsed,
      trace,
      debugPath
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
