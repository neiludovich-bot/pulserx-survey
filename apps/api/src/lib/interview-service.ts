import { randomUUID } from "node:crypto";
import {
  DecisionKind,
  DecisionStatus,
  SessionStatus,
  TurnRole,
  type Prisma,
} from "@prisma/client";
import {
  buildDecisionCandidates,
  commitSelection,
  createSessionState,
  prepareDecisionTurn,
  type DeterministicSelection,
} from "@interview/engine";
import {
  analysisResultSchema,
  assetReactionResponseSchema,
  respondentSessionResponseSchema,
  sessionAuditResponseSchema,
  sessionStateJsonSchema,
  abandonStudyOpenSessionsResponseSchema,
  groundedReferenceSchema,
  studyGraphResponseSchema,
  studyLaunchSmokeTestResponseSchema,
  turnAuditDecisionOutputSummarySchema,
  type AnalysisResult,
  type FactValue,
  type StartTestSessionRequest,
  type SubmitAssetReaction,
  type StudyLaunchSmokeTestResponse,
  type SurveyTurnIntent,
} from "@interview/schemas";
import { prisma } from "./prisma";
import {
  buildFallbackInterviewerUtterance,
  buildInterviewerPhrasingInput,
} from "./interviewer-copy";
import {
  asObject,
  getSessionStateFromMetadata,
  loadCompiledStudy,
  toStudySummary,
  withSessionStateMetadata,
} from "./study-runtime";
import { getOptionalOpenAIGateway } from "./model-gateway";
import {
  askCustomGptForProactiveStudyContext,
  askCustomGptForSurveyClarification,
  type CustomGptReference,
} from "./customgpt-service";
import {
  extractSourceContextHintFromScriptedResponsePrompt,
  findScriptedResponseImportNodes,
} from "./guide-cleanup";
import { env } from "../env";
import { getLiveSessionTiming } from "./session-timing";
import { resolveGroundedStudyContextRequirement } from "./study-grounding";

type LoadedSession = Prisma.SessionGetPayload<{
  include: {
    study: {
      include: {
        modules: true;
        assets: true;
        actions: true;
        actionRules: true;
        assetStageRules: true;
        questionNodes: true;
      };
    };
    respondent: true;
    sessionAssets: {
      include: {
        asset: true;
        sourceAction: true;
      };
      orderBy: {
        createdAt: "asc";
      };
    };
    turns: {
      include: {
        node: true;
      };
      orderBy: {
        sequence: "asc";
      };
    };
    analyses: true;
    decisions: {
      include: {
        selectedNode: true;
      };
    };
    assetReactions: true;
  };
}>;

type LoadedStudyDesign = Awaited<ReturnType<typeof loadCompiledStudy>>["study"];
type AssetAwareStudy = Pick<
  LoadedStudyDesign,
  | "id"
  | "name"
  | "config"
  | "modules"
  | "questionNodes"
  | "assets"
  | "actions"
  | "actionRules"
  | "assetStageRules"
>;

function asWords(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function detectStakeholders(answer: string) {
  const lower = answer.toLowerCase();
  const candidates = [
    "finance",
    "product marketing",
    "marketing",
    "sales",
    "cro",
    "cfo",
    "operations",
    "product",
  ];

  return candidates.filter((candidate) => lower.includes(candidate));
}

function looksLikeNonsense(answer: string, answerWords: string[]) {
  const normalized = answer.trim().toLowerCase();

  if (
    /^(idk|i do not know|i don't know|no idea|n\/a|na|none|whatever|blah|blah blah|asdf|test)$/i.test(
      normalized,
    )
  ) {
    return true;
  }

  if (answerWords.length <= 2) {
    return true;
  }

  const uniqueWords = new Set(answerWords);
  return (
    answerWords.length >= 4 &&
    uniqueWords.size <= Math.ceil(answerWords.length / 3)
  );
}

function looksLikeImportedNonAnswer(answer: string, answerWords: string[]) {
  const normalized = answer.trim().toLowerCase();

  if (/^(blah|blah blah|asdf|test|whatever)$/i.test(normalized)) {
    return true;
  }

  const uniqueWords = new Set(answerWords);
  return (
    answerWords.length >= 4 &&
    uniqueWords.size <= Math.ceil(answerWords.length / 3)
  );
}

function isTerminalCloseAnswer(answer: string) {
  return /^(no|nope|no thank you|nothing else|that's all|that is all|all good|we covered it|we covered everything)$/i.test(
    answer.trim(),
  );
}

function sourceContextReferencesFromConfig(config: Prisma.JsonObject) {
  const parsed = groundedReferenceSchema
    .array()
    .safeParse(config.sourceContextReferences);

  return parsed.success ? parsed.data : [];
}

function hasReferencedSourceContextNote(config: Prisma.JsonObject) {
  return (
    typeof config.sourceContextHint === "string" &&
    Boolean(config.sourceContextHint.trim()) &&
    sourceContextReferencesFromConfig(config).length > 0
  );
}

function looksLikeSkipRequest(answer: string) {
  return /^(skip|skipped|skip \/ not sure|skipped \/ not sure|pass|move on|next|next question|not sure|unsure|i'?m not sure|i do not know|i don't know|don't know|no answer|i can'?t answer|cannot answer|i would rather skip|prefer to skip)$/i.test(
    answer.trim(),
  );
}

export function containsMedicalSafetyConcern(answer: string) {
  const normalized = answer.toLowerCase();

  if (
    /\b(suicid|overdose|severe bleeding|anaphylaxis|call 911)\b/i.test(answer)
  ) {
    return true;
  }

  const emergencySymptom =
    /\b(chest pain|can't breathe|cannot breathe|trouble breathing|stroke|heart attack)\b/i.test(
      answer,
    );
  const presentTense =
    /\b(i have|i'm having|i am having|right now|currently|now)\b/i.test(answer);
  const asksForAdvice =
    /\b(what should i do|should i go|do i need|do we need|go to (the )?(er|emergency room)|emergency|urgent care)\b/i.test(
      answer,
    );

  return (
    (emergencySymptom && (presentTense || asksForAdvice)) ||
    /\b(should i call 911|need an ambulance|medical emergency)\b/.test(
      normalized,
    )
  );
}

function looksLikeParticipantQuestion(answer: string) {
  return (
    answer.trim().endsWith("?") ||
    /^(what|why|how|can|could|should|is|are|do|does|will|would)\b/i.test(
      answer.trim(),
    )
  );
}

function looksLikeStudySummaryRequest(answer: string) {
  const normalized = answer.trim();

  if (!normalized) {
    return false;
  }

  const namesClinicalStudy =
    /\b(study|trial|ALPINE|SEQUOIA|ASPEN|ROSEWOOD|MAGNOLIA|BGB[-\s]?\d+|NCT\d+)\b/i.test(
      normalized,
    );
  const asksForOrientation =
    normalized.endsWith("?") ||
    /^(summarize|summary|explain|tell me about|walk me through|what is|what was|what were|can you summarize|could you summarize|can you explain|could you explain)\b/i.test(
      normalized,
    );

  return namesClinicalStudy && asksForOrientation;
}

function getMissingFactKeys(
  expectedFactKeys: string[],
  extractedFacts: Record<string, FactValue>,
) {
  return expectedFactKeys.filter(
    (factKey) => extractedFacts[factKey] === undefined,
  );
}

export function buildDeterministicAnalysis(input: {
  node: {
    key: string;
    title: string;
    nodeType?: string;
    isTerminal?: boolean;
    config: {
      factKeys: string[];
      importSource?: string;
      sourceLine?: number | null;
      minUsefulWords?: number;
    };
    prompt: string;
  };
  answer: string;
  sessionFacts: Record<string, FactValue>;
  allowGeneralClarificationQuestions?: boolean;
}): AnalysisResult {
  const answer = input.answer.trim();
  const extractedFacts: Record<string, FactValue> = {};
  const answerWords = asWords(answer);
  const promptWords = new Set(asWords(input.node.prompt));
  const overlap = answerWords.filter((word) => promptWords.has(word));
  const obviousOffTopic = /(weather|tariff|baseball|football|pizza)/i.test(
    answer,
  );
  const safetyFlag = containsMedicalSafetyConcern(answer);
  const skipRequest = !safetyFlag && looksLikeSkipRequest(answer);
  const participantQuestion =
    !skipRequest &&
    (looksLikeParticipantQuestion(answer) ||
      looksLikeStudySummaryRequest(answer));
  const offTopic = !safetyFlag && obviousOffTopic && overlap.length < 2;
  const questionIsClarification =
    participantQuestion &&
    !safetyFlag &&
    !offTopic &&
    (input.allowGeneralClarificationQuestions === true ||
      /(survey|question|mean|material|guide|pdf|pane|information|medicine|medical|risk|side effect|treatment|doctor|clinician)/i.test(
        answer,
      ));
  const importedOpenEnded =
    input.node.config.importSource === "survey_import" ||
    typeof input.node.config.sourceLine === "number";
  const minUsefulWords =
    input.node.config.minUsefulWords ?? (importedOpenEnded ? 1 : 8);
  const allowTerminalClose =
    (input.node.isTerminal === true || input.node.nodeType === "CLOSE") &&
    isTerminalCloseAnswer(answer);
  const nonsense =
    !offTopic &&
    !safetyFlag &&
    !questionIsClarification &&
    !allowTerminalClose &&
    !skipRequest &&
    (importedOpenEnded
      ? looksLikeImportedNonAnswer(answer, answerWords)
      : looksLikeNonsense(answer, answerWords));
  const turnIntent: SurveyTurnIntent = safetyFlag
    ? "medical_safety"
    : offTopic
      ? "off_topic"
      : nonsense
        ? "nonsense"
        : questionIsClarification
          ? "clarification_question"
          : "survey_answer";

  if (input.node.key === "company_context") {
    const lower = answer.toLowerCase();
    if (lower.includes("b2b saas")) {
      extractedFacts.company_type = "B2B SaaS";
    } else if (lower.includes("services")) {
      extractedFacts.company_type = "Services";
    }

    const stakeholders = detectStakeholders(answer);
    if (stakeholders.length > 0) {
      extractedFacts.pricing_stakeholders = stakeholders;
    }
  } else if (
    !offTopic &&
    !nonsense &&
    !safetyFlag &&
    !questionIsClarification
  ) {
    for (const factKey of input.node.config.factKeys) {
      extractedFacts[factKey] = answer;
    }
  }
  const missingTopics = getMissingFactKeys(
    input.node.config.factKeys,
    extractedFacts,
  );
  const partial =
    !offTopic &&
    !nonsense &&
    !safetyFlag &&
    !questionIsClarification &&
    !allowTerminalClose &&
    !skipRequest &&
    (answerWords.length < minUsefulWords ||
      (!importedOpenEnded &&
        missingTopics.length === input.node.config.factKeys.length));
  const answerQuality =
    offTopic || safetyFlag || questionIsClarification
      ? "off_topic"
      : nonsense
        ? "nonsense"
        : partial
          ? "partial"
          : "adequate";
  const shouldAdvance = answerQuality === "adequate";
  const followUpAction =
    offTopic || safetyFlag || questionIsClarification
      ? "redirect"
      : shouldAdvance
        ? "advance"
        : "probe";
  const shouldRedirect = offTopic || safetyFlag || questionIsClarification;

  return analysisResultSchema.parse({
    summary: shouldAdvance
      ? skipRequest
        ? `Captured a skip or unsure response for "${input.node.title}".`
        : `Captured a usable response for "${input.node.title}".`
      : safetyFlag
        ? `The participant raised a medical safety concern while answering "${input.node.title}".`
        : questionIsClarification
          ? `The participant asked a clarification or content question while answering "${input.node.title}".`
          : offTopic
            ? `The participant went off topic instead of answering "${input.node.title}".`
            : `The participant response for "${input.node.title}" was too thin to advance yet.`,
    extractedFacts,
    offTopic: shouldRedirect,
    turnIntent,
    participantQuestion: participantQuestion ? answer : null,
    groundedResponse: null,
    groundedReferences: [],
    safetyFlag,
    answerQuality,
    shouldAdvance,
    followUpAction,
    missingTopics,
    confidence: shouldRedirect ? 0.55 : shouldAdvance ? 0.78 : 0.72,
  });
}

function findActionForNode(
  study: AssetAwareStudy,
  nodeId: string | null | undefined,
) {
  if (!nodeId) {
    return null;
  }

  return study.actions.find((action) => action.nodeId === nodeId) ?? null;
}

function findAssetContext(
  study: AssetAwareStudy,
  actionId: string | null | undefined,
  sessionAssets: LoadedSession["sessionAssets"],
) {
  if (!actionId) {
    return null;
  }

  const action =
    study.actions.find((candidate) => candidate.id === actionId) ?? null;
  if (!action) {
    return null;
  }

  const latestSessionAsset = [...sessionAssets]
    .reverse()
    .find((candidate) => candidate.sourceActionId === action.id);

  if (action.assetId) {
    const asset =
      study.assets.find((candidate) => candidate.id === action.assetId) ?? null;
    if (!asset) {
      return null;
    }

    return {
      action,
      sourceAction: action,
      asset,
      displayMode: latestSessionAsset?.displayMode ?? null,
      shownAt: latestSessionAsset?.shownAt ?? null,
    };
  }

  const incomingAssetContext = study.actionRules
    .filter((rule) => rule.toActionId === action.id)
    .map((rule) => {
      const showAction =
        study.actions.find((candidate) => candidate.id === rule.fromActionId) ??
        null;
      if (showAction?.actionType !== "SHOW_ASSET" || !showAction.assetId) {
        return null;
      }

      const asset =
        study.assets.find((candidate) => candidate.id === showAction.assetId) ??
        null;
      if (!asset) {
        return null;
      }

      const stageRule =
        study.assetStageRules.find(
          (candidate) =>
            candidate.triggerActionId === showAction.id &&
            candidate.assetId === asset.id,
        ) ?? null;

      return {
        rule,
        showAction,
        asset,
        stageRule,
      };
    })
    .filter((candidate) => candidate !== null)
    .sort((left, right) => {
      if (left.rule.priority !== right.rule.priority) {
        return left.rule.priority - right.rule.priority;
      }

      if (left.showAction.priority !== right.showAction.priority) {
        return left.showAction.priority - right.showAction.priority;
      }

      return right.asset.position - left.asset.position;
    })[0];

  if (!incomingAssetContext) {
    return null;
  }

  const matchingSessionAsset =
    [...sessionAssets]
      .reverse()
      .find(
        (candidate) =>
          candidate.sourceActionId === incomingAssetContext.showAction.id ||
          candidate.assetId === incomingAssetContext.asset.id,
      ) ?? null;

  return {
    action,
    sourceAction: incomingAssetContext.showAction,
    asset: incomingAssetContext.asset,
    displayMode:
      matchingSessionAsset?.displayMode ??
      incomingAssetContext.stageRule?.displayMode ??
      null,
    shownAt: matchingSessionAsset?.shownAt ?? null,
  };
}

function findLatestAssetReaction(
  assetReactions: LoadedSession["assetReactions"],
  assetId: string,
) {
  return (
    [...assetReactions]
      .filter((reaction) => reaction.assetId === assetId)
      .sort((left, right) => {
        const updatedDifference =
          right.updatedAt.getTime() - left.updatedAt.getTime();
        if (updatedDifference !== 0) {
          return updatedDifference;
        }

        return right.createdAt.getTime() - left.createdAt.getTime();
      })[0] ?? null
  );
}

function toAssetReactionSummary(
  reaction: LoadedSession["assetReactions"][number] | null,
) {
  if (!reaction) {
    return null;
  }

  return {
    id: reaction.id,
    studyId: reaction.studyId,
    sessionId: reaction.sessionId,
    turnId: reaction.turnId,
    assetId: reaction.assetId,
    kind: reaction.kind,
    status: reaction.status,
    schemaVersion: reaction.schemaVersion,
    input: reaction.input ?? null,
    output: reaction.output ?? null,
    createdAt: reaction.createdAt.toISOString(),
    updatedAt: reaction.updatedAt.toISOString(),
  };
}

function describeAssetReactionKind(kind: string) {
  switch (kind) {
    case "COMPREHENSION":
      return "Reviewed";
    case "APPEAL":
      return "Helpful";
    case "CONCERN":
      return "Confusing";
    case "OBJECTION":
      return "Objection";
    case "COMPARISON":
      return "Comparison";
    case "OPEN_FEEDBACK":
      return "Open feedback";
    default:
      return kind;
  }
}

function getRespondentViewMaxAttempts(
  node: NonNullable<LoadedSession["turns"][number]["node"]>,
  fallbackMaxAttempts: number,
) {
  const config =
    node.config &&
    typeof node.config === "object" &&
    !Array.isArray(node.config)
      ? (node.config as Prisma.JsonObject)
      : {};
  const configuredMaxAttempts =
    typeof config.maxAttempts === "number"
      ? config.maxAttempts
      : fallbackMaxAttempts;
  const importedGuideQuestion =
    config.importSource === "survey_import" ||
    typeof config.sourceLine === "number";

  return importedGuideQuestion
    ? Math.min(configuredMaxAttempts, 1)
    : configuredMaxAttempts;
}

function getStudyConfigValue(
  study: { config: Prisma.JsonValue | null },
  key: string,
): unknown {
  if (
    !study.config ||
    typeof study.config !== "object" ||
    Array.isArray(study.config)
  ) {
    return undefined;
  }

  return (study.config as Prisma.JsonObject)[key];
}

function getStudyCustomGptProjectId(study: {
  config: Prisma.JsonValue | null;
}) {
  const value = getStudyConfigValue(study, "customGptProjectId");

  return typeof value === "string" && value.trim()
    ? value.trim()
    : (env.CUSTOMGPT_PROJECT_ID ?? null);
}

function buildRespondentCapabilities(study: LoadedSession["study"]) {
  const customGptProjectId = getStudyCustomGptProjectId(study);
  const customGptConfigured = Boolean(env.CUSTOMGPT_API_KEY);
  const customGptProjectConfigured = Boolean(customGptProjectId);
  const realtimeStudySetting = getStudyConfigValue(
    study,
    "realtimeVoiceEnabled",
  );
  const realtimeVoiceAllowed = realtimeStudySetting !== false;
  const openAiConfigured = Boolean(env.OPENAI_API_KEY);

  return {
    customGptGrounding: {
      enabled: customGptConfigured && customGptProjectConfigured,
      configured: customGptConfigured,
      projectConfigured: customGptProjectConfigured,
      reason: !customGptConfigured
        ? "CUSTOMGPT_API_KEY is not configured."
        : !customGptProjectConfigured
          ? "No CustomGPT project is configured for this study."
          : null,
    },
    recordedVoice: {
      enabled: openAiConfigured,
      reason: openAiConfigured
        ? null
        : "OPENAI_API_KEY is required for recorded voice mode.",
    },
    realtimeVoice: {
      enabled: openAiConfigured && realtimeVoiceAllowed,
      model: env.OPENAI_MODEL_REALTIME,
      reason: !openAiConfigured
        ? "OPENAI_API_KEY is required for realtime voice mode."
        : !realtimeVoiceAllowed
          ? "Realtime voice is disabled for this study."
          : null,
    },
  };
}

function getGroundingFromAnalysisOutput(output: unknown) {
  const parsed = analysisResultSchema.safeParse(output);

  if (parsed.success) {
    return {
      groundedResponse: parsed.data.groundedResponse,
      groundedReferences: parsed.data.groundedReferences,
    };
  }

  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return {
      groundedResponse: null,
      groundedReferences: [],
    };
  }

  const candidate = output as Record<string, unknown>;
  const groundedResponse =
    typeof candidate.groundedResponse === "string" &&
    candidate.groundedResponse.trim()
      ? candidate.groundedResponse
      : null;
  const groundedReferences = Array.isArray(candidate.groundedReferences)
    ? candidate.groundedReferences.flatMap((reference) => {
        if (
          reference === null ||
          typeof reference !== "object" ||
          Array.isArray(reference)
        ) {
          return [];
        }

        const value = reference as Record<string, unknown>;
        if (typeof value.citationId !== "string" || !value.citationId.trim()) {
          return [];
        }

        return [
          {
            citationId: value.citationId,
            title: typeof value.title === "string" ? value.title : null,
            url: typeof value.url === "string" ? value.url : null,
            description:
              typeof value.description === "string" ? value.description : null,
          },
        ];
      })
    : [];

  return {
    groundedResponse,
    groundedReferences,
  };
}

function getProactiveGroundingFromTurnPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const candidate = (payload as Record<string, unknown>).proactiveGrounding;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const value = candidate as Record<string, unknown>;
  if (
    value.kind !== "clinical_study_context" ||
    typeof value.answer !== "string" ||
    !value.answer.trim()
  ) {
    return null;
  }

  const references = Array.isArray(value.references)
    ? value.references.flatMap((reference) => {
        if (
          !reference ||
          typeof reference !== "object" ||
          Array.isArray(reference)
        ) {
          return [];
        }

        const item = reference as Record<string, unknown>;
        if (typeof item.citationId !== "string" || !item.citationId.trim()) {
          return [];
        }

        return [
          {
            citationId: item.citationId,
            title: typeof item.title === "string" ? item.title : null,
            url: typeof item.url === "string" ? item.url : null,
            description:
              typeof item.description === "string" ? item.description : null,
          },
        ];
      })
    : [];

  const rawGeneratedAt =
    typeof value.generatedAt === "string" && value.generatedAt.trim()
      ? value.generatedAt.trim()
      : null;
  const generatedAt =
    rawGeneratedAt && !Number.isNaN(Date.parse(rawGeneratedAt))
      ? new Date(rawGeneratedAt).toISOString()
      : null;

  return {
    kind: "clinical_study_context" as const,
    answer: value.answer.trim(),
    references,
    contextQuestion:
      typeof value.contextQuestion === "string" && value.contextQuestion.trim()
        ? value.contextQuestion.trim()
        : null,
    assetTitle:
      typeof value.assetTitle === "string" && value.assetTitle.trim()
        ? value.assetTitle.trim()
        : null,
    generatedAt,
  };
}

function enrichSessionStateWithActionContext(
  sessionState: ReturnType<typeof sessionStateJsonSchema.parse>,
  study: AssetAwareStudy,
  sessionAssets: LoadedSession["sessionAssets"],
) {
  const currentAction = findActionForNode(study, sessionState.currentNodeId);
  const assetContext = findAssetContext(
    study,
    currentAction?.id,
    sessionAssets,
  );

  return sessionStateJsonSchema.parse({
    ...sessionState,
    currentActionId: currentAction?.id ?? null,
    currentActionKey: currentAction?.key ?? null,
    currentAssetId: assetContext?.asset.id ?? null,
  });
}

function getRespondentTranscriptGrounding(
  session: LoadedSession,
  turn: LoadedSession["turns"][number],
) {
  if (turn.role !== TurnRole.INTERVIEWER) {
    return null;
  }

  const proactiveGrounding = getProactiveGroundingFromTurnPayload(
    turn.payload ?? null,
  );
  if (proactiveGrounding) {
    return proactiveGrounding;
  }

  const previousParticipantTurn = session.turns.find(
    (candidate) =>
      candidate.sequence === turn.sequence - 1 &&
      candidate.role === TurnRole.PARTICIPANT,
  );
  const previousAnalysis = previousParticipantTurn
    ? session.analyses.find(
        (analysis) => analysis.turnId === previousParticipantTurn.id,
      )
    : null;
  const analysisGrounding = getGroundingFromAnalysisOutput(
    previousAnalysis?.output ?? null,
  );

  if (!analysisGrounding.groundedResponse) {
    return null;
  }

  return {
    kind: "clarification_answer" as const,
    answer: analysisGrounding.groundedResponse,
    references: analysisGrounding.groundedReferences,
  };
}

function getRespondentCurrentQuestionPrompt(
  session: LoadedSession,
  turn: LoadedSession["turns"][number],
) {
  const proactiveGrounding = getProactiveGroundingFromTurnPayload(
    turn.payload ?? null,
  );

  if (proactiveGrounding?.contextQuestion) {
    return proactiveGrounding.contextQuestion;
  }

  const transcriptGrounding = getRespondentTranscriptGrounding(session, turn);
  if (transcriptGrounding?.kind === "clarification_answer") {
    return turn.node?.prompt ?? turn.content;
  }

  return turn.content;
}

function buildCandidateActionData(input: {
  study: AssetAwareStudy;
  sessionId: string;
  turnId: string;
  currentNodeId: string | null;
  candidateNodeIds: string[];
}) {
  const rows: Prisma.CandidateActionCreateManyInput[] = [];
  const currentAction = findActionForNode(input.study, input.currentNodeId);

  if (!currentAction && input.candidateNodeIds.length === 0) {
    return rows;
  }

  for (const candidateNodeId of input.candidateNodeIds) {
    const action = findActionForNode(input.study, candidateNodeId);
    if (!action) {
      continue;
    }

    rows.push({
      id: randomUUID(),
      studyId: input.study.id,
      sessionId: input.sessionId,
      turnId: input.turnId,
      studyActionId: action.id,
      nodeId: action.nodeId,
      assetId: action.assetId,
      actionType: action.actionType,
      priority: action.priority,
      allowed: true,
      reasonCode: "BRANCH_PRIORITY",
      input: {
        fromNodeId: input.currentNodeId,
      },
    });
  }

  if (currentAction) {
    const stageRules = input.study.assetStageRules.filter(
      (rule) => rule.triggerActionId === currentAction.id,
    );

    for (const stageRule of stageRules) {
      const showAssetAction =
        input.study.actions.find(
          (candidate) =>
            candidate.actionType === "SHOW_ASSET" &&
            candidate.assetId === stageRule.assetId,
        ) ?? null;

      if (!showAssetAction) {
        continue;
      }

      rows.push({
        id: randomUUID(),
        studyId: input.study.id,
        sessionId: input.sessionId,
        turnId: input.turnId,
        studyActionId: showAssetAction.id,
        nodeId: showAssetAction.nodeId,
        assetId: showAssetAction.assetId,
        actionType: showAssetAction.actionType,
        priority: showAssetAction.priority,
        allowed: true,
        reasonCode: "ASSET_STAGE",
        input: {
          triggerActionId: currentAction.id,
        },
      });
    }
  }

  return rows;
}

type BuildInterviewerTurnInput = {
  sessionId: string;
  study: AssetAwareStudy;
  selectedNode: {
    id: string;
    moduleId?: string | null;
    title: string;
    prompt: string;
    config?: {
      factKeys?: string[];
      requiresGroundedStudyContext?: boolean;
      sourceContextHint?: string | null;
      sourceContextReferences?: CustomGptReference[];
      sourceLine?: number | null;
    };
    isTerminal?: boolean;
  };
  selectionAction: "ask" | "probe" | "redirect" | "close";
  analysis?: AnalysisResult | null;
  sessionAssets: LoadedSession["sessionAssets"];
};

type ProactiveStudyGrounding = {
  answer: string;
  references: CustomGptReference[];
  contextQuestion: string;
  assetTitle: string | null;
  generatedAt: string;
};

type ProactiveStudyGroundingAttempt = {
  kind: "clinical_study_context";
  required: true;
  status: "succeeded" | "failed";
  source: "approved_source_note" | "customgpt" | "imported_guide" | "none";
  reason: string | null;
  referenceCount: number;
  contextQuestion: string;
  assetTitle: string | null;
  generatedAt: string;
};

type ProactiveStudyGroundingResult = {
  grounding: ProactiveStudyGrounding | null;
  attempt: ProactiveStudyGroundingAttempt | null;
};

type InterviewerTurnDraft = {
  content: string;
  payload?: Prisma.InputJsonObject;
};

type SourceContextHintNode = Pick<
  BuildInterviewerTurnInput["selectedNode"],
  "id" | "prompt" | "config"
>;

function getSelectedNodeSourceContextHint(selectedNode: SourceContextHintNode) {
  return typeof selectedNode.config?.sourceContextHint === "string" &&
    selectedNode.config.sourceContextHint.trim()
    ? selectedNode.config.sourceContextHint.trim()
    : null;
}

function hasApprovedSourceContextReferences(
  selectedNode: SourceContextHintNode,
) {
  return (
    Array.isArray(selectedNode.config?.sourceContextReferences) &&
    selectedNode.config.sourceContextReferences.length > 0
  );
}

export function buildGuideHintProactiveStudyGrounding(input: {
  selectedNode: SourceContextHintNode;
  assetTitle?: string | null;
  generatedAt?: string;
}): ProactiveStudyGrounding | null {
  const sourceContextHint = getSelectedNodeSourceContextHint(
    input.selectedNode,
  );

  if (!sourceContextHint) {
    return null;
  }

  const sourceLine =
    typeof input.selectedNode.config?.sourceLine === "number" &&
    Number.isFinite(input.selectedNode.config.sourceLine)
      ? input.selectedNode.config.sourceLine
      : null;
  const savedReferences = Array.isArray(
    input.selectedNode.config?.sourceContextReferences,
  )
    ? input.selectedNode.config.sourceContextReferences
    : [];

  return {
    answer: sourceContextHint,
    references:
      savedReferences.length > 0
        ? savedReferences
        : [
            {
              citationId: `guide:${input.selectedNode.id}`,
              title: "Imported survey guide",
              url: null,
              description: sourceLine
                ? `Researcher-provided source-context hint imported from guide line ${sourceLine}.`
                : "Researcher-provided source-context hint imported from the survey guide.",
            },
          ],
    contextQuestion: input.selectedNode.prompt,
    assetTitle: input.assetTitle ?? null,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

export function buildProactiveStudySurveyContext(input: {
  study: Pick<AssetAwareStudy, "name" | "modules" | "questionNodes">;
  selectedNode: Pick<
    BuildInterviewerTurnInput["selectedNode"],
    "id" | "moduleId" | "title" | "prompt" | "config"
  >;
  assetTitle?: string | null;
}) {
  const selectedQuestion =
    input.study.questionNodes.find(
      (node) => node.id === input.selectedNode.id,
    ) ?? null;
  const moduleId =
    input.selectedNode.moduleId ?? selectedQuestion?.moduleId ?? null;
  const currentModule = moduleId
    ? (input.study.modules.find((module) => module.id === moduleId) ?? null)
    : null;
  const orderedQuestions = [...input.study.questionNodes].sort(
    (left, right) => {
      if (left.position !== right.position) {
        return left.position - right.position;
      }

      return left.title.localeCompare(right.title);
    },
  );
  const selectedIndex = orderedQuestions.findIndex(
    (node) => node.id === input.selectedNode.id,
  );
  const contextCandidates =
    moduleId !== null
      ? orderedQuestions.filter(
          (node) =>
            node.moduleId === moduleId && node.id !== input.selectedNode.id,
        )
      : orderedQuestions.filter((node) => node.id !== input.selectedNode.id);
  const before = contextCandidates
    .filter((node) =>
      selectedIndex < 0
        ? node.position <
          (selectedQuestion?.position ?? Number.MAX_SAFE_INTEGER)
        : orderedQuestions.findIndex((candidate) => candidate.id === node.id) <
          selectedIndex,
    )
    .slice(-2);
  const after = contextCandidates
    .filter((node) =>
      selectedIndex < 0
        ? node.position > (selectedQuestion?.position ?? -1)
        : orderedQuestions.findIndex((candidate) => candidate.id === node.id) >
          selectedIndex,
    )
    .slice(0, 2);
  const neighboringPrompts = [...before, ...after]
    .filter((node) => node.prompt.trim())
    .map((node) => `- ${node.title}: ${node.prompt}`);
  const sourceContextHint = getSelectedNodeSourceContextHint(
    input.selectedNode,
  );

  return [
    "The interviewer is about to ask this survey question.",
    `Study: ${input.study.name}`,
    currentModule ? `Current module: ${currentModule.title}` : null,
    input.assetTitle ? `Current side-pane asset: ${input.assetTitle}` : null,
    sourceContextHint
      ? `Researcher-provided source-context guidance from the imported guide: ${sourceContextHint}`
      : null,
    neighboringPrompts.length > 0 ? "Nearby guide context:" : null,
    ...neighboringPrompts,
    neighboringPrompts.length > 0
      ? "Use nearby guide context only to resolve shorthand such as 'that study', 'that evidence', or 'that profile'; do not ask or answer those nearby questions."
      : null,
    "Provide only the source context needed to help the respondent react.",
    `Survey question: ${input.selectedNode.prompt}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function getProactiveStudyGroundingResult(
  input: BuildInterviewerTurnInput,
  assetTitle: string | null,
): Promise<ProactiveStudyGroundingResult> {
  if (
    input.selectionAction !== "ask" ||
    input.analysis?.groundedResponse ||
    !resolveGroundedStudyContextRequirement({
      prompt: input.selectedNode.prompt,
      requiresGroundedStudyContext:
        input.selectedNode.config?.requiresGroundedStudyContext,
    }).requiresGroundedStudyContext
  ) {
    return {
      grounding: null,
      attempt: null,
    };
  }

  const generatedAt = new Date().toISOString();
  const buildAttempt = (attemptInput: {
    status: ProactiveStudyGroundingAttempt["status"];
    source: ProactiveStudyGroundingAttempt["source"];
    reason: string | null;
    referenceCount: number;
  }): ProactiveStudyGroundingAttempt => ({
    kind: "clinical_study_context",
    required: true,
    status: attemptInput.status,
    source: attemptInput.source,
    reason: attemptInput.reason,
    referenceCount: attemptInput.referenceCount,
    contextQuestion: input.selectedNode.prompt,
    assetTitle,
    generatedAt,
  });
  const guideHintGrounding = buildGuideHintProactiveStudyGrounding({
    selectedNode: input.selectedNode,
    assetTitle,
    generatedAt,
  });

  if (
    guideHintGrounding &&
    hasApprovedSourceContextReferences(input.selectedNode)
  ) {
    return {
      grounding: guideHintGrounding,
      attempt: buildAttempt({
        status: "succeeded",
        source: "approved_source_note",
        reason: null,
        referenceCount: guideHintGrounding.references.length,
      }),
    };
  }

  try {
    const grounded = await askCustomGptForProactiveStudyContext({
      projectId: getStudyCustomGptProjectId(input.study),
      question: input.selectedNode.prompt,
      surveyContext: buildProactiveStudySurveyContext({
        study: input.study,
        selectedNode: input.selectedNode,
        assetTitle,
      }),
      assetTitle,
    });

    if (!grounded.answer || grounded.references.length === 0) {
      if (guideHintGrounding) {
        return {
          grounding: guideHintGrounding,
          attempt: buildAttempt({
            status: "succeeded",
            source: "imported_guide",
            reason: grounded.enabled
              ? "CustomGPT did not return referenced source context; used imported guide context instead."
              : `${grounded.reason} Used imported guide context instead.`,
            referenceCount: guideHintGrounding.references.length,
          }),
        };
      }

      return {
        grounding: null,
        attempt: buildAttempt({
          status: "failed",
          source: grounded.enabled ? "customgpt" : "none",
          reason: grounded.enabled
            ? "CustomGPT did not return referenced source context."
            : grounded.reason,
          referenceCount: grounded.references.length,
        }),
      };
    }

    const grounding = {
      answer: grounded.answer,
      references: grounded.references,
      contextQuestion: input.selectedNode.prompt,
      assetTitle,
      generatedAt,
    };

    return {
      grounding,
      attempt: buildAttempt({
        status: "succeeded",
        source: "customgpt",
        reason: null,
        referenceCount: grounded.references.length,
      }),
    };
  } catch (error) {
    if (guideHintGrounding) {
      return {
        grounding: guideHintGrounding,
        attempt: buildAttempt({
          status: "succeeded",
          source: "imported_guide",
          reason: `CustomGPT request failed; used imported guide context instead.${
            error instanceof Error ? ` ${error.message}` : ""
          }`.trim(),
          referenceCount: guideHintGrounding.references.length,
        }),
      };
    }

    return {
      grounding: null,
      attempt: buildAttempt({
        status: "failed",
        source: "customgpt",
        reason: `CustomGPT request failed.${
          error instanceof Error ? ` ${error.message}` : ""
        }`.trim(),
        referenceCount: 0,
      }),
    };
  }
}

function addProactiveStudyContext(
  utterance: string,
  grounding: ProactiveStudyGrounding | null,
  attempt: ProactiveStudyGroundingAttempt | null,
) {
  if (!grounding) {
    return utterance;
  }

  const contextLabel =
    attempt?.source === "imported_guide"
      ? "Source-context note from imported guide:"
      : "Source-grounded context from approved material:";

  return [
    contextLabel,
    "",
    grounding.answer,
    "",
    "Survey question:",
    utterance,
  ].join("\n");
}

async function buildInterviewerTurnDraft(
  input: BuildInterviewerTurnInput,
): Promise<InterviewerTurnDraft> {
  const currentAction = findActionForNode(input.study, input.selectedNode.id);
  const assetContext = findAssetContext(
    input.study,
    currentAction?.id,
    input.sessionAssets,
  );

  const phrasingInput = buildInterviewerPhrasingInput({
    sessionId: input.sessionId,
    selectedQuestion: {
      id: input.selectedNode.id,
      title: input.selectedNode.title,
      prompt: input.selectedNode.prompt,
      tags: input.selectedNode.config?.factKeys,
      isTerminal: input.selectedNode.isTerminal,
    },
    selectionAction: input.selectionAction,
    analysis: input.analysis,
    assetTitle: assetContext?.asset.title ?? null,
  });
  const fallbackUtterance = buildFallbackInterviewerUtterance(phrasingInput);
  const proactiveGroundingResult = await getProactiveStudyGroundingResult(
    input,
    assetContext?.asset.title ?? null,
  );
  const proactiveGrounding = proactiveGroundingResult.grounding;
  const proactiveGroundingAttempt = proactiveGroundingResult.attempt;

  if (
    input.selectionAction === "redirect" &&
    input.analysis?.turnIntent === "clarification_question" &&
    input.analysis.groundedResponse
  ) {
    return {
      content: fallbackUtterance,
    };
  }

  if (input.selectionAction === "close") {
    return {
      content: fallbackUtterance,
    };
  }

  const withGroundingPayload = (utterance: string) => {
    const payload = {
      ...(proactiveGroundingAttempt
        ? { proactiveGroundingAttempt }
        : {}),
      ...(proactiveGrounding
        ? {
            proactiveGrounding: {
              kind: "clinical_study_context",
              answer: proactiveGrounding.answer,
              references: proactiveGrounding.references,
              contextQuestion: proactiveGrounding.contextQuestion,
              assetTitle: proactiveGrounding.assetTitle,
              generatedAt: proactiveGrounding.generatedAt,
            },
          }
        : {}),
    } satisfies Prisma.InputJsonObject;

    return {
      content: addProactiveStudyContext(
        utterance,
        proactiveGrounding,
        proactiveGroundingAttempt,
      ),
      ...(Object.keys(payload).length > 0 ? { payload } : {}),
    };
  };

  const gateway = getOptionalOpenAIGateway();
  if (!gateway) {
    return withGroundingPayload(fallbackUtterance);
  }

  try {
    const phrasing = await gateway.phraseNextQuestion(phrasingInput);

    return withGroundingPayload(phrasing.result.utterance);
  } catch {
    return withGroundingPayload(fallbackUtterance);
  }
}

async function loadSession(sessionId: string) {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      study: {
        include: {
          modules: {
            orderBy: { position: "asc" },
          },
          assets: {
            orderBy: { position: "asc" },
          },
          actions: {
            orderBy: { priority: "asc" },
          },
          actionRules: {
            orderBy: { priority: "asc" },
          },
          assetStageRules: {
            orderBy: { priority: "asc" },
          },
          questionNodes: {
            orderBy: { position: "asc" },
          },
        },
      },
      respondent: true,
      sessionAssets: {
        include: {
          asset: true,
          sourceAction: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      turns: {
        include: {
          node: true,
        },
        orderBy: {
          sequence: "asc",
        },
      },
      analyses: {
        orderBy: {
          createdAt: "asc",
        },
      },
      decisions: {
        include: {
          selectedNode: true,
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      assetReactions: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!session) {
    throw new Error(`Session ${sessionId} was not found.`);
  }

  return session;
}

function toRespondentSessionView(session: LoadedSession) {
  const sessionState = enrichSessionStateWithActionContext(
    getSessionStateFromMetadata(session),
    session.study,
    session.sessionAssets,
  );
  const currentQuestionTurn =
    sessionState.status === "active"
      ? [...session.turns]
          .reverse()
          .find((turn) => turn.role === TurnRole.INTERVIEWER)
      : null;
  const currentAction = sessionState.currentActionId
    ? (session.study.actions.find(
        (action) => action.id === sessionState.currentActionId,
      ) ?? null)
    : currentQuestionTurn?.nodeId
      ? findActionForNode(session.study, currentQuestionTurn.nodeId)
      : null;
  const currentAsset = findAssetContext(
    session.study,
    currentAction?.id,
    session.sessionAssets,
  );
  const currentAssetReaction = currentAsset
    ? findLatestAssetReaction(session.assetReactions, currentAsset.asset.id)
    : null;
  const timing = getLiveSessionTiming(sessionState);

  return respondentSessionResponseSchema.parse({
    sessionId: session.id,
    studyId: session.studyId,
    studyName: session.study.name,
    status: sessionState.status,
    capabilities: buildRespondentCapabilities(session.study),
    timing,
    transcript: session.turns.map((turn) => ({
      id: turn.id,
      role:
        turn.role === TurnRole.INTERVIEWER
          ? "interviewer"
          : turn.role === TurnRole.PARTICIPANT
            ? "participant"
            : "system",
      content: turn.content,
      createdAt: turn.createdAt.toISOString(),
      nodeKey: turn.node?.key ?? null,
      grounding: getRespondentTranscriptGrounding(session, turn),
    })),
    currentQuestion:
      sessionState.status === "active" && currentQuestionTurn?.node
        ? {
            nodeId: currentQuestionTurn.node.id,
            nodeKey: currentQuestionTurn.node.key,
            title: currentQuestionTurn.node.title,
            prompt: getRespondentCurrentQuestionPrompt(
              session,
              currentQuestionTurn,
            ),
            attemptCount:
              sessionState.attemptCountsByNodeId[currentQuestionTurn.node.id] ??
              0,
            maxAttempts: getRespondentViewMaxAttempts(
              currentQuestionTurn.node,
              sessionState.maxAttemptsPerNode,
            ),
          }
        : null,
    currentAction: currentAction
      ? {
          id: currentAction.id,
          key: currentAction.key,
          actionType: currentAction.actionType,
        }
      : null,
    currentAsset: currentAsset
      ? {
          id: currentAsset.asset.id,
          key: currentAsset.asset.key,
          title: currentAsset.asset.title,
          description: currentAsset.asset.description ?? null,
          assetType: currentAsset.asset.assetType,
          storageKey: currentAsset.asset.storageKey,
          mimeType: currentAsset.asset.mimeType ?? null,
          displayMode: currentAsset.displayMode,
          shownAt: currentAsset.shownAt?.toISOString() ?? null,
          reaction: toAssetReactionSummary(currentAssetReaction),
        }
      : null,
    thankYouMessage:
      sessionState.status === "completed"
        ? "Thanks for completing the interview. Your responses have been captured."
        : null,
  });
}

export async function listStudies() {
  const studies = await prisma.study.findMany({
    include: {
      _count: {
        select: {
          sessions: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return studies.map((study) => toStudySummary(study, study._count.sessions));
}

function buildAdaptiveFlowSummary(study: LoadedStudyDesign) {
  const conditionalRules = study.branchRules.filter(
    (rule) => rule.conditionType !== "ALWAYS",
  );
  const conditionalSourceNodeIds = new Set(
    conditionalRules.map((rule) => rule.fromNodeId),
  );
  const fallbackRules = study.branchRules.filter(
    (rule) =>
      rule.conditionType === "ALWAYS" &&
      (conditionalSourceNodeIds.has(rule.fromNodeId) ||
        /fallback|conditions do not match/i.test(rule.rationale ?? "")),
  );
  const sequentialRules = study.branchRules.filter(
    (rule) =>
      rule.conditionType === "ALWAYS" &&
      !fallbackRules.some((fallbackRule) => fallbackRule.id === rule.id),
  );
  const terminalNodeCount = study.questionNodes.filter(
    (node) => node.isTerminal || node.nodeType === "CLOSE",
  ).length;
  const warnings: string[] = [];

  if (study.questionNodes.length > 1 && study.branchRules.length === 0) {
    warnings.push("This study has multiple questions but no branch rules.");
  }

  if (terminalNodeCount === 0) {
    warnings.push("This study has no terminal or wrap-up node.");
  }

  for (const sourceNodeId of conditionalSourceNodeIds) {
    const hasFallback = study.branchRules.some(
      (rule) =>
        rule.fromNodeId === sourceNodeId && rule.conditionType === "ALWAYS",
    );
    if (!hasFallback) {
      const sourceNode = study.questionNodes.find(
        (node) => node.id === sourceNodeId,
      );
      warnings.push(
        `Conditional branches from ${sourceNode?.key ?? sourceNodeId} have no fallback route.`,
      );
    }
  }

  for (const rule of conditionalRules) {
    if (!rule.factKey || rule.comparisonValue === null) {
      warnings.push(`Conditional rule ${rule.id} is missing match criteria.`);
    }
  }

  return {
    totalRules: study.branchRules.length,
    conditionalRules: conditionalRules.length,
    fallbackRules: fallbackRules.length,
    sequentialRules: sequentialRules.length,
    terminalNodeCount,
    warnings,
  };
}

function getQuestionNodeConfig(
  node: LoadedStudyDesign["questionNodes"][number],
) {
  return node.config &&
    typeof node.config === "object" &&
    !Array.isArray(node.config)
    ? (node.config as Prisma.JsonObject)
    : {};
}

function sourceLineFromQuestionNodeConfig(
  node: LoadedStudyDesign["questionNodes"][number],
) {
  const config = getQuestionNodeConfig(node);
  return typeof config.sourceLine === "number" && config.sourceLine > 0
    ? Math.trunc(config.sourceLine)
    : null;
}

function inferBranchSuggestionKeywords(prompt: string) {
  const lower = prompt.toLowerCase();
  const categoryRules: Array<{
    pattern: RegExp;
    keywords: string[];
  }> = [
    {
      pattern:
        /\bpositive|favorable|confidence|confident|supports|consideration|established|familiar\b/i,
      keywords: ["positive", "favorable", "confident"],
    },
    {
      pattern:
        /\bconcern|barrier|pause|limits?|limitation|hesitation|uncertain|uncertainty\b/i,
      keywords: ["concern", "pause", "barrier", "hesitation", "uncertain"],
    },
    {
      pattern: /\bneed|understand|context|proof|evidence|before\b/i,
      keywords: ["need", "understand", "proof"],
    },
    {
      pattern: /\befficacy|pfs|orr|response|durability|endpoint\b/i,
      keywords: ["efficacy", "pfs", "response"],
    },
    {
      pattern:
        /\bsafety|afib|bleeding|hypertension|adverse|tolerability|infection\b/i,
      keywords: ["safety", "bleeding", "tolerability"],
    },
    {
      pattern:
        /\bpatient[-\s]?fit|patient factors?|fit|age|cardiac|comorbid|anticoagulation|adherence\b/i,
      keywords: ["patient fit", "comorbidity", "cardiac"],
    },
    {
      pattern:
        /\baccess|coverage|cost|affordability|specialty pharmacy|payer\b/i,
      keywords: ["access", "coverage", "cost"],
    },
    {
      pattern:
        /\bdosing|dose|monitoring|practical|logistics|drug interaction\b/i,
      keywords: ["dosing", "monitoring", "drug interaction"],
    },
    {
      pattern: /\bguideline|nccn|positioning\b/i,
      keywords: ["guideline", "nccn", "positioning"],
    },
  ];

  const matchedCategories = categoryRules.filter((rule) =>
    rule.pattern.test(prompt),
  );
  const matchedKeywords: string[] = [];
  const maxKeywordCount = Math.max(
    0,
    ...matchedCategories.map((rule) => rule.keywords.length),
  );

  for (let index = 0; index < maxKeywordCount; index += 1) {
    for (const category of matchedCategories) {
      const keyword = category.keywords[index];
      if (keyword) {
        matchedKeywords.push(keyword);
      }
    }
  }

  if (matchedKeywords.length > 0) {
    return {
      keywords: Array.from(new Set(matchedKeywords)).slice(0, 6),
      confidence: 0.74,
      source: "optional_followup_cluster" as const,
    };
  }

  const stopWords = new Set([
    "about",
    "before",
    "first",
    "follow",
    "which",
    "would",
    "could",
    "should",
    "there",
    "their",
    "with",
    "your",
    "what",
    "that",
    "this",
    "from",
    "does",
    "feel",
    "most",
  ]);
  const keywords = lower
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 4 && !stopWords.has(word))
    .slice(0, 4);

  return {
    keywords: Array.from(
      new Set(keywords.length > 0 ? keywords : ["relevant"]),
    ),
    confidence: 0.52,
    source: "prompt_keyword" as const,
  };
}

function buildBranchSuggestionSampleAnswer(keywords: string[]) {
  const visibleKeywords = keywords.slice(0, 3);
  if (visibleKeywords.length === 0) {
    return "This answer mentions a relevant theme for the follow-up.";
  }

  if (visibleKeywords.length === 1) {
    return `This answer focuses on ${visibleKeywords[0]}.`;
  }

  if (visibleKeywords.length === 2) {
    return `This answer focuses on ${visibleKeywords[0]} and ${visibleKeywords[1]}.`;
  }

  return `This answer focuses on ${visibleKeywords[0]}, ${visibleKeywords[1]}, and ${visibleKeywords[2]}.`;
}

function branchComparisonValues(value: Prisma.JsonValue | null | undefined) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim().toLowerCase())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return [value.trim().toLowerCase()].filter(Boolean);
  }

  if (value === null || value === undefined) {
    return [];
  }

  return [String(value).trim().toLowerCase()].filter(Boolean);
}

function buildRouteReview(study: LoadedStudyDesign) {
  const nodeById = new Map(study.questionNodes.map((node) => [node.id, node]));
  const rulesBySource = new Map<
    string,
    LoadedStudyDesign["branchRules"][number][]
  >();

  for (const rule of study.branchRules) {
    const rules = rulesBySource.get(rule.fromNodeId) ?? [];
    rules.push(rule);
    rulesBySource.set(rule.fromNodeId, rules);
  }

  return Array.from(rulesBySource.entries())
    .map(([fromNodeId, rules]) => {
      const fromNode = nodeById.get(fromNodeId);
      if (!fromNode) {
        return null;
      }

      const orderedRules = [...rules].sort((left, right) => {
        if (left.priority !== right.priority) {
          return left.priority - right.priority;
        }

        return left.toNodeId.localeCompare(right.toNodeId);
      });
      const toReviewRoute = (
        rule: LoadedStudyDesign["branchRules"][number],
      ) => {
        const toNode = nodeById.get(rule.toNodeId);
        if (!toNode) {
          return null;
        }

        const comparisonCount = branchComparisonValues(
          rule.comparisonValue ?? null,
        ).length;
        const supportedCondition =
          rule.conditionType === "ALWAYS" ||
          rule.conditionType === "ANSWER_CONTAINS" ||
          rule.conditionType === "ANSWER_EQUALS";
        const dryRunnable =
          rule.conditionType === "ALWAYS" ||
          (supportedCondition && Boolean(rule.factKey) && comparisonCount > 0);
        const dryRunReason =
          rule.conditionType === "ALWAYS"
            ? "Fallback route can be tested when no conditional route matches."
            : !supportedCondition
              ? `${rule.conditionType} is not supported by the route tester.`
              : !rule.factKey
                ? "Missing routing fact key."
                : comparisonCount === 0
                  ? "Missing comparison values."
                  : "Can be tested with a sample answer.";

        return {
          ruleId: rule.id,
          toNodeId: toNode.id,
          toNodeKey: toNode.key,
          toNodeTitle: toNode.title,
          conditionType: rule.conditionType,
          factKey: rule.factKey ?? null,
          comparisonValue: rule.comparisonValue ?? null,
          priority: rule.priority,
          rationale: rule.rationale ?? null,
          dryRunnable,
          dryRunReason,
        };
      };
      const conditionalRoutes = orderedRules
        .filter((rule) => rule.conditionType !== "ALWAYS")
        .map(toReviewRoute)
        .filter((route): route is NonNullable<typeof route> => route !== null);
      if (conditionalRoutes.length === 0) {
        return null;
      }

      const fallbackRoute =
        orderedRules
          .filter((rule) => rule.conditionType === "ALWAYS")
          .map(toReviewRoute)
          .find(
            (route): route is NonNullable<typeof route> => route !== null,
          ) ?? null;
      const dryRunnableConditionalCount = conditionalRoutes.filter(
        (route) => route.dryRunnable,
      ).length;
      const warning =
        conditionalRoutes.length > 0 && !fallbackRoute
          ? "Conditional source has no fallback route."
          : conditionalRoutes.some((route) => !route.dryRunnable)
            ? "Some conditional routes are missing tester-ready match criteria."
            : null;

      return {
        fromNodeId: fromNode.id,
        fromNodeKey: fromNode.key,
        fromNodeTitle: fromNode.title,
        conditionalRoutes,
        fallbackRoute,
        hasFallback: Boolean(fallbackRoute),
        dryRunnableConditionalCount,
        warning,
      };
    })
    .filter((group): group is NonNullable<typeof group> => group !== null);
}

function buildBranchSuggestions(study: LoadedStudyDesign) {
  const maxSuggestions = 120;
  const maxSuggestionsPerSource = 6;
  const orderedNodes = [...study.questionNodes].sort((left, right) => {
    if (left.position !== right.position) {
      return left.position - right.position;
    }

    return left.title.localeCompare(right.title);
  });
  const hasConditionalRoute = new Set(
    study.branchRules
      .filter((rule) => rule.conditionType !== "ALWAYS")
      .map((rule) => `${rule.fromNodeId}:${rule.toNodeId}`),
  );
  const suggestions: Array<{
    id: string;
    fromNodeId: string;
    fromNodeKey: string;
    fromNodeTitle: string;
    toNodeId: string;
    toNodeKey: string;
    toNodeTitle: string;
    matchKeywords: string[];
    sampleAnswer: string;
    rationale: string;
    confidence: number;
    source: "optional_followup_cluster" | "prompt_keyword";
    recommended: boolean;
    recommendedReason: string | null;
  }> = [];

  for (let index = 0; index < orderedNodes.length; index += 1) {
    const sourceNode = orderedNodes[index];
    if (
      !sourceNode ||
      sourceNode.isTerminal ||
      sourceNode.nodeType === "CLOSE"
    ) {
      continue;
    }

    const sourceConfig = getQuestionNodeConfig(sourceNode);
    if (sourceConfig.mustAsk !== true && !sourceNode.isEntry) {
      continue;
    }

    let sourceSuggestionCount = 0;
    for (
      let nextIndex = index + 1;
      nextIndex < orderedNodes.length;
      nextIndex += 1
    ) {
      const targetNode = orderedNodes[nextIndex];
      if (!targetNode) {
        continue;
      }

      const targetConfig = getQuestionNodeConfig(targetNode);
      if (
        targetNode.isTerminal ||
        targetNode.nodeType === "CLOSE" ||
        targetConfig.mustAsk === true
      ) {
        break;
      }

      if (hasConditionalRoute.has(`${sourceNode.id}:${targetNode.id}`)) {
        continue;
      }

      const inferred = inferBranchSuggestionKeywords(targetNode.prompt);
      const recommended =
        inferred.source === "optional_followup_cluster" &&
        inferred.confidence >= 0.7;
      suggestions.push({
        id: `${sourceNode.id}-${targetNode.id}`,
        fromNodeId: sourceNode.id,
        fromNodeKey: sourceNode.key,
        fromNodeTitle: sourceNode.title,
        toNodeId: targetNode.id,
        toNodeKey: targetNode.key,
        toNodeTitle: targetNode.title,
        matchKeywords: inferred.keywords,
        sampleAnswer: buildBranchSuggestionSampleAnswer(inferred.keywords),
        rationale: `Route to "${targetNode.title}" when the answer to "${sourceNode.title}" suggests ${inferred.keywords.join(", ")}.`,
        confidence: inferred.confidence,
        source: inferred.source,
        recommended,
        recommendedReason: recommended
          ? "Higher-confidence follow-up cluster inferred from the question wording."
          : null,
      });

      sourceSuggestionCount += 1;
      if (
        sourceSuggestionCount >= maxSuggestionsPerSource ||
        suggestions.length >= maxSuggestions
      ) {
        break;
      }
    }

    if (suggestions.length >= maxSuggestions) {
      break;
    }
  }

  return suggestions;
}

function findAssetTitleForNode(study: LoadedStudyDesign, nodeId: string) {
  const askAction = study.actions.find(
    (action) =>
      action.nodeId === nodeId && action.actionType === "ASK_QUESTION",
  );

  if (!askAction) {
    return null;
  }

  const incomingShowAssetAction =
    study.actionRules.find((rule) => {
      if (rule.toActionId !== askAction.id || !rule.fromActionId) {
        return false;
      }

      const sourceAction = study.actions.find(
        (action) => action.id === rule.fromActionId,
      );
      return sourceAction?.actionType === "SHOW_ASSET" && sourceAction.assetId;
    }) ?? null;

  if (!incomingShowAssetAction?.fromActionId) {
    return null;
  }

  const assetId =
    study.actions.find(
      (action) => action.id === incomingShowAssetAction.fromActionId,
    )?.assetId ??
    study.assetStageRules.find(
      (rule) => rule.triggerActionId === incomingShowAssetAction.fromActionId,
    )?.assetId ??
    null;

  return assetId
    ? (study.assets.find((asset) => asset.id === assetId)?.title ?? null)
    : null;
}

async function getStudySessionSummary(studyId: string) {
  const grouped = await prisma.session.groupBy({
    by: ["status"],
    where: { studyId },
    _count: {
      _all: true,
    },
  });
  const countByStatus = new Map(
    grouped.map((item) => [item.status, item._count._all]),
  );
  const activeSessionCount = countByStatus.get(SessionStatus.ACTIVE) ?? 0;
  const pendingSessionCount = countByStatus.get(SessionStatus.PENDING) ?? 0;
  const completedSessionCount = countByStatus.get(SessionStatus.COMPLETED) ?? 0;
  const abandonedSessionCount = countByStatus.get(SessionStatus.ABANDONED) ?? 0;

  return {
    totalSessionCount: grouped.reduce(
      (total, item) => total + item._count._all,
      0,
    ),
    activeSessionCount,
    pendingSessionCount,
    completedSessionCount,
    abandonedSessionCount,
    openSessionCount: activeSessionCount + pendingSessionCount,
  };
}

export async function getStudyGraph(studyId: string) {
  const { study, compiledStudy } = await loadCompiledStudy(studyId);
  const [recentSessions, sessionSummary] = await Promise.all([
    prisma.session.findMany({
      where: { studyId },
      include: {
        respondent: true,
        turns: {
          select: { id: true },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 8,
    }),
    getStudySessionSummary(studyId),
  ]);

  const guideCleanupNodes = findScriptedResponseImportNodes({
    modules: study.modules,
    questionNodes: study.questionNodes,
  });
  const guideCleanupNodeIds = new Set(
    guideCleanupNodes.map((item) => item.node.id),
  );
  const graphNodes = study.questionNodes.map((node) => {
    const module = study.modules.find((item) => item.id === node.moduleId);
    const config =
      node.config &&
      typeof node.config === "object" &&
      !Array.isArray(node.config)
        ? (node.config as Prisma.JsonObject)
        : {};

    const sourceContextRequirement = resolveGroundedStudyContextRequirement({
      prompt: node.prompt,
      requiresGroundedStudyContext: config.requiresGroundedStudyContext,
    });

    return {
      id: node.id,
      key: node.key,
      title: node.title,
      prompt: node.prompt,
      nodeType: node.nodeType,
      moduleId: node.moduleId,
      moduleKey: module?.key ?? null,
      moduleTitle: module?.title ?? null,
      isEntry: node.isEntry,
      isTerminal: node.isTerminal,
      mustAsk: config.mustAsk === true,
      requiresGroundedStudyContext:
        sourceContextRequirement.requiresGroundedStudyContext,
      sourceContextDetected: sourceContextRequirement.detectedByPrompt,
      sourceContextOverride: sourceContextRequirement.sourceContextOverride,
      sourceContextHint:
        typeof config.sourceContextHint === "string" &&
        config.sourceContextHint.trim()
          ? config.sourceContextHint.trim()
          : null,
      sourceContextReferences: sourceContextReferencesFromConfig(config),
      position: node.position,
    };
  });
  const sourceContextReviewNodes = graphNodes.filter(
    (node) => !guideCleanupNodeIds.has(node.id),
  );
  const sourceContextQuestions = sourceContextReviewNodes.filter(
    (node) => node.requiresGroundedStudyContext,
  );
  const referencedApprovedNoteQuestionCount = sourceContextQuestions.filter(
    (node) =>
      Boolean(node.sourceContextHint) &&
      node.sourceContextReferences.length > 0,
  ).length;
  const missingReferencedDetailQuestionCount = Math.max(
    0,
    sourceContextQuestions.length - referencedApprovedNoteQuestionCount,
  );

  return studyGraphResponseSchema.parse({
    study: toStudySummary(study, recentSessions.length),
    modules: study.modules.map((module) => ({
      id: module.id,
      key: module.key,
      title: module.title,
      position: module.position,
    })),
    nodes: graphNodes,
    edges: study.branchRules.map((rule) => ({
      id: rule.id,
      fromNodeId: rule.fromNodeId,
      toNodeId: rule.toNodeId,
      conditionType: rule.conditionType,
      factKey: rule.factKey ?? null,
      comparisonValue: rule.comparisonValue ?? null,
      priority: rule.priority,
      rationale: rule.rationale ?? null,
    })),
    assets: study.assets.map((asset) => ({
      id: asset.id,
      key: asset.key,
      title: asset.title,
      description: asset.description ?? null,
      assetType: asset.assetType,
      mimeType: asset.mimeType ?? null,
      storageKey: asset.storageKey,
      position: asset.position,
    })),
    actions: study.actions.map((action) => ({
      id: action.id,
      key: action.key,
      actionType: action.actionType,
      moduleId: action.moduleId,
      nodeId: action.nodeId,
      nodeKey:
        study.questionNodes.find((node) => node.id === action.nodeId)?.key ??
        null,
      assetId: action.assetId,
      assetKey:
        study.assets.find((asset) => asset.id === action.assetId)?.key ?? null,
      goal: action.goal ?? null,
      mustComplete: action.mustComplete,
      priority: action.priority,
    })),
    assetStageRules: study.assetStageRules.map((rule) => ({
      id: rule.id,
      assetId: rule.assetId,
      assetKey:
        study.assets.find((asset) => asset.id === rule.assetId)?.key ??
        rule.assetId,
      triggerActionId: rule.triggerActionId,
      triggerActionKey:
        study.actions.find((action) => action.id === rule.triggerActionId)
          ?.key ?? null,
      triggerType: rule.triggerType,
      displayMode: rule.displayMode,
      required: rule.required,
      priority: rule.priority,
      rationale: rule.rationale ?? null,
    })),
    adaptiveFlow: buildAdaptiveFlowSummary(study),
    sourceContext: {
      enabledQuestionCount: sourceContextQuestions.length,
      detectedQuestionCount: sourceContextReviewNodes.filter(
        (node) => node.sourceContextDetected,
      ).length,
      overrideEnabledCount: sourceContextReviewNodes.filter(
        (node) => node.sourceContextOverride === true,
      ).length,
      overrideDisabledCount: sourceContextReviewNodes.filter(
        (node) => node.sourceContextOverride === false,
      ).length,
      referencedApprovedNoteQuestionCount,
      missingReferencedDetailQuestionCount,
      importedHintQuestionCount: referencedApprovedNoteQuestionCount,
      missingImportedHintQuestionCount: missingReferencedDetailQuestionCount,
      questions: sourceContextQuestions.map((node) => ({
        nodeId: node.id,
        nodeKey: node.key,
        title: node.title,
        prompt: node.prompt,
        moduleTitle: node.moduleTitle,
        sourceContextDetected: node.sourceContextDetected,
        sourceContextOverride: node.sourceContextOverride,
        sourceContextHint: node.sourceContextHint,
        sourceContextReferences: node.sourceContextReferences,
        assetTitle: findAssetTitleForNode(study, node.id),
      })),
    },
    branchSuggestions: buildBranchSuggestions(study),
    routeReview: buildRouteReview(study),
    guideCleanup: {
      scriptedResponseNodeCount: guideCleanupNodes.length,
      scriptedResponseNodes: guideCleanupNodes.map((item) => ({
        nodeId: item.node.id,
        nodeKey: item.node.key,
        title: item.node.title,
        prompt: item.node.prompt,
        moduleTitle: item.module?.title ?? null,
        reason: item.reason,
        sourceLine: sourceLineFromQuestionNodeConfig(item.node),
        retainedSourceContextHint:
          extractSourceContextHintFromScriptedResponsePrompt(item.node.prompt),
      })),
    },
    sessionSummary,
    recentSessions: recentSessions.map((session) => {
      const sessionState = getSessionStateFromMetadata(
        {
          id: session.id,
          studyId: session.studyId,
          metadata: session.metadata,
        },
        compiledStudy,
      );

      return {
        id: session.id,
        status: session.status,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        respondentLabel:
          session.respondent?.externalRef ??
          `test-session-${session.id.slice(0, 6)}`,
        turnCount: session.turns.length,
        currentNodeKey: sessionState.currentNodeKey,
      };
    }),
  });
}

function buildDirectTestStart(input: {
  compiledStudy: Awaited<ReturnType<typeof loadCompiledStudy>>["compiledStudy"];
  sessionId: string;
  startNodeId: string;
}) {
  const startNode = input.compiledStudy.nodeById.get(input.startNodeId);
  if (!startNode) {
    throw new Error(`Start question ${input.startNodeId} was not found.`);
  }

  if (startNode.isTerminal || startNode.nodeType === "CLOSE") {
    throw new Error("Test sessions cannot start from a terminal question.");
  }

  const startIndex =
    input.compiledStudy.orderIndexByNodeId.get(startNode.id) ?? 0;
  const completedNodeIds = input.compiledStudy.nodesInOrder
    .slice(0, startIndex)
    .map((node) => node.id);
  const completedNodeIdSet = new Set(completedNodeIds);
  const baseState = createSessionState(input.compiledStudy, input.sessionId);
  const selection: DeterministicSelection = {
    action: "ask",
    rule: "entry",
    rationale: `Test session launched directly at "${startNode.title}".`,
    selectedNodeId: startNode.id,
    selectedNodeKey: startNode.key,
    source: "deterministic",
    contradictions: [],
  };

  return {
    startNode,
    committed: commitSelection(
      sessionStateJsonSchema.parse({
        ...baseState,
        completedNodeIds,
        pendingMustAskNodeIds: input.compiledStudy.mustAskNodeIds.filter(
          (nodeId) => !completedNodeIdSet.has(nodeId),
        ),
        history:
          completedNodeIds.length > 0
            ? [
                {
                  role: "system",
                  content: `Test session skipped ${completedNodeIds.length} earlier question(s) and started at "${startNode.title}".`,
                },
              ]
            : baseState.history,
      }),
      selection,
    ),
  };
}

type StartSurveySessionMode = "test" | "fielding";

async function startSurveySession(
  studyId: string,
  input: StartTestSessionRequest = {},
  mode: StartSurveySessionMode = "test",
) {
  const { study, compiledStudy } = await loadCompiledStudy(studyId);
  const startNodeId =
    mode === "test" ? input.startNodeId?.trim() || null : null;
  const requestedStartNode = startNodeId
    ? compiledStudy.nodeById.get(startNodeId)
    : null;

  if (startNodeId && !requestedStartNode) {
    throw new Error(`Start question ${startNodeId} was not found.`);
  }

  if (
    requestedStartNode &&
    (requestedStartNode.isTerminal || requestedStartNode.nodeType === "CLOSE")
  ) {
    throw new Error("Test sessions cannot start from a terminal question.");
  }

  const respondent = await prisma.respondent.create({
    data: {
      studyId,
      externalRef:
        mode === "fielding"
          ? `respondent-${Date.now()}`
          : startNodeId
            ? `test-${Date.now()}-from-${startNodeId.slice(-6)}`
            : `test-${Date.now()}`,
      profile: {
        mode,
        startNodeId,
      },
    },
  });

  const baseSession = await prisma.session.create({
    data: {
      studyId,
      respondentId: respondent.id,
      status: SessionStatus.ACTIVE,
      startedAt: new Date(),
      metadata: {},
    },
  });

  const directStart = startNodeId
    ? buildDirectTestStart({
        compiledStudy,
        sessionId: baseSession.id,
        startNodeId,
      })
    : null;
  const initialPrepared = directStart
    ? null
    : prepareDecisionTurn({
        compiledStudy,
        sessionState: createSessionState(compiledStudy, baseSession.id),
      });

  if (!directStart) {
    if (
      !initialPrepared?.deterministicSelection ||
      initialPrepared.deterministicSelection.action === "close"
    ) {
      throw new Error(`Study ${study.name} has no valid entry question.`);
    }
  }

  const committed = directStart
    ? directStart.committed
    : commitSelection(
        initialPrepared!.sessionState,
        initialPrepared!.deterministicSelection as DeterministicSelection,
      );
  const committedSessionState = enrichSessionStateWithActionContext(
    committed.sessionState,
    study,
    [],
  );

  if (!committed.selection.selectedNodeId) {
    throw new Error("Unable to resolve the initial interviewer question.");
  }

  const currentNode = compiledStudy.nodeById.get(
    committed.selection.selectedNodeId,
  );
  if (!currentNode) {
    throw new Error("Unable to resolve the initial interviewer question.");
  }

  const initialAction = findActionForNode(study, currentNode.id);
  const initialAssetContext = findAssetContext(study, initialAction?.id, []);
  const initialInterviewerTurnId = randomUUID();
  const initialInterviewerTurnDraft = await buildInterviewerTurnDraft({
    sessionId: baseSession.id,
    study,
    selectedNode: {
      id: currentNode.id,
      moduleId: currentNode.moduleId,
      title: currentNode.title,
      prompt: currentNode.prompt,
      config: currentNode.config,
      isTerminal: currentNode.isTerminal,
    },
    selectionAction: committed.selection.action,
    analysis: null,
    sessionAssets: [],
  });

  await prisma.$transaction([
    prisma.session.update({
      where: { id: baseSession.id },
      data: {
        metadata: withSessionStateMetadata(
          baseSession.metadata,
          committedSessionState,
        ),
        status: SessionStatus.ACTIVE,
      },
    }),
    prisma.turn.create({
      data: {
        id: initialInterviewerTurnId,
        studyId,
        sessionId: baseSession.id,
        nodeId: currentNode.id,
        sequence: 1,
        role: TurnRole.INTERVIEWER,
        content: initialInterviewerTurnDraft.content,
        payload: initialInterviewerTurnDraft.payload,
      },
    }),
    ...(initialAssetContext
      ? [
          prisma.sessionAsset.create({
            data: {
              id: randomUUID(),
              studyId,
              sessionId: baseSession.id,
              assetId: initialAssetContext.asset.id,
              sourceActionId: initialAssetContext.sourceAction.id,
              turnId: initialInterviewerTurnId,
              displayMode: initialAssetContext.displayMode ?? "INLINE_PANE",
              shownAt: new Date(),
              exposureMetadata: {
                source: "initial-stage",
                actionKey: initialAssetContext.sourceAction.key,
              },
            },
          }),
        ]
      : []),
  ]);

  const session = await loadSession(baseSession.id);
  return toRespondentSessionView(session);
}

export async function startTestSession(
  studyId: string,
  input: StartTestSessionRequest = {},
) {
  return startSurveySession(studyId, input, "test");
}

export async function startRespondentSession(studyId: string) {
  return startSurveySession(studyId, {}, "fielding");
}

export async function abandonStudyOpenSessions(studyId: string) {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const study = await tx.study.findUnique({
      where: { id: studyId },
      select: { id: true },
    });

    if (!study) {
      throw new Error(`Study ${studyId} was not found.`);
    }

    const [activeSessionCount, pendingSessionCount] = await Promise.all([
      tx.session.count({
        where: {
          studyId,
          status: SessionStatus.ACTIVE,
        },
      }),
      tx.session.count({
        where: {
          studyId,
          status: SessionStatus.PENDING,
        },
      }),
    ]);

    const updated = await tx.session.updateMany({
      where: {
        studyId,
        status: {
          in: [SessionStatus.ACTIVE, SessionStatus.PENDING],
        },
      },
      data: {
        status: SessionStatus.ABANDONED,
        completedAt: now,
      },
    });

    const remainingOpenSessionCount = await tx.session.count({
      where: {
        studyId,
        status: {
          in: [SessionStatus.ACTIVE, SessionStatus.PENDING],
        },
      },
    });

    return {
      activeSessionCount,
      pendingSessionCount,
      abandonedCount: updated.count,
      remainingOpenSessionCount,
    };
  });

  return abandonStudyOpenSessionsResponseSchema.parse({
    studyId,
    ...result,
  });
}

async function cleanupTemporarySmokeTestData(input: {
  sessionIds: string[];
  respondentIds: string[];
}) {
  const sessionIds = Array.from(new Set(input.sessionIds));
  const respondentIds = Array.from(new Set(input.respondentIds));

  if (sessionIds.length > 0) {
    await prisma.$transaction([
      prisma.assetReaction.deleteMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
        },
      }),
      prisma.sessionAsset.deleteMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
        },
      }),
      prisma.candidateAction.deleteMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
        },
      }),
      prisma.decision.deleteMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
        },
      }),
      prisma.analysis.deleteMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
        },
      }),
      prisma.artifact.deleteMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
        },
      }),
      prisma.turn.deleteMany({
        where: {
          sessionId: {
            in: sessionIds,
          },
        },
      }),
      prisma.session.deleteMany({
        where: {
          id: {
            in: sessionIds,
          },
        },
      }),
    ]);
  }

  if (respondentIds.length > 0) {
    await prisma.respondent.deleteMany({
      where: {
        id: {
          in: respondentIds,
        },
        sessions: {
          none: {},
        },
      },
    });
  }

  const [remainingSessionCount, remainingRespondentCount] = await Promise.all([
    sessionIds.length > 0
      ? prisma.session.count({
          where: {
            id: {
              in: sessionIds,
            },
          },
        })
      : Promise.resolve(0),
    respondentIds.length > 0
      ? prisma.respondent.count({
          where: {
            id: {
              in: respondentIds,
            },
          },
        })
      : Promise.resolve(0),
  ]);

  return remainingSessionCount === 0 && remainingRespondentCount === 0;
}

function firstSmokeRouteComparisonValue(value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }

    if (typeof item === "number" && Number.isFinite(item)) {
      return String(item);
    }
  }

  return null;
}

export async function runStudyLaunchSmokeTest(studyId: string) {
  const temporarySessionIds: string[] = [];
  const temporaryRespondentIds: string[] = [];
  let cleanedUp = false;
  let smokeResult: Omit<StudyLaunchSmokeTestResponse, "cleanedUp"> | null =
    null;
  const checks: Array<{
    key: string;
    label: string;
    status: "pass" | "warning" | "fail";
    detail: string;
  }> = [];

  try {
    const sessionView = await startTestSession(studyId);
    temporarySessionIds.push(sessionView.sessionId);
    const persistedSession = await prisma.session.findUnique({
      where: {
        id: sessionView.sessionId,
      },
      select: {
        id: true,
        studyId: true,
        metadata: true,
        respondentId: true,
      },
    });
    const initialSessionState = persistedSession
      ? getSessionStateFromMetadata(persistedSession)
      : null;
    if (persistedSession?.respondentId) {
      temporaryRespondentIds.push(persistedSession.respondentId);
    }

    checks.push({
      key: "session_started",
      label: "Session Started",
      status: sessionView.status === "active" ? "pass" : "fail",
      detail: `Temporary session status is ${sessionView.status}.`,
    });
    checks.push({
      key: "first_question",
      label: "First Question",
      status: sessionView.currentQuestion ? "pass" : "fail",
      detail: sessionView.currentQuestion
        ? `First question is ${sessionView.currentQuestion.title}.`
        : "No active first question was rendered.",
    });
    checks.push({
      key: "transcript",
      label: "Transcript",
      status: sessionView.transcript.length > 0 ? "pass" : "fail",
      detail:
        sessionView.transcript.length > 0
          ? `${sessionView.transcript.length} transcript turn(s) were created.`
          : "No interviewer transcript turn was created.",
    });
    checks.push({
      key: "attempt_guardrail",
      label: "No-Fixation Guardrail",
      status:
        sessionView.currentQuestion &&
        sessionView.currentQuestion.maxAttempts <= 2
          ? "pass"
          : "warning",
      detail: sessionView.currentQuestion
        ? `The live first question allows ${sessionView.currentQuestion.maxAttempts} attempt(s).`
        : "No current question was available to verify attempt limits.",
    });
    checks.push({
      key: "off_survey_guardrail",
      label: "Off-Survey Return Guardrail",
      status:
        initialSessionState && initialSessionState.maxOffTopicRedirects <= 2
          ? "pass"
          : "warning",
      detail: initialSessionState
        ? `The live session allows ${initialSessionState.maxOffTopicRedirects} off-survey redirect(s) before moving on.`
        : "No session state was available to verify off-survey redirect limits.",
    });
    if (sessionView.currentQuestion && initialSessionState) {
      try {
        const startingNodeKey = sessionView.currentQuestion.nodeKey;
        const simulatedTurnCount = Math.min(
          Math.max(initialSessionState.maxOffTopicRedirects, 1),
          3,
        );
        let latestSessionView = sessionView;

        for (let index = 0; index < simulatedTurnCount; index += 1) {
          latestSessionView = (
            await submitRespondentAnswer(
              sessionView.sessionId,
              index === 0
                ? "What is BRUKINSA?"
                : "Can you explain that again before I answer?",
            )
          ).session;
        }

        const latestQuestionKey =
          latestSessionView.currentQuestion?.nodeKey ?? null;
        const movedOffStartingQuestion =
          latestSessionView.status !== "active" ||
          latestQuestionKey !== startingNodeKey;

        checks.push({
          key: "off_survey_return_flow",
          label: "Off-Survey Return Flow",
          status: movedOffStartingQuestion ? "pass" : "fail",
          detail: movedOffStartingQuestion
            ? `After ${simulatedTurnCount} clarification-style turn(s), the session moved from ${startingNodeKey} to ${latestQuestionKey ?? latestSessionView.status}.`
            : `After ${simulatedTurnCount} clarification-style turn(s), the session was still on ${startingNodeKey}.`,
        });
      } catch (error) {
        checks.push({
          key: "off_survey_return_flow",
          label: "Off-Survey Return Flow",
          status: "fail",
          detail:
            error instanceof Error
              ? error.message
              : "Unable to smoke test off-survey return behavior.",
        });
      }
    } else {
      checks.push({
        key: "off_survey_return_flow",
        label: "Off-Survey Return Flow",
        status: "warning",
        detail:
          "No active first question or session state was available to run the off-survey return smoke test.",
      });
    }
    checks.push({
      key: "asset",
      label: "Side-Pane Asset",
      status: sessionView.currentAsset ? "pass" : "warning",
      detail: sessionView.currentAsset
        ? `${sessionView.currentAsset.title} is staged in the respondent side pane.`
        : "No side-pane asset is staged at interview start.",
    });
    checks.push({
      key: "recorded_voice",
      label: "Recorded Voice",
      status: sessionView.capabilities.recordedVoice.enabled
        ? "pass"
        : "warning",
      detail: sessionView.capabilities.recordedVoice.enabled
        ? "Recorded voice is available for this session."
        : (sessionView.capabilities.recordedVoice.reason ??
          "Recorded voice is unavailable."),
    });
    checks.push({
      key: "realtime_voice",
      label: "Realtime Voice",
      status: sessionView.capabilities.realtimeVoice.enabled
        ? "pass"
        : "warning",
      detail: sessionView.capabilities.realtimeVoice.enabled
        ? "Realtime voice is available for this session."
        : (sessionView.capabilities.realtimeVoice.reason ??
          "Realtime voice is unavailable."),
    });

    const sourceContextSmokeStudy = await prisma.study.findUnique({
      where: {
        id: studyId,
      },
      include: {
        modules: true,
        questionNodes: {
          where: {
            isTerminal: false,
          },
          orderBy: {
            position: "asc",
          },
        },
        branchRules: {
          orderBy: {
            priority: "asc",
          },
        },
      },
    });
    const sourceContextNodes = sourceContextSmokeStudy?.questionNodes ?? [];
    const sourceContextCleanupNodeIds = sourceContextSmokeStudy
      ? new Set(
          findScriptedResponseImportNodes({
            modules: sourceContextSmokeStudy.modules,
            questionNodes: sourceContextSmokeStudy.questionNodes,
          }).map((item) => item.node.id),
        )
      : new Set<string>();
    const sourceContextCandidates = sourceContextNodes
      .map((node) => {
        const config = asObject(node.config);

        return {
          node,
          config,
          requiresGroundedStudyContext: resolveGroundedStudyContextRequirement({
            prompt: node.prompt,
            requiresGroundedStudyContext: config.requiresGroundedStudyContext,
          }).requiresGroundedStudyContext,
        };
      })
      .filter(
        (candidate) =>
          candidate.requiresGroundedStudyContext &&
          !sourceContextCleanupNodeIds.has(candidate.node.id),
      );
    const sourceContextApprovedNoteQuestion =
      sourceContextCandidates.find(
        (candidate) => hasReferencedSourceContextNote(candidate.config),
      )?.node ?? null;
    const runtimeCustomGptSourceContextQuestion =
      sourceContextCandidates.find(
        (candidate) => !hasReferencedSourceContextNote(candidate.config),
      )?.node ?? null;
    const sourceContextCandidateByNodeId = new Map(
      sourceContextCandidates.map((candidate) => [
        candidate.node.id,
        candidate,
      ]),
    );
    const sourceContextNodeById = new Map(
      sourceContextNodes.map((node) => [node.id, node]),
    );
    const adaptiveSourceContextRoute =
      sourceContextSmokeStudy?.branchRules
        .filter(
          (rule) =>
            rule.conditionType !== "ALWAYS" &&
            sourceContextCandidateByNodeId.has(rule.toNodeId),
        )
        .map((rule) => ({
          rule,
          fromNode: sourceContextNodeById.get(rule.fromNodeId) ?? null,
          toCandidate: sourceContextCandidateByNodeId.get(rule.toNodeId) ?? null,
          sampleValue: firstSmokeRouteComparisonValue(rule.comparisonValue),
        }))
        .find(
          (candidate) =>
            candidate.fromNode &&
            candidate.toCandidate &&
            candidate.sampleValue &&
            !sourceContextCleanupNodeIds.has(candidate.fromNode.id),
        ) ?? null;

    const smokeTestSourceContextQuestion = async (
      sourceContextQuestion: (typeof sourceContextNodes)[number],
      check: { key: string; label: string },
    ) => {
      try {
        const sourceContextSessionView = await startTestSession(studyId, {
          startNodeId: sourceContextQuestion.id,
        });
        temporarySessionIds.push(sourceContextSessionView.sessionId);
        const sourceContextSession = await prisma.session.findUnique({
          where: {
            id: sourceContextSessionView.sessionId,
          },
          select: {
            respondentId: true,
          },
        });
        if (sourceContextSession?.respondentId) {
          temporaryRespondentIds.push(sourceContextSession.respondentId);
        }

        const sourceContextTurn = sourceContextSessionView.transcript.find(
          (turn) =>
            turn.nodeKey === sourceContextQuestion.key &&
            turn.role === "interviewer",
        );
        const grounding = sourceContextTurn?.grounding ?? null;
        const referenceCount = grounding?.references.length ?? 0;
        const sourceContextReady = Boolean(grounding && referenceCount > 0);
        const sourceContextDetail =
          grounding && referenceCount > 0
            ? `${sourceContextQuestion.title} returned ${referenceCount} reference(s) from ${grounding.kind}.`
            : grounding
              ? `${sourceContextQuestion.title} returned proactive source context but no references.`
              : `${sourceContextQuestion.title} did not return proactive source context for the respondent turn. ${
                  sourceContextSessionView.capabilities.customGptGrounding
                    .reason ?? ""
                }`.trim();

        checks.push({
          key: check.key,
          label: check.label,
          status: sourceContextReady ? "pass" : "fail",
          detail: sourceContextDetail,
        });
      } catch (error) {
        checks.push({
          key: check.key,
          label: check.label,
          status: "fail",
          detail:
            error instanceof Error
              ? error.message
              : "Unable to smoke test proactive source context.",
        });
      }
    };

    if (adaptiveSourceContextRoute) {
      const route = adaptiveSourceContextRoute;
      const sourceContextQuestion = route.toCandidate!.node;
      try {
        const routeSessionView = await startTestSession(studyId, {
          startNodeId: route.fromNode!.id,
        });
        temporarySessionIds.push(routeSessionView.sessionId);
        const routeSession = await prisma.session.findUnique({
          where: {
            id: routeSessionView.sessionId,
          },
          select: {
            respondentId: true,
          },
        });
        if (routeSession?.respondentId) {
          temporaryRespondentIds.push(routeSession.respondentId);
        }

        const routedResponse = await submitRespondentAnswer(
          routeSessionView.sessionId,
          `I want to focus on ${route.sampleValue}.`,
        );
        const routedToSourceContext =
          routedResponse.decision.selectedNodeKey === sourceContextQuestion.key;
        const sourceContextTurn = routedResponse.session.transcript.find(
          (turn) =>
            turn.nodeKey === sourceContextQuestion.key &&
            turn.role === "interviewer",
        );
        const grounding = sourceContextTurn?.grounding ?? null;
        const referenceCount = grounding?.references.length ?? 0;
        const adaptiveSourceContextReady =
          routedToSourceContext && Boolean(grounding && referenceCount > 0);

        checks.push({
          key: "adaptive_source_context_route",
          label: "Adaptive Source Context Route",
          status: adaptiveSourceContextReady ? "pass" : "fail",
          detail: adaptiveSourceContextReady
            ? `Answer "${route.sampleValue}" routed from ${route.fromNode!.key} to ${sourceContextQuestion.key} and returned ${referenceCount} proactive reference(s).`
            : routedToSourceContext
              ? `Answer "${route.sampleValue}" routed to ${sourceContextQuestion.key}, but proactive source context or references were missing. ${
                  routedResponse.session.capabilities.customGptGrounding
                    .reason ?? ""
                }`.trim()
              : `Answer "${route.sampleValue}" did not route to ${sourceContextQuestion.key}; selected ${routedResponse.decision.selectedNodeKey ?? routedResponse.decision.action}.`,
        });
      } catch (error) {
        checks.push({
          key: "adaptive_source_context_route",
          label: "Adaptive Source Context Route",
          status: "fail",
          detail:
            error instanceof Error
              ? error.message
              : "Unable to smoke test adaptive routing into proactive source context.",
        });
      }
    } else if (sourceContextCandidates.length > 0) {
      checks.push({
        key: "adaptive_source_context_route",
        label: "Adaptive Source Context Route",
        status: "warning",
        detail:
          "No conditional branch into a source-context question was available for the adaptive grounding smoke test.",
      });
    } else {
      checks.push({
        key: "adaptive_source_context_route",
        label: "Adaptive Source Context Route",
        status: "warning",
        detail: "No source-context question is configured for this study.",
      });
    }

    if (sourceContextApprovedNoteQuestion) {
      await smokeTestSourceContextQuestion(sourceContextApprovedNoteQuestion, {
        key: "source_context_approved_note_turn",
        label: "Approved Source Note Context",
      });
    } else if (sourceContextCandidates.length > 0) {
      checks.push({
        key: "source_context_approved_note_turn",
        label: "Approved Source Note Context",
        status: "warning",
        detail:
          "No source-context question has a referenced approved source note yet.",
      });
    }

    if (runtimeCustomGptSourceContextQuestion) {
      await smokeTestSourceContextQuestion(runtimeCustomGptSourceContextQuestion, {
        key: "source_context_turn",
        label: "Runtime CustomGPT Source Context",
      });
    } else if (sourceContextCandidates.length > 0) {
      checks.push({
        key: "source_context_turn",
        label: "Runtime CustomGPT Source Context",
        status: "warning",
        detail:
          "Every source-context question has a referenced approved source note; no runtime CustomGPT-only question was available for this smoke test.",
      });
    } else {
      checks.push({
        key: "source_context_turn",
        label: "Runtime CustomGPT Source Context",
        status: "warning",
        detail: "No source-context question is configured for this study.",
      });
    }

    const failCount = checks.filter((check) => check.status === "fail").length;

    smokeResult = {
      studyId: sessionView.studyId,
      studyName: sessionView.studyName,
      generatedAt: new Date().toISOString(),
      status: failCount === 0 ? "passed" : "failed",
      temporarySessionId: sessionView.sessionId,
      checks,
      firstQuestion: sessionView.currentQuestion
        ? {
            nodeKey: sessionView.currentQuestion.nodeKey,
            title: sessionView.currentQuestion.title,
          }
        : null,
      currentAsset: sessionView.currentAsset
        ? {
            key: sessionView.currentAsset.key,
            title: sessionView.currentAsset.title,
            assetType: sessionView.currentAsset.assetType,
            displayMode: sessionView.currentAsset.displayMode,
          }
        : null,
      capabilities: {
        recordedVoiceEnabled: sessionView.capabilities.recordedVoice.enabled,
        realtimeVoiceEnabled: sessionView.capabilities.realtimeVoice.enabled,
        customGptLikelyAvailable:
          sessionView.capabilities.customGptGrounding.enabled,
      },
    };
  } finally {
    cleanedUp = await cleanupTemporarySmokeTestData({
      sessionIds: temporarySessionIds,
      respondentIds: temporaryRespondentIds,
    }).catch(() => false);
  }

  if (!smokeResult) {
    const study = await prisma.study.findUnique({
      where: {
        id: studyId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    return studyLaunchSmokeTestResponseSchema.parse({
      studyId,
      studyName: study?.name ?? studyId,
      generatedAt: new Date().toISOString(),
      status: "failed",
      temporarySessionId: temporarySessionIds[0] ?? null,
      cleanedUp,
      checks: [
        {
          key: "session_started",
          label: "Session Started",
          status: "fail",
          detail: "Unable to start a temporary respondent session.",
        },
      ],
      firstQuestion: null,
      currentAsset: null,
      capabilities: {
        recordedVoiceEnabled: false,
        realtimeVoiceEnabled: false,
        customGptLikelyAvailable: false,
      },
    });
  }

  return studyLaunchSmokeTestResponseSchema.parse({
    ...smokeResult,
    cleanedUp,
  });
}

export async function getRespondentSession(sessionId: string) {
  const session = await loadSession(sessionId);
  return toRespondentSessionView(session);
}

export async function submitAssetReaction(
  sessionId: string,
  assetId: string,
  reactionInput: SubmitAssetReaction,
) {
  const session = await loadSession(sessionId);
  const sessionState = enrichSessionStateWithActionContext(
    getSessionStateFromMetadata(session),
    session.study,
    session.sessionAssets,
  );

  if (sessionState.status !== "active") {
    throw new Error(
      "Asset reactions can only be captured for active sessions.",
    );
  }

  const currentQuestionTurn =
    [...session.turns]
      .reverse()
      .find((turn) => turn.role === TurnRole.INTERVIEWER) ?? null;
  const currentAction = sessionState.currentActionId
    ? (session.study.actions.find(
        (action) => action.id === sessionState.currentActionId,
      ) ?? null)
    : currentQuestionTurn?.nodeId
      ? findActionForNode(session.study, currentQuestionTurn.nodeId)
      : null;
  const currentAsset = findAssetContext(
    session.study,
    currentAction?.id,
    session.sessionAssets,
  );

  if (!currentAsset || currentAsset.asset.id !== assetId) {
    throw new Error("Asset is not currently staged for this respondent.");
  }

  const sessionAsset =
    [...session.sessionAssets]
      .reverse()
      .find(
        (candidate) =>
          candidate.assetId === assetId &&
          (candidate.sourceActionId === currentAsset.sourceAction.id ||
            candidate.assetId === currentAsset.asset.id),
      ) ?? null;

  if (!sessionAsset) {
    throw new Error("Asset has not been shown in this respondent session.");
  }

  const submittedAt = new Date();
  const reaction = await prisma.assetReaction.create({
    data: {
      studyId: session.studyId,
      sessionId: session.id,
      turnId: currentQuestionTurn?.id ?? sessionAsset.turnId,
      assetId,
      kind: reactionInput.kind,
      status: reactionInput.status,
      input: {
        source: "respondent_asset_pane",
        sessionAssetId: sessionAsset.id,
        currentNodeId: sessionState.currentNodeId,
        currentNodeKey: sessionState.currentNodeKey,
        currentActionId: currentAction?.id ?? null,
        currentActionKey: currentAction?.key ?? null,
        assetKey: currentAsset.asset.key,
        assetTitle: currentAsset.asset.title,
        submittedAt: submittedAt.toISOString(),
      },
      output: {
        captured: true,
        label: describeAssetReactionKind(reactionInput.kind),
      },
    },
  });
  const updatedSession = await loadSession(session.id);

  return assetReactionResponseSchema.parse({
    reaction: toAssetReactionSummary(reaction),
    session: toRespondentSessionView(updatedSession),
  });
}

type SubmitRespondentAnswerOptions = {
  answerIntent?: "answer" | "skip";
  participantPayload?: Prisma.InputJsonObject;
};

export async function submitRespondentAnswer(
  sessionId: string,
  answer: string,
  options: SubmitRespondentAnswerOptions = {},
) {
  const session = await loadSession(sessionId);
  const { study, compiledStudy } = await loadCompiledStudy(session.studyId);
  const sessionState = getSessionStateFromMetadata(session, compiledStudy);
  const gateway = getOptionalOpenAIGateway();
  const currentNode = sessionState.currentNodeId
    ? compiledStudy.nodeById.get(sessionState.currentNodeId)
    : null;

  if (!currentNode) {
    throw new Error(`Session ${sessionId} does not have an active question.`);
  }

  const studyConfig =
    study.config &&
    typeof study.config === "object" &&
    !Array.isArray(study.config)
      ? (study.config as Prisma.JsonObject)
      : {};
  const configuredCustomGptProjectId =
    typeof studyConfig.customGptProjectId === "string"
      ? studyConfig.customGptProjectId
      : (env.CUSTOMGPT_PROJECT_ID ?? null);
  const allowGeneralClarificationQuestions = Boolean(
    configuredCustomGptProjectId,
  );
  const forceDeterministicClarification =
    options.answerIntent !== "skip" &&
    allowGeneralClarificationQuestions &&
    (looksLikeParticipantQuestion(answer) ||
      looksLikeStudySummaryRequest(answer)) &&
    !containsMedicalSafetyConcern(answer);

  const fallbackAnalysis = () =>
    buildDeterministicAnalysis({
      node: {
        key: currentNode.key,
        title: currentNode.title,
        nodeType: currentNode.nodeType,
        isTerminal: currentNode.isTerminal,
        config: currentNode.config,
        prompt: currentNode.prompt,
      },
      answer,
      sessionFacts: sessionState.facts,
      allowGeneralClarificationQuestions,
    });

  let analysis =
    options.answerIntent === "skip" || forceDeterministicClarification
      ? fallbackAnalysis()
      : gateway
        ? await gateway
            .analyzeAnswer({
              sessionId: session.id,
              studyId: session.studyId,
              nodeId: currentNode.id,
              nodeKey: currentNode.key,
              nodeTitle: currentNode.title,
              questionPrompt: currentNode.prompt,
              expectedFactKeys: currentNode.config.factKeys,
              sessionState: {
                facts: sessionState.facts,
                history: sessionState.history,
              },
              participantAnswer: answer,
            })
            .then((result) => result.result)
            .catch(() => fallbackAnalysis())
        : fallbackAnalysis();

  const participantPayload =
    options.answerIntent === "skip"
      ? {
          ...(options.participantPayload ?? {}),
          inputMode: "skip_button",
          answerIntent: "skip",
        }
      : options.participantPayload;

  if (
    analysis.turnIntent === "clarification_question" &&
    analysis.participantQuestion &&
    !analysis.safetyFlag
  ) {
    const currentAction = findActionForNode(study, currentNode.id);
    const assetContext = findAssetContext(
      study,
      currentAction?.id,
      session.sessionAssets,
    );

    try {
      const grounded = await askCustomGptForSurveyClarification({
        projectId: configuredCustomGptProjectId,
        question: analysis.participantQuestion,
        surveyContext: currentNode.prompt,
        assetTitle: assetContext?.asset.title ?? null,
      });

      if (grounded.answer) {
        analysis = analysisResultSchema.parse({
          ...analysis,
          groundedResponse: grounded.answer,
          groundedReferences: grounded.references,
        });
      }
    } catch {
      analysis = analysisResultSchema.parse({
        ...analysis,
        groundedResponse:
          "I can only answer from the approved survey material at a high level here.",
        groundedReferences: [],
      });
    }
  }

  const participantSequence = session.turns.length + 1;
  const participantTurn = await prisma.turn.create({
    data: {
      studyId: session.studyId,
      sessionId: session.id,
      nodeId: currentNode.id,
      sequence: participantSequence,
      role: TurnRole.PARTICIPANT,
      content: answer,
      ...(participantPayload
        ? {
            payload: participantPayload,
          }
        : {}),
    },
  });

  const analysisRecord = await prisma.analysis.create({
    data: {
      studyId: session.studyId,
      sessionId: session.id,
      turnId: participantTurn.id,
      kind: "ANSWER_EXTRACTION",
      status: "COMPLETED",
      input: {
        nodeKey: currentNode.key,
        prompt: currentNode.prompt,
      },
      output: analysis,
    },
  });

  const preparedTurn = prepareDecisionTurn({
    compiledStudy,
    sessionState,
    participantTurn: {
      turnId: participantTurn.id,
      content: answer,
      extractedFacts: analysis.extractedFacts,
      offTopic: analysis.offTopic,
      turnIntent: analysis.turnIntent,
      participantQuestion: analysis.participantQuestion,
      safetyFlag: analysis.safetyFlag,
      answerQuality: analysis.answerQuality,
      shouldAdvance: analysis.shouldAdvance,
    },
  });

  const deterministicSelection = preparedTurn.deterministicSelection;
  if (!deterministicSelection) {
    throw new Error(
      "No deterministic selection available for submitted answer.",
    );
  }

  const isClosing = deterministicSelection.action === "close";
  const committed = !isClosing
    ? commitSelection(preparedTurn.sessionState, deterministicSelection)
    : {
        selection: deterministicSelection,
        sessionState: sessionStateJsonSchema.parse({
          ...preparedTurn.sessionState,
          status: "completed",
          currentNodeId: null,
          currentNodeKey: null,
        }),
      };

  const allowedCandidates = buildDecisionCandidates(
    compiledStudy,
    preparedTurn.candidateNodeIds,
  );
  const selectedNode = committed.selection.selectedNodeId
    ? compiledStudy.nodeById.get(committed.selection.selectedNodeId)
    : null;
  const candidateActionRows = buildCandidateActionData({
    study,
    sessionId: session.id,
    turnId: participantTurn.id,
    currentNodeId: currentNode.id,
    candidateNodeIds: preparedTurn.candidateNodeIds,
  });

  await prisma.decision.create({
    data: {
      studyId: session.studyId,
      sessionId: session.id,
      turnId: participantTurn.id,
      fromNodeId: currentNode.id,
      selectedNodeId: selectedNode?.id ?? null,
      kind: isClosing
        ? DecisionKind.CLOSE_SESSION
        : DecisionKind.SELECT_NEXT_QUESTION,
      status: DecisionStatus.COMPLETED,
      rationale: deterministicSelection.rationale,
      input: {
        analysis,
        allowedCandidates,
      },
      output: {
        action: deterministicSelection.action,
        selectedNodeId: selectedNode?.id ?? null,
        selectedNodeKey: selectedNode?.key ?? null,
        source: deterministicSelection.source,
      },
    },
  });

  const existingSessionAssets = session.sessionAssets;
  const nextSessionState = enrichSessionStateWithActionContext(
    committed.sessionState,
    study,
    existingSessionAssets,
  );
  const nextAssetContext = findAssetContext(
    study,
    nextSessionState.currentActionId,
    existingSessionAssets,
  );

  const writes: Prisma.PrismaPromise<unknown>[] = [
    prisma.session.update({
      where: { id: session.id },
      data: {
        status:
          nextSessionState.status === "completed"
            ? SessionStatus.COMPLETED
            : SessionStatus.ACTIVE,
        completedAt:
          nextSessionState.status === "completed" ? new Date() : null,
        metadata: withSessionStateMetadata(session.metadata, nextSessionState),
      },
    }),
  ];

  if (!isClosing && selectedNode) {
    const interviewerTurnId = randomUUID();
    const interviewerTurnDraft = await buildInterviewerTurnDraft({
      sessionId: session.id,
      study,
      selectedNode: {
        id: selectedNode.id,
        moduleId: selectedNode.moduleId,
        title: selectedNode.title,
        prompt: selectedNode.prompt,
        config: selectedNode.config,
        isTerminal: selectedNode.isTerminal,
      },
      selectionAction: committed.selection.action,
      analysis,
      sessionAssets: existingSessionAssets,
    });

    writes.push(
      prisma.turn.create({
        data: {
          id: interviewerTurnId,
          studyId: session.studyId,
          sessionId: session.id,
          nodeId: selectedNode.id,
          sequence: participantSequence + 1,
          role: TurnRole.INTERVIEWER,
          content: interviewerTurnDraft.content,
          payload: interviewerTurnDraft.payload,
        },
      }),
    );

    if (
      nextAssetContext &&
      !existingSessionAssets.some(
        (candidate) =>
          candidate.assetId === nextAssetContext.asset.id &&
          candidate.sourceActionId === nextAssetContext.sourceAction.id,
      )
    ) {
      writes.push(
        prisma.sessionAsset.create({
          data: {
            id: randomUUID(),
            studyId: session.studyId,
            sessionId: session.id,
            assetId: nextAssetContext.asset.id,
            sourceActionId: nextAssetContext.sourceAction.id,
            turnId: interviewerTurnId,
            displayMode: nextAssetContext.displayMode ?? "INLINE_PANE",
            shownAt: new Date(),
            exposureMetadata: {
              source: "deterministic-stage",
              actionKey: nextAssetContext.sourceAction.key,
            },
          },
        }),
      );
    }
  }

  if (candidateActionRows.length > 0) {
    writes.push(
      prisma.candidateAction.createMany({
        data: candidateActionRows,
      }),
    );
  }

  await prisma.$transaction(writes);

  const updatedSession = await loadSession(session.id);
  return {
    analysis: analysisRecord.output,
    decision: {
      action: deterministicSelection.action,
      selectedNodeId: selectedNode?.id ?? null,
      selectedNodeKey: selectedNode?.key ?? null,
      rationale: deterministicSelection.rationale,
      source: deterministicSelection.source,
    },
    session: toRespondentSessionView(updatedSession),
  };
}

export async function getSessionAudit(sessionId: string) {
  const session = await loadSession(sessionId);
  const sessionState = enrichSessionStateWithActionContext(
    getSessionStateFromMetadata(session),
    session.study,
    session.sessionAssets,
  );
  const participantTurns = session.turns.filter(
    (turn) => turn.role === TurnRole.PARTICIPANT,
  );
  const timing = getLiveSessionTiming(sessionState);
  const attemptCounts = Object.entries(sessionState.attemptCountsByNodeId)
    .filter(([, attemptCount]) => attemptCount > 0)
    .map(([nodeId, attemptCount]) => {
      const node = session.study.questionNodes.find(
        (candidate) => candidate.id === nodeId,
      );

      return {
        nodeId,
        nodeKey: node?.key ?? null,
        title: node?.title ?? null,
        attemptCount,
      };
    })
    .sort((left, right) => right.attemptCount - left.attemptCount);
  const remainingOffSurveyRedirects = Math.max(
    0,
    sessionState.maxOffTopicRedirects - sessionState.offTopicRedirectCount,
  );
  const latestInterviewerTurn =
    [...session.turns]
      .filter((turn) => turn.role === TurnRole.INTERVIEWER)
      .sort((left, right) => right.sequence - left.sequence)[0] ?? null;
  const latestQuestionGrounding = getProactiveGroundingFromTurnPayload(
    latestInterviewerTurn?.payload ?? null,
  );

  return sessionAuditResponseSchema.parse({
    session: {
      id: session.id,
      studyId: session.studyId,
      studyName: session.study.name,
      status: session.status,
      respondentLabel:
        session.respondent?.externalRef ??
        `test-session-${session.id.slice(0, 6)}`,
      createdAt: session.createdAt.toISOString(),
      updatedAt: session.updatedAt.toISOString(),
      currentNodeKey: sessionState.currentNodeKey,
    },
    transcript: session.turns.map((turn) => ({
      id: turn.id,
      role:
        turn.role === TurnRole.INTERVIEWER
          ? "interviewer"
          : turn.role === TurnRole.PARTICIPANT
            ? "participant"
            : "system",
      content: turn.content,
      createdAt: turn.createdAt.toISOString(),
      nodeKey: turn.node?.key ?? null,
      grounding: getRespondentTranscriptGrounding(session, turn),
    })),
    currentQuestion: latestInterviewerTurn
      ? {
          turnId: latestInterviewerTurn.id,
          nodeKey: latestInterviewerTurn.node?.key ?? null,
          content: latestInterviewerTurn.content,
          createdAt: latestInterviewerTurn.createdAt.toISOString(),
          payload: latestInterviewerTurn.payload ?? null,
          grounding: latestQuestionGrounding,
        }
      : null,
    sessionAssets: session.sessionAssets.map((sessionAsset) => ({
      id: sessionAsset.id,
      assetKey: sessionAsset.asset.key,
      title: sessionAsset.asset.title,
      assetType: sessionAsset.asset.assetType,
      displayMode: sessionAsset.displayMode ?? null,
      shownAt: sessionAsset.shownAt?.toISOString() ?? null,
      sourceActionKey: sessionAsset.sourceAction?.key ?? null,
      reaction: toAssetReactionSummary(
        findLatestAssetReaction(session.assetReactions, sessionAsset.assetId),
      ),
    })),
    guardrails: {
      timing,
      attempts: {
        maxAttemptsPerQuestion: sessionState.maxAttemptsPerNode,
        attemptedQuestionCount: attemptCounts.length,
        highestAttemptCount: attemptCounts[0]?.attemptCount ?? 0,
        counts: attemptCounts,
      },
      offSurvey: {
        redirectCount: sessionState.offTopicRedirectCount,
        maxRedirects: sessionState.maxOffTopicRedirects,
        remainingRedirects: remainingOffSurveyRedirects,
        isAtLimit:
          sessionState.offTopicRedirectCount >=
          sessionState.maxOffTopicRedirects,
      },
    },
    turnAudit: participantTurns.map((turn) => {
      const question = session.turns.find(
        (candidate) =>
          candidate.sequence === turn.sequence - 1 &&
          candidate.role === TurnRole.INTERVIEWER,
      );
      const turnAsset =
        session.sessionAssets.find(
          (candidate) => question && candidate.turnId === question.id,
        ) ??
        session.sessionAssets
          .filter(
            (candidate) =>
              candidate.shownAt !== null && candidate.shownAt <= turn.createdAt,
          )
          .sort(
            (left, right) =>
              (right.shownAt?.getTime() ?? 0) - (left.shownAt?.getTime() ?? 0),
          )[0] ??
        null;
      const analysis = session.analyses.find((item) => item.turnId === turn.id);
      const decision = session.decisions.find(
        (item) => item.turnId === turn.id,
      );
      const analysisGrounding = getGroundingFromAnalysisOutput(
        analysis?.output ?? null,
      );
      const questionGrounding = getProactiveGroundingFromTurnPayload(
        question?.payload ?? null,
      );
      const decisionOutput = turnAuditDecisionOutputSummarySchema.safeParse(
        decision?.output,
      );
      const decisionSummary = decisionOutput.success
        ? decisionOutput.data
        : null;

      return {
        turnId: turn.id,
        nodeKey: turn.node?.key ?? null,
        question: question
          ? {
              turnId: question.id,
              content: question.content,
              createdAt: question.createdAt.toISOString(),
              payload: question.payload ?? null,
              grounding: questionGrounding,
            }
          : null,
        response: {
          turnId: turn.id,
          content: turn.content,
          createdAt: turn.createdAt.toISOString(),
          payload: turn.payload ?? null,
        },
        asset: turnAsset
          ? {
              id: turnAsset.asset.id,
              key: turnAsset.asset.key,
              title: turnAsset.asset.title,
              assetType: turnAsset.asset.assetType,
              displayMode: turnAsset.displayMode ?? null,
              shownAt: turnAsset.shownAt?.toISOString() ?? null,
              reaction: toAssetReactionSummary(
                findLatestAssetReaction(
                  session.assetReactions,
                  turnAsset.assetId,
                ),
              ),
            }
          : null,
        analysis: {
          id: analysis?.id ?? `analysis-missing-${turn.id}`,
          kind: analysis?.kind ?? "MISSING",
          status: analysis?.status ?? "MISSING",
          output: analysis?.output ?? null,
          groundedResponse: analysisGrounding.groundedResponse,
          groundedReferences: analysisGrounding.groundedReferences,
        },
        decision: {
          id: decision?.id ?? `decision-missing-${turn.id}`,
          kind: decision?.kind ?? "MISSING",
          status: decision?.status ?? "MISSING",
          action: decisionSummary?.action ?? null,
          selectedNodeId:
            decision?.selectedNodeId ?? decisionSummary?.selectedNodeId ?? null,
          selectedNodeKey:
            decision?.selectedNode?.key ??
            decisionSummary?.selectedNodeKey ??
            null,
          selectedNodeTitle: decision?.selectedNode?.title ?? null,
          source: decisionSummary?.source ?? null,
          rationale: decision?.rationale ?? null,
          output: decision?.output ?? null,
        },
      };
    }),
  });
}
