import { randomUUID } from "node:crypto";
import {
  ActionRuleType,
  BranchConditionType,
  SessionStatus,
  type Prisma,
} from "@prisma/client";
import {
  applyStudyGuideCleanupSchema,
  addStudyCustomGptAssetSourceSchema,
  addStudyCustomGptSitemapSourceSchema,
  createStudyAssetSchema,
  createStudyBranchRuleSchema,
  createStudyBranchRulesSchema,
  groundedReferenceSchema,
  retainStudyGuideSourceNotesSchema,
  studyGuideCleanupApplyResponseSchema,
  studyGuideSourceNoteRetentionResponseSchema,
  studyAssetDisplayModeResponseSchema,
  studyAssetMutationResponseSchema,
  studyBranchRuleBatchMutationResponseSchema,
  studyBranchRuleMutationResponseSchema,
  studyRecommendedBranchRulesApplyResponseSchema,
  simulateStudyBranchRouteSchema,
  studyBranchRouteSimulationResponseSchema,
  studyCustomGptVerificationResponseSchema,
  studyCustomGptSourcesResponseSchema,
  studyLaunchCheckResponseSchema,
  studyLaunchCheckItemSchema,
  studyQuestionGroundingPreviewResponseSchema,
  studyQuestionGroundingResponseSchema,
  studySettingsResponseSchema,
  studySourceContextPreviewResponseSchema,
  updateStudySourceContextNotesResponseSchema,
  updateStudySourceContextNotesSchema,
  updateStudyQuestionGroundingSchema,
  updateStudyAssetDisplayModeSchema,
  updateStudySettingsSchema,
  type ApplyStudyGuideCleanup,
  type AddStudyCustomGptAssetSource,
  type AddStudyCustomGptSitemapSource,
  type CreateStudyAsset,
  type CreateStudyBranchRule,
  type CreateStudyBranchRules,
  type GroundedReference,
  type RetainStudyGuideSourceNotes,
  type SimulateStudyBranchRoute,
  type StudyRecommendedBranchRouteDryRun,
  type StudyLaunchCheckItem,
  type StudyLaunchRecommendedAction,
  type UpdateStudyAssetDisplayMode,
  type UpdateStudyQuestionGrounding,
  type UpdateStudySourceContextNotes,
  type UpdateStudySettings,
} from "@interview/schemas";
import { env } from "../env";
import {
  addCustomGptFileSource,
  addCustomGptSitemapSource,
  askCustomGptForProactiveStudyContext,
  askCustomGptForSurveyClarification,
  listCustomGptSources,
  type CustomGptSourceSummary,
} from "./customgpt-service";
import { getStudyGraph } from "./interview-service";
import {
  extractSourceContextHintFromScriptedResponsePrompt,
  findScriptedResponseImportNodes,
  isScriptedResponseSectionTitle,
} from "./guide-cleanup";
import { prisma } from "./prisma";
import { asObject } from "./study-runtime";
import { resolveGroundedStudyContextRequirement } from "./study-grounding";

function numberFromConfig(
  config: Prisma.JsonObject,
  key: string,
  fallback: number,
) {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanFromConfig(
  config: Prisma.JsonObject,
  key: string,
  fallback: boolean,
) {
  const value = config[key];
  return typeof value === "boolean" ? value : fallback;
}

function stringFromConfig(config: Prisma.JsonObject, key: string) {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function timeboxStrategyFromConfig(config: Prisma.JsonObject) {
  const value = stringFromConfig(config, "timeboxStrategy");
  return value === "FULL_GUIDE" ? "FULL_GUIDE" : "HARD_CAP";
}

function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

function previewAnswer(value: string | null) {
  if (!value) {
    return null;
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 600 ? `${collapsed.slice(0, 600)}...` : collapsed;
}

function normalizeFactKey(value: string, fallback: string) {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (normalized) {
    return normalized;
  }

  return fallback
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function factKeysFromConfig(config: Prisma.JsonObject) {
  const factKeys = config.factKeys;
  if (!Array.isArray(factKeys)) {
    return [];
  }

  return factKeys.filter((value): value is string => typeof value === "string");
}

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function sourceContextHintSegments(value: string | null) {
  if (!value) {
    return [];
  }

  return uniqueStrings(value.split(/\n+/));
}

function normalizeSourceContextHintSegment(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function mergeSourceContextHints(
  existingHint: string | null,
  retainedHints: string[],
) {
  const existingSegments = sourceContextHintSegments(existingHint);
  const nextSegments = [...existingSegments];
  const seen = new Set(
    existingSegments.map((segment) =>
      normalizeSourceContextHintSegment(segment),
    ),
  );
  let addedHintCount = 0;

  for (const hint of retainedHints) {
    for (const segment of sourceContextHintSegments(hint)) {
      const normalized = normalizeSourceContextHintSegment(segment);
      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      nextSegments.push(segment);
      addedHintCount += 1;
    }
  }

  const mergedHint = nextSegments.join("\n");

  return {
    mergedHint,
    addedHintCount,
    changed: mergedHint !== (existingHint ?? "").trim(),
  };
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

function normalizeMatchKeywords(values: string[]) {
  return uniqueStrings(values.map((value) => value.toLowerCase()));
}

function comparisonValueKeywords(value: Prisma.JsonValue | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }

  return normalizeMatchKeywords(
    value.filter((item): item is string => typeof item === "string"),
  );
}

function sameKeywordSet(left: string[], right: string[]) {
  const normalizedLeft = normalizeMatchKeywords(left);
  const normalizedRight = normalizeMatchKeywords(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((keyword) => normalizedRight.includes(keyword));
}

function branchRuleToGraphEdge(rule: {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  conditionType: string;
  factKey: string | null;
  comparisonValue: Prisma.JsonValue | null;
  priority: number;
  rationale: string | null;
}) {
  return {
    id: rule.id,
    fromNodeId: rule.fromNodeId,
    toNodeId: rule.toNodeId,
    conditionType: rule.conditionType,
    factKey: rule.factKey ?? null,
    comparisonValue: rule.comparisonValue ?? null,
    priority: rule.priority,
    rationale: rule.rationale ?? null,
  };
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

function evaluateBranchRule(
  rule: {
    conditionType: string;
    factKey: string | null;
    comparisonValue: Prisma.JsonValue | null;
  },
  answer: string,
) {
  if (rule.conditionType === "ALWAYS") {
    return {
      matched: true,
      reason: "Fallback route applies when no conditional route matches.",
      matchedKeywordCount: 0,
      matchedKeywordLength: 0,
    };
  }

  if (!rule.factKey) {
    return {
      matched: false,
      reason: "Conditional route is missing a routing fact key.",
      matchedKeywordCount: 0,
      matchedKeywordLength: 0,
    };
  }

  const comparisons = branchComparisonValues(rule.comparisonValue);
  if (comparisons.length === 0) {
    return {
      matched: false,
      reason: "Conditional route has no comparison values.",
      matchedKeywordCount: 0,
      matchedKeywordLength: 0,
    };
  }

  const normalizedAnswer = answer.toLowerCase();

  if (rule.conditionType === "ANSWER_CONTAINS") {
    const matchedKeywords = comparisons.filter((comparison) =>
      normalizedAnswer.includes(comparison),
    );

    return matchedKeywords.length > 0
      ? {
          matched: true,
          reason: `Answer contains ${matchedKeywords
            .map((keyword) => `"${keyword}"`)
            .join(", ")}.`,
          matchedKeywordCount: matchedKeywords.length,
          matchedKeywordLength: matchedKeywords.join("").length,
        }
      : {
          matched: false,
          reason: `Answer does not contain ${comparisons.join(", ")}.`,
          matchedKeywordCount: 0,
          matchedKeywordLength: 0,
        };
  }

  if (rule.conditionType === "ANSWER_EQUALS") {
    const matchedKeywords = comparisons.filter(
      (comparison) => normalizedAnswer.trim() === comparison,
    );

    return matchedKeywords.length > 0
      ? {
          matched: true,
          reason: `Answer equals ${matchedKeywords
            .map((keyword) => `"${keyword}"`)
            .join(", ")}.`,
          matchedKeywordCount: matchedKeywords.length,
          matchedKeywordLength: matchedKeywords.join("").length,
        }
      : {
          matched: false,
          reason: `Answer does not equal ${comparisons.join(", ")}.`,
          matchedKeywordCount: 0,
          matchedKeywordLength: 0,
        };
  }

  return {
    matched: false,
    reason: `${rule.conditionType} is not supported by this simulator.`,
    matchedKeywordCount: 0,
    matchedKeywordLength: 0,
  };
}

function compareBranchRuleEvaluations(
  left: {
    rule: { priority: number; toNodeId: string };
    matchedKeywordCount: number;
    matchedKeywordLength: number;
    targetOrder: number;
  },
  right: {
    rule: { priority: number; toNodeId: string };
    matchedKeywordCount: number;
    matchedKeywordLength: number;
    targetOrder: number;
  },
) {
  if (left.matchedKeywordCount !== right.matchedKeywordCount) {
    return right.matchedKeywordCount - left.matchedKeywordCount;
  }

  if (left.matchedKeywordLength !== right.matchedKeywordLength) {
    return right.matchedKeywordLength - left.matchedKeywordLength;
  }

  if (left.rule.priority !== right.rule.priority) {
    return left.rule.priority - right.rule.priority;
  }

  if (left.targetOrder !== right.targetOrder) {
    return left.targetOrder - right.targetOrder;
  }

  return left.rule.toNodeId.localeCompare(right.rule.toNodeId);
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "asset"
  );
}

function fileNameFromPath(value: string) {
  const normalized = value.split(/[?#]/)[0] ?? value;
  return normalized.split(/[\\/]/).filter(Boolean).pop() ?? normalized;
}

function mimeTypeFromName(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (/\.pdf$/i.test(value)) {
    return "application/pdf";
  }

  if (/\.(png|jpg|jpeg|webp|gif)$/i.test(value)) {
    const extension = value.split(".").pop()?.toLowerCase();
    return extension === "jpg" ? "image/jpeg" : `image/${extension}`;
  }

  if (/\.html?$/i.test(value)) {
    return "text/html";
  }

  if (/\.(txt|md)$/i.test(value)) {
    return "text/plain";
  }

  if (/\.(mp4|webm|mov)$/i.test(value)) {
    return "video/mp4";
  }

  return null;
}

function inferAssetType(input: {
  explicitType?: CreateStudyAsset["assetType"];
  mimeType: string | null;
  sourceName: string;
}): NonNullable<CreateStudyAsset["assetType"]> {
  if (input.explicitType) {
    return input.explicitType;
  }

  if (
    input.mimeType === "application/pdf" ||
    /\.pdf$/i.test(input.sourceName)
  ) {
    return "PDF";
  }

  if (input.mimeType?.startsWith("image/")) {
    return "IMAGE";
  }

  if (input.mimeType?.startsWith("video/")) {
    return "VIDEO";
  }

  return "TEXT";
}

async function uniqueAssetKey(studyId: string, baseKey: string) {
  let key = baseKey || "asset";
  let suffix = 2;

  while (
    await prisma.studyAsset.findUnique({
      where: {
        studyId_key: {
          studyId,
          key,
        },
      },
    })
  ) {
    key = `${baseKey}-${suffix}`;
    suffix += 1;
  }

  return key;
}

function analyzeAdaptiveRouting(input: {
  questionNodeCount: number;
  branchRules: Array<{
    fromNodeId: string;
    conditionType: string;
  }>;
}) {
  const totalRuleCount = input.branchRules.length;
  const sequentialRuleCount = input.branchRules.filter(
    (rule) => rule.conditionType === "ALWAYS",
  ).length;
  const conditionalRules = input.branchRules.filter(
    (rule) => rule.conditionType !== "ALWAYS",
  );
  const conditionalSourceNodeIds = new Set(
    conditionalRules.map((rule) => rule.fromNodeId),
  );
  const conditionalSourceWithoutFallbackCount = Array.from(
    conditionalSourceNodeIds,
  ).filter(
    (sourceNodeId) =>
      !input.branchRules.some(
        (rule) =>
          rule.fromNodeId === sourceNodeId && rule.conditionType === "ALWAYS",
      ),
  ).length;
  const hasConditionalRouting = conditionalRules.length > 0;
  const isSequentialOnly =
    input.questionNodeCount > 1 &&
    totalRuleCount > 0 &&
    conditionalRules.length === 0;
  const status =
    input.questionNodeCount > 1 && totalRuleCount === 0
      ? "incomplete"
      : hasConditionalRouting
        ? "adaptive"
        : "sequential_only";
  const reason =
    status === "incomplete"
      ? "No branch rules are configured."
      : isSequentialOnly
        ? "All configured routes are sequential; no answer-dependent routing is active."
        : conditionalSourceWithoutFallbackCount > 0
          ? "Some conditional route sources are missing fallback routes."
          : hasConditionalRouting
            ? "Answer-dependent conditional routing is configured."
            : "Single-question guide does not need routing.";

  return {
    status,
    totalRuleCount,
    sequentialRuleCount,
    conditionalRuleCount: conditionalRules.length,
    conditionalSourceCount: conditionalSourceNodeIds.size,
    conditionalSourceWithoutFallbackCount,
    hasConditionalRouting,
    isSequentialOnly,
    reason,
  } as const;
}

function analyzeRoutingDryRuns(input: {
  questionNodes: Array<{
    id: string;
  }>;
  branchRules: Array<{
    fromNodeId: string;
    toNodeId: string;
    conditionType: string;
    factKey: string | null;
    comparisonValue: Prisma.JsonValue | null;
  }>;
}) {
  const nodeIds = new Set(input.questionNodes.map((node) => node.id));
  const conditionalRules = input.branchRules.filter(
    (rule) => rule.conditionType !== "ALWAYS",
  );
  const conditionalSourceNodeIds = uniqueStrings(
    conditionalRules.map((rule) => rule.fromNodeId),
  );
  const dryRunnableRules = conditionalRules.filter((rule) => {
    if (!nodeIds.has(rule.fromNodeId) || !nodeIds.has(rule.toNodeId)) {
      return false;
    }

    if (!rule.factKey) {
      return false;
    }

    if (!["ANSWER_CONTAINS", "ANSWER_EQUALS"].includes(rule.conditionType)) {
      return false;
    }

    return branchComparisonValues(rule.comparisonValue).length > 0;
  });
  const sourceNodeIdsWithFallback = conditionalSourceNodeIds.filter(
    (sourceNodeId) =>
      input.branchRules.some(
        (rule) =>
          rule.fromNodeId === sourceNodeId && rule.conditionType === "ALWAYS",
      ),
  );

  return {
    conditionalRuleCount: conditionalRules.length,
    dryRunnableRuleCount: dryRunnableRules.length,
    unsupportedRuleCount: conditionalRules.length - dryRunnableRules.length,
    conditionalSourceCount: conditionalSourceNodeIds.length,
    sourceWithFallbackCount: sourceNodeIdsWithFallback.length,
    sourceWithoutFallbackCount:
      conditionalSourceNodeIds.length - sourceNodeIdsWithFallback.length,
  } as const;
}

function buildFieldingReadiness(input: {
  config: Prisma.JsonObject;
  questionNodes: Array<{
    id: string;
    prompt: string;
    isTerminal: boolean;
    nodeType: string;
    config: Prisma.JsonValue;
  }>;
  branchRules: Array<{
    fromNodeId: string;
    conditionType: string;
  }>;
  assetCount: number;
  excludedSourceContextNodeIds?: Set<string>;
}) {
  const timeboxStrategy = timeboxStrategyFromConfig(input.config);
  const targetDurationSeconds = numberFromConfig(
    input.config,
    "targetDurationSeconds",
    900,
  );
  const closingReserveSeconds = numberFromConfig(
    input.config,
    "closingReserveSeconds",
    90,
  );
  const availableInterviewSeconds = Math.max(
    0,
    targetDurationSeconds - closingReserveSeconds,
  );
  const interviewQuestionNodes = input.questionNodes.filter(
    (node) => !node.isTerminal && node.nodeType !== "CLOSE",
  );
  const estimateNodeSeconds = (node: (typeof input.questionNodes)[number]) => {
    const nodeConfig = asObject(node.config);
    return typeof nodeConfig.estimatedSeconds === "number" &&
      Number.isFinite(nodeConfig.estimatedSeconds)
      ? nodeConfig.estimatedSeconds
      : 70;
  };
  const estimatedGuideSeconds = interviewQuestionNodes.reduce(
    (total, node) => total + estimateNodeSeconds(node),
    0,
  );
  let estimatedQuestionCapacity = 0;
  let cumulativeEstimatedSeconds = 0;

  for (const node of interviewQuestionNodes) {
    const nextEstimatedSeconds =
      cumulativeEstimatedSeconds + estimateNodeSeconds(node);
    if (nextEstimatedSeconds > availableInterviewSeconds) {
      break;
    }

    cumulativeEstimatedSeconds = nextEstimatedSeconds;
    estimatedQuestionCapacity += 1;
  }

  const estimatedOverageSeconds = Math.max(
    0,
    estimatedGuideSeconds - availableInterviewSeconds,
  );
  const recommendedTargetDurationSeconds =
    estimatedGuideSeconds + closingReserveSeconds;
  const timeboxWillSkipQuestions =
    estimatedOverageSeconds > 0 &&
    estimatedQuestionCapacity < interviewQuestionNodes.length;
  const maxAttemptsPerQuestion = numberFromConfig(
    input.config,
    "maxAttemptsPerQuestion",
    2,
  );
  const maxOffTopicRedirects = numberFromConfig(
    input.config,
    "maxOffTopicRedirects",
    2,
  );
  const noFixationReady = maxAttemptsPerQuestion <= 2;
  const offSurveyReturnReady = maxOffTopicRedirects <= 2;
  const sourceContextQuestions = input.questionNodes.filter((node) => {
    if (input.excludedSourceContextNodeIds?.has(node.id)) {
      return false;
    }

    const nodeConfig = asObject(node.config);
    return resolveGroundedStudyContextRequirement({
      prompt: node.prompt,
      requiresGroundedStudyContext: nodeConfig.requiresGroundedStudyContext,
    }).requiresGroundedStudyContext;
  });
  const sourceContextQuestionCount = sourceContextQuestions.length;
  const sourceContextApprovedNoteQuestionCount = sourceContextQuestions.filter(
    (node) => {
      const nodeConfig = asObject(node.config);
      return hasReferencedSourceContextNote(nodeConfig);
    },
  ).length;
  const sourceContextMissingApprovedNoteQuestionCount = Math.max(
    0,
    sourceContextQuestionCount - sourceContextApprovedNoteQuestionCount,
  );
  const customGptProjectConfigured = Boolean(
    stringFromConfig(input.config, "customGptProjectId") ??
    env.CUSTOMGPT_PROJECT_ID,
  );
  const customGptApiKeyConfigured = Boolean(env.CUSTOMGPT_API_KEY);
  const customGptEnabled =
    customGptApiKeyConfigured && customGptProjectConfigured;
  const sourceContextApprovedNotesCoverAll =
    sourceContextQuestionCount > 0 &&
    sourceContextMissingApprovedNoteQuestionCount === 0;
  const sourceContextFieldingReady =
    sourceContextQuestionCount === 0 ||
    customGptEnabled ||
    sourceContextApprovedNotesCoverAll;
  const realtimeVoiceEnabled = booleanFromConfig(
    input.config,
    "realtimeVoiceEnabled",
    false,
  );
  const realtimeVoiceRequiredForFielding = booleanFromConfig(
    input.config,
    "realtimeVoiceRequiredForFielding",
    false,
  );
  const openAiConfigured = Boolean(env.OPENAI_API_KEY);
  const realtimeVoiceFieldingReady =
    !realtimeVoiceRequiredForFielding ||
    (realtimeVoiceEnabled && openAiConfigured);
  const adaptiveRouting = analyzeAdaptiveRouting({
    questionNodeCount: input.questionNodes.length,
    branchRules: input.branchRules,
  });
  const warnings: string[] = [];

  if (input.questionNodes.length === 0) {
    warnings.push("This study has no question nodes.");
  }

  if (adaptiveRouting.status === "incomplete") {
    warnings.push(
      "No branch rules are configured for this multi-question study.",
    );
  }

  if (adaptiveRouting.isSequentialOnly) {
    warnings.push(
      "This study is currently sequential-only; add conditional routes for answer-dependent adaptiveness.",
    );
  }

  if (adaptiveRouting.conditionalSourceWithoutFallbackCount > 0) {
    warnings.push("Some conditional routes do not have fallback routes.");
  }

  if (
    availableInterviewSeconds > 0 &&
    estimatedGuideSeconds > availableInterviewSeconds &&
    timeboxStrategy === "FULL_GUIDE"
  ) {
    warnings.push(
      "Estimated guide length exceeds the target time before wrap-up.",
    );
  }

  if (!noFixationReady) {
    warnings.push(
      "Max attempts per question is above 2; lower it to avoid repeated re-asking.",
    );
  }

  if (!offSurveyReturnReady) {
    warnings.push(
      "Max off-survey redirects is above 2; lower it so participant side questions return to the guide without looping.",
    );
  }

  if (sourceContextQuestionCount > 0 && !sourceContextFieldingReady) {
    warnings.push(
      "Source-context questions need CustomGPT or referenced approved source notes for proactive study summaries.",
    );
  }

  if (
    sourceContextQuestionCount > 0 &&
    !sourceContextFieldingReady &&
    !customGptProjectConfigured
  ) {
    warnings.push(
      "Source-context questions need a CustomGPT project with approved source material.",
    );
  }

  if (input.assetCount === 0) {
    warnings.push("No side-pane assets are configured for this study.");
  }

  if (realtimeVoiceRequiredForFielding && !realtimeVoiceEnabled) {
    warnings.push(
      "Realtime voice is required for fielding but is disabled for this study.",
    );
  }

  if (
    realtimeVoiceRequiredForFielding &&
    realtimeVoiceEnabled &&
    !openAiConfigured
  ) {
    warnings.push(
      "Realtime voice is required for fielding but OPENAI_API_KEY is missing.",
    );
  }

  return {
    status: warnings.length === 0 ? "ready" : "needs_setup",
    questionCount: input.questionNodes.length,
    interviewQuestionCount: interviewQuestionNodes.length,
    sourceContextQuestionCount,
    assetCount: input.assetCount,
    timeboxStrategy,
    estimatedGuideSeconds,
    availableInterviewSeconds,
    estimatedQuestionCapacity,
    estimatedOverageSeconds,
    recommendedTargetDurationSeconds,
    timeboxWillSkipQuestions,
    guardrails: {
      maxAttemptsPerQuestion,
      maxOffTopicRedirects,
      noFixationReady,
      offSurveyReturnReady,
    },
    adaptiveRouting,
    customGpt: {
      apiKeyConfigured: customGptApiKeyConfigured,
      projectConfigured: customGptProjectConfigured,
      enabled: customGptEnabled,
      reason: !customGptApiKeyConfigured
        ? "CUSTOMGPT_API_KEY is missing."
        : !customGptProjectConfigured
          ? "No CustomGPT project is configured."
          : null,
    },
    sourceContext: {
      questionCount: sourceContextQuestionCount,
      approvedNoteQuestionCount: sourceContextApprovedNoteQuestionCount,
      missingApprovedNoteQuestionCount:
        sourceContextMissingApprovedNoteQuestionCount,
      approvedNotesCoverAll: sourceContextApprovedNotesCoverAll,
      fieldingReady: sourceContextFieldingReady,
      reason:
        sourceContextQuestionCount === 0
          ? null
          : customGptEnabled
            ? null
            : sourceContextApprovedNotesCoverAll
              ? "All proactive source-context questions have referenced approved source notes."
              : `${sourceContextMissingApprovedNoteQuestionCount} proactive source-context question(s) still need CustomGPT coverage or referenced approved source notes.`,
    },
    voice: {
      openAiConfigured,
      recordedAvailable: openAiConfigured,
      realtimeEnabledForStudy: realtimeVoiceEnabled,
      realtimeAvailable: openAiConfigured && realtimeVoiceEnabled,
      realtimeRequiredForFielding: realtimeVoiceRequiredForFielding,
      fieldingReady: realtimeVoiceFieldingReady,
      reason: !realtimeVoiceRequiredForFielding
        ? realtimeVoiceEnabled && !openAiConfigured
          ? "Realtime voice is optional for fielding and needs OPENAI_API_KEY before use."
          : !realtimeVoiceEnabled
            ? "Realtime voice is optional for fielding and disabled for this study."
            : null
        : !realtimeVoiceEnabled
          ? "Realtime voice is required for fielding but disabled for this study."
          : !openAiConfigured
            ? "Realtime voice is required for fielding but OPENAI_API_KEY is missing."
            : null,
    },
    warnings,
  } as const;
}

type LaunchCheckItemInput = Omit<StudyLaunchCheckItem, "actionHref"> & {
  actionHref?: string | null;
};

function launchCheckItem(item: LaunchCheckItemInput): StudyLaunchCheckItem {
  return studyLaunchCheckItemSchema.parse({
    ...item,
    actionHref: item.actionHref ?? null,
  });
}

const launchActionMetadata: Record<
  string,
  {
    order: number;
    category: StudyLaunchRecommendedAction["category"];
    actionLabel: string;
  }
> = {
  questions: {
    order: 10,
    category: "guide",
    actionLabel: "Import Guide",
  },
  wrap_up: {
    order: 20,
    category: "guide",
    actionLabel: "Open Study Graph",
  },
  open_sessions: {
    order: 30,
    category: "guide",
    actionLabel: "Open Session Management",
  },
  scripted_response_imports: {
    order: 40,
    category: "guide",
    actionLabel: "Review Cleanup",
  },
  adaptive_flow: {
    order: 50,
    category: "routing",
    actionLabel: "Open Routing Review",
  },
  route_dry_runs: {
    order: 60,
    category: "routing",
    actionLabel: "Open Route Dry Runs",
  },
  timebox: {
    order: 70,
    category: "settings",
    actionLabel: "Adjust Timing",
  },
  attempt_limit: {
    order: 80,
    category: "settings",
    actionLabel: "Adjust Attempts",
  },
  off_survey_redirects: {
    order: 85,
    category: "settings",
    actionLabel: "Adjust Redirects",
  },
  side_pane_asset: {
    order: 90,
    category: "asset",
    actionLabel: "Open Assets",
  },
  customgpt_project: {
    order: 100,
    category: "source_context",
    actionLabel: "Set Project",
  },
  customgpt_key: {
    order: 110,
    category: "source_context",
    actionLabel: "Open Research Setup",
  },
  customgpt_sources: {
    order: 115,
    category: "source_context",
    actionLabel: "Add Source Material",
  },
  source_context: {
    order: 120,
    category: "source_context",
    actionLabel: "Configure Source Context",
  },
  source_context_review: {
    order: 125,
    category: "source_context",
    actionLabel: "Review Source Context",
  },
  openai_key: {
    order: 128,
    category: "voice",
    actionLabel: "Open Research Setup",
  },
  voice: {
    order: 130,
    category: "voice",
    actionLabel: "Open Voice Settings",
  },
  test_session: {
    order: 140,
    category: "testing",
    actionLabel: "Start Test Session",
  },
};

function studyGraphHref(studyId: string, anchor?: string) {
  return `/research/studies/${studyId}${anchor ? `#${anchor}` : ""}`;
}

function studySettingsHref(studyId: string, anchor?: string) {
  return `/research/studies/${studyId}/settings${anchor ? `#${anchor}` : ""}`;
}

function setupHrefWithReturnTo(studyId: string, anchor?: string) {
  return `/research/setup?returnTo=${encodeURIComponent(
    studySettingsHref(studyId, anchor),
  )}`;
}

function buildRecommendedLaunchActions(
  items: StudyLaunchCheckItem[],
): StudyLaunchRecommendedAction[] {
  return items
    .filter(
      (
        item,
      ): item is StudyLaunchCheckItem & {
        action: string;
        status: "fail" | "warning";
      } => item.status !== "pass" && Boolean(item.action),
    )
    .sort((left, right) => {
      const leftOrder = launchActionMetadata[left.key]?.order ?? 999;
      const rightOrder = launchActionMetadata[right.key]?.order ?? 999;

      if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
      }

      const leftRank = left.status === "fail" ? 0 : 1;
      const rightRank = right.status === "fail" ? 0 : 1;
      return leftRank - rightRank;
    })
    .map((item) => ({
      key: item.key,
      label: item.label,
      severity: item.status === "fail" ? "blocker" : "warning",
      sourceStatus: item.status,
      order: launchActionMetadata[item.key]?.order ?? 999,
      category: launchActionMetadata[item.key]?.category ?? "settings",
      action: item.action,
      actionLabel: launchActionMetadata[item.key]?.actionLabel ?? null,
      actionHref: item.actionHref,
    }));
}

type CustomGptSourceCoverage = {
  checked: boolean;
  enabled: boolean;
  reason: string | null;
  sourceCount: number;
  pageCount: number;
  indexedPageCount: number;
  queuedPageCount: number;
  failedPageCount: number;
  limitedPageCount: number;
};

function summarizeCustomGptSourceCoverage(input: {
  checked: boolean;
  enabled: boolean;
  reason: string | null;
  sources: CustomGptSourceSummary[];
}): CustomGptSourceCoverage {
  return input.sources.reduce<CustomGptSourceCoverage>(
    (coverage, source) => ({
      ...coverage,
      sourceCount: coverage.sourceCount + 1,
      pageCount: coverage.pageCount + source.pageCount,
      indexedPageCount:
        coverage.indexedPageCount + source.indexedPageCount,
      queuedPageCount: coverage.queuedPageCount + source.queuedPageCount,
      failedPageCount: coverage.failedPageCount + source.failedPageCount,
      limitedPageCount: coverage.limitedPageCount + source.limitedPageCount,
    }),
    {
      checked: input.checked,
      enabled: input.enabled,
      reason: input.reason,
      sourceCount: 0,
      pageCount: 0,
      indexedPageCount: 0,
      queuedPageCount: 0,
      failedPageCount: 0,
      limitedPageCount: 0,
    },
  );
}

async function getCustomGptSourceCoverage(projectId: string | null) {
  if (!env.CUSTOMGPT_API_KEY) {
    return summarizeCustomGptSourceCoverage({
      checked: false,
      enabled: false,
      reason: "CUSTOMGPT_API_KEY is not configured.",
      sources: [],
    });
  }

  if (!projectId) {
    return summarizeCustomGptSourceCoverage({
      checked: false,
      enabled: false,
      reason: "No CustomGPT project is configured for this study.",
      sources: [],
    });
  }

  try {
    const result = await listCustomGptSources({ projectId });

    return summarizeCustomGptSourceCoverage({
      checked: result.enabled,
      enabled: result.enabled,
      reason: result.reason,
      sources: result.sources,
    });
  } catch (error) {
    return summarizeCustomGptSourceCoverage({
      checked: false,
      enabled: true,
      reason:
        error instanceof Error
          ? error.message
          : "Unable to verify CustomGPT source material.",
      sources: [],
    });
  }
}

function buildCustomGptSourceMaterialItem(input: {
  studyId: string;
  sourceContextQuestionCount: number;
  approvedNotesCoverAll: boolean;
  projectId: string | null;
  coverage: CustomGptSourceCoverage | null;
}) {
  const settingsHref = studySettingsHref(input.studyId, "customgpt-sources");

  if (input.sourceContextQuestionCount === 0) {
    return launchCheckItem({
      key: "customgpt_sources",
      label: "CustomGPT Source Material",
      status: "pass",
      detail:
        "No proactive source-context questions need CustomGPT source material.",
      action: null,
    });
  }

  if (input.approvedNotesCoverAll) {
    return launchCheckItem({
      key: "customgpt_sources",
      label: "CustomGPT Source Material",
      status: "pass",
      detail:
        "Referenced approved source notes cover every proactive source-context question.",
      action: null,
    });
  }

  if (!env.CUSTOMGPT_API_KEY) {
    return launchCheckItem({
      key: "customgpt_sources",
      label: "CustomGPT Source Material",
      status: "fail",
      detail:
        "CustomGPT source material cannot be verified until CUSTOMGPT_API_KEY is configured.",
      action:
        "Add CUSTOMGPT_API_KEY, then add or refresh the Brukinsa source material in the study CustomGPT project.",
      actionHref: setupHrefWithReturnTo(input.studyId, "customgpt-sources"),
    });
  }

  if (!input.projectId) {
    return launchCheckItem({
      key: "customgpt_sources",
      label: "CustomGPT Source Material",
      status: "fail",
      detail:
        "No CustomGPT project is configured for the source material check.",
      action:
        "Add the study CustomGPT project ID, then add or refresh source material.",
      actionHref: studySettingsHref(input.studyId, "customgpt-project"),
    });
  }

  const coverage =
    input.coverage ??
    summarizeCustomGptSourceCoverage({
      checked: false,
      enabled: true,
      reason: "CustomGPT source material has not been checked.",
      sources: [],
    });

  if (!coverage.checked) {
    return launchCheckItem({
      key: "customgpt_sources",
      label: "CustomGPT Source Material",
      status: "warning",
      detail: coverage.reason ?? "CustomGPT source material was not checked.",
      action:
        "Refresh CustomGPT source status before relying on runtime study summaries.",
      actionHref: settingsHref,
    });
  }

  if (coverage.sourceCount === 0 || coverage.indexedPageCount === 0) {
    return launchCheckItem({
      key: "customgpt_sources",
      label: "CustomGPT Source Material",
      status: "fail",
      detail:
        coverage.sourceCount === 0
          ? "No source material was returned for this CustomGPT project."
          : `${coverage.sourceCount} source(s) are configured, but none have indexed pages yet.`,
      action:
        "Add the Brukinsa website/sitemap or source assets to CustomGPT, then refresh until indexed pages are available.",
      actionHref: settingsHref,
    });
  }

  return launchCheckItem({
    key: "customgpt_sources",
    label: "CustomGPT Source Material",
    status:
      coverage.queuedPageCount > 0 ||
      coverage.failedPageCount > 0 ||
      coverage.limitedPageCount > 0
        ? "warning"
        : "pass",
    detail: `${coverage.sourceCount} CustomGPT source(s) returned ${coverage.indexedPageCount} indexed page(s), ${coverage.queuedPageCount} queued, ${coverage.failedPageCount} failed, and ${coverage.limitedPageCount} limited.`,
    action:
      coverage.queuedPageCount > 0 ||
      coverage.failedPageCount > 0 ||
      coverage.limitedPageCount > 0
        ? "Refresh source status and review any queued, failed, or limited pages before fielding."
        : null,
    actionHref:
      coverage.queuedPageCount > 0 ||
      coverage.failedPageCount > 0 ||
      coverage.limitedPageCount > 0
        ? settingsHref
        : null,
  });
}

export async function getStudyLaunchCheck(studyId: string) {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      branchRules: true,
      modules: true,
      assets: {
        orderBy: {
          position: "asc",
        },
      },
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
      sessions: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const openSessionCount = await prisma.session.count({
    where: {
      studyId,
      status: {
        in: [SessionStatus.PENDING, SessionStatus.ACTIVE],
      },
    },
  });

  const config = asObject(study.config);
  const scriptedResponseImportNodes = findScriptedResponseImportNodes({
    modules: study.modules,
    questionNodes: study.questionNodes,
  });
  const scriptedResponseNodeIds = new Set(
    scriptedResponseImportNodes.map((item) => item.node.id),
  );
  const readiness = buildFieldingReadiness({
    config,
    questionNodes: study.questionNodes,
    branchRules: study.branchRules,
    assetCount: study.assets.length,
    excludedSourceContextNodeIds: scriptedResponseNodeIds,
  });
  const targetDurationSeconds = numberFromConfig(
    config,
    "targetDurationSeconds",
    900,
  );
  const maxAttemptsPerQuestion = numberFromConfig(
    config,
    "maxAttemptsPerQuestion",
    2,
  );
  const maxOffTopicRedirects = numberFromConfig(
    config,
    "maxOffTopicRedirects",
    2,
  );
  const realtimeVoiceEnabled = booleanFromConfig(
    config,
    "realtimeVoiceEnabled",
    false,
  );
  const realtimeVoiceRequiredForFielding = booleanFromConfig(
    config,
    "realtimeVoiceRequiredForFielding",
    false,
  );
  const customGptProjectId =
    stringFromConfig(config, "customGptProjectId") ??
    env.CUSTOMGPT_PROJECT_ID ??
    null;
  const terminalNodeCount = study.questionNodes.filter(
    (node) => node.isTerminal || node.nodeType === "CLOSE",
  ).length;
  const adaptiveRouting = readiness.adaptiveRouting;
  const routingDryRuns = analyzeRoutingDryRuns({
    questionNodes: study.questionNodes,
    branchRules: study.branchRules,
  });
  const retainedCleanupSourceContextHintCount =
    scriptedResponseImportNodes.filter((item) =>
      Boolean(
        extractSourceContextHintFromScriptedResponsePrompt(item.node.prompt),
      ),
    ).length;
  const sourceContextHintQuestionCount = study.questionNodes.filter((node) => {
    if (scriptedResponseNodeIds.has(node.id)) {
      return false;
    }

    const config = asObject(node.config);
    const requirement = resolveGroundedStudyContextRequirement({
      prompt: node.prompt,
      requiresGroundedStudyContext: config.requiresGroundedStudyContext,
    });
    return (
      requirement.requiresGroundedStudyContext &&
      hasReferencedSourceContextNote(config)
    );
  }).length;
  const sourceContextWithoutImportedHintCount = Math.max(
    0,
    readiness.sourceContextQuestionCount - sourceContextHintQuestionCount,
  );
  const customGptKeyRequiredForFielding =
    Boolean(customGptProjectId) ||
    (readiness.sourceContextQuestionCount > 0 &&
      !readiness.sourceContext.fieldingReady);
  const customGptSourceCoverage =
    readiness.sourceContextQuestionCount > 0 &&
    !readiness.sourceContext.approvedNotesCoverAll
      ? await getCustomGptSourceCoverage(customGptProjectId)
      : null;
  const customGptSourceMaterialReady =
    readiness.sourceContext.approvedNotesCoverAll ||
    Boolean(
      customGptSourceCoverage?.checked &&
        customGptSourceCoverage.indexedPageCount > 0,
    );
  const sourceContextLaunchReady =
    readiness.sourceContextQuestionCount === 0 || customGptSourceMaterialReady;
  const items: StudyLaunchCheckItem[] = [
    launchCheckItem({
      key: "questions",
      label: "Question Guide",
      status: study.questionNodes.length > 0 ? "pass" : "fail",
      detail:
        study.questionNodes.length > 0
          ? `${study.questionNodes.length} questions are configured.`
          : "No question nodes are configured.",
      action:
        study.questionNodes.length > 0
          ? null
          : "Import or add a survey guide before fielding.",
      actionHref: study.questionNodes.length > 0 ? null : "/research/import",
    }),
    launchCheckItem({
      key: "wrap_up",
      label: "Wrap-Up",
      status: terminalNodeCount > 0 ? "pass" : "fail",
      detail:
        terminalNodeCount > 0
          ? `${terminalNodeCount} terminal or wrap-up node is configured.`
          : "No terminal or wrap-up node is configured.",
      action:
        terminalNodeCount > 0
          ? null
          : "Add a closing question so sessions can finish cleanly.",
      actionHref:
        terminalNodeCount > 0
          ? null
          : studyGraphHref(study.id, "question-nodes"),
    }),
    launchCheckItem({
      key: "timebox",
      label: "Time Limit",
      status:
        readiness.estimatedGuideSeconds <=
          readiness.availableInterviewSeconds ||
        readiness.timeboxStrategy === "HARD_CAP"
          ? "pass"
          : "warning",
      detail:
        readiness.estimatedGuideSeconds <= readiness.availableInterviewSeconds
          ? `Estimated guide time fits inside ${Math.round(
              targetDurationSeconds / 60,
            )} minutes.`
          : readiness.timeboxStrategy === "HARD_CAP"
            ? `Hard cap enabled: approximately ${readiness.estimatedQuestionCapacity} of ${readiness.interviewQuestionCount} interview question(s) fit before wrap-up.`
            : `Estimated guide time exceeds the available ${Math.round(
                readiness.availableInterviewSeconds / 60,
              )} minutes before wrap-up.`,
      action:
        readiness.estimatedGuideSeconds <=
          readiness.availableInterviewSeconds ||
        readiness.timeboxStrategy === "HARD_CAP"
          ? null
          : `Increase the target duration to at least ${Math.ceil(
              readiness.recommendedTargetDurationSeconds / 60,
            )} minutes or switch to hard cap.`,
      actionHref:
        readiness.estimatedGuideSeconds <=
          readiness.availableInterviewSeconds ||
        readiness.timeboxStrategy === "HARD_CAP"
          ? null
          : studySettingsHref(study.id, "timing-settings"),
    }),
    launchCheckItem({
      key: "attempt_limit",
      label: "No-Fixation Guardrail",
      status: maxAttemptsPerQuestion <= 2 ? "pass" : "warning",
      detail: `Max attempts per question is ${maxAttemptsPerQuestion}.`,
      action:
        maxAttemptsPerQuestion <= 2
          ? null
          : "Lower max attempts to avoid repeated re-asking.",
      actionHref:
        maxAttemptsPerQuestion <= 2
          ? null
          : studySettingsHref(study.id, "timing-settings"),
    }),
    launchCheckItem({
      key: "off_survey_redirects",
      label: "Off-Survey Redirects",
      status: maxOffTopicRedirects <= 2 ? "pass" : "warning",
      detail: `Max off-survey redirects is ${maxOffTopicRedirects}.`,
      action:
        maxOffTopicRedirects <= 2
          ? null
          : "Lower off-survey redirects so participant side questions return to the guide without looping.",
      actionHref:
        maxOffTopicRedirects <= 2
          ? null
          : studySettingsHref(study.id, "timing-settings"),
    }),
    launchCheckItem({
      key: "scripted_response_imports",
      label: "Imported Guide Cleanup",
      status: scriptedResponseImportNodes.length === 0 ? "pass" : "warning",
      detail:
        scriptedResponseImportNodes.length === 0
          ? "No scripted interviewer response blocks are present in the question guide."
          : `${scriptedResponseImportNodes.length} imported node(s) look like scripted interviewer responses or respondent examples instead of fieldable questions; ${retainedCleanupSourceContextHintCount} contain source-context notes that cleanup will retain on real questions.`,
      action:
        scriptedResponseImportNodes.length === 0
          ? null
          : "Re-import the guide with the cleaned importer, or remove the scripted-response nodes before fielding.",
      actionHref:
        scriptedResponseImportNodes.length === 0
          ? null
          : studyGraphHref(study.id, "guide-cleanup"),
    }),
    launchCheckItem({
      key: "open_sessions",
      label: "Open Sessions",
      status: openSessionCount > 0 ? "warning" : "pass",
      detail:
        openSessionCount > 0
          ? `${openSessionCount} active or pending session(s) are open.`
          : "No active or pending sessions are open.",
      action:
        openSessionCount > 0
          ? scriptedResponseImportNodes.length > 0
            ? "Abandon open sessions from the Study Graph page before applying guide cleanup or fielding a fresh respondent link."
            : "Abandon old test/respondent sessions before fielding a fresh respondent link."
          : null,
      actionHref:
        openSessionCount > 0
          ? studyGraphHref(study.id, "session-management")
          : null,
    }),
    launchCheckItem({
      key: "adaptive_flow",
      label: "Adaptive Flow",
      status:
        adaptiveRouting.status === "incomplete"
          ? "fail"
          : adaptiveRouting.isSequentialOnly ||
              adaptiveRouting.conditionalSourceWithoutFallbackCount > 0
            ? "warning"
            : "pass",
      detail:
        adaptiveRouting.totalRuleCount > 0
          ? `${adaptiveRouting.totalRuleCount} branch rules are configured: ${adaptiveRouting.conditionalRuleCount} conditional, ${adaptiveRouting.sequentialRuleCount} sequential.`
          : "No branch rules are configured.",
      action:
        adaptiveRouting.status === "incomplete"
          ? "Add sequential or conditional branches."
          : adaptiveRouting.isSequentialOnly
            ? "Add answer-dependent conditional routes if this survey should adapt based on responses."
            : adaptiveRouting.conditionalSourceWithoutFallbackCount > 0
              ? "Add fallback routes for conditional branches."
              : null,
      actionHref:
        adaptiveRouting.status === "incomplete" ||
        adaptiveRouting.isSequentialOnly ||
        adaptiveRouting.conditionalSourceWithoutFallbackCount > 0
          ? studyGraphHref(study.id, "suggested-branches")
          : null,
    }),
    launchCheckItem({
      key: "route_dry_runs",
      label: "Routing Dry Runs",
      status:
        routingDryRuns.conditionalRuleCount === 0
          ? "warning"
          : routingDryRuns.unsupportedRuleCount > 0 ||
              routingDryRuns.sourceWithoutFallbackCount > 0
            ? "warning"
            : "pass",
      detail:
        routingDryRuns.conditionalRuleCount === 0
          ? "No saved conditional routes are available for sample-answer dry runs."
          : `${routingDryRuns.dryRunnableRuleCount} of ${routingDryRuns.conditionalRuleCount} conditional route(s) can be exercised with sample answers; ${routingDryRuns.sourceWithFallbackCount} of ${routingDryRuns.conditionalSourceCount} conditional source question(s) have fallback routes.`,
      action:
        routingDryRuns.conditionalRuleCount === 0
          ? "Apply selected conditional branch suggestions, then test saved routing from the Study Graph page."
          : routingDryRuns.unsupportedRuleCount > 0
            ? "Add fact keys and comparison values to every conditional route before fielding."
            : routingDryRuns.sourceWithoutFallbackCount > 0
              ? "Add fallback routes so non-matching answers can return to the guide."
              : null,
      actionHref:
        routingDryRuns.conditionalRuleCount === 0 ||
        routingDryRuns.unsupportedRuleCount > 0 ||
        routingDryRuns.sourceWithoutFallbackCount > 0
          ? studyGraphHref(
              study.id,
              routingDryRuns.conditionalRuleCount === 0
                ? "suggested-branches"
                : "route-review",
            )
          : null,
    }),
    launchCheckItem({
      key: "source_context",
      label: "Proactive Source Context",
      status: sourceContextLaunchReady ? "pass" : "fail",
      detail:
        readiness.sourceContextQuestionCount === 0
          ? "No questions are marked for proactive source context."
          : `${readiness.sourceContextQuestionCount} source-context question(s) are configured; ${sourceContextHintQuestionCount} have referenced approved source notes and ${sourceContextWithoutImportedHintCount} still need CustomGPT source material or referenced approved notes for grounded detail.`,
      action:
        sourceContextLaunchReady
          ? null
          : "Open Source Context to add referenced approved notes, or use the CustomGPT setup actions to add indexed source material.",
      actionHref: sourceContextLaunchReady
        ? null
        : studyGraphHref(study.id, "source-context"),
    }),
    launchCheckItem({
      key: "source_context_review",
      label: "Source Context Review",
      status: readiness.sourceContextQuestionCount > 0 ? "warning" : "pass",
      detail:
        readiness.sourceContextQuestionCount > 0
          ? `${readiness.sourceContextQuestionCount} question(s) are marked to proactively pull study/source context; ${sourceContextHintQuestionCount} already have referenced approved source notes.`
          : "No questions are marked for proactive source context review.",
      action:
        readiness.sourceContextQuestionCount > 0
          ? "Review the questions and imported notes that will be used for proactive study/source context."
          : null,
      actionHref:
        readiness.sourceContextQuestionCount > 0
          ? studyGraphHref(study.id, "source-context")
          : null,
    }),
    launchCheckItem({
      key: "customgpt_project",
      label: "CustomGPT Project",
      status: customGptProjectId ? "pass" : "warning",
      detail: customGptProjectId
        ? `CustomGPT project ${customGptProjectId} is configured for this study.`
        : "No CustomGPT project is configured for this study.",
      action: customGptProjectId
        ? null
        : "Add the project ID if participant questions should use approved source material.",
      actionHref: customGptProjectId
        ? null
        : studySettingsHref(study.id, "customgpt-project"),
    }),
    launchCheckItem({
      key: "customgpt_key",
      label: "CustomGPT API Key",
      status: env.CUSTOMGPT_API_KEY
        ? "pass"
        : customGptKeyRequiredForFielding
          ? "fail"
          : "warning",
      detail: env.CUSTOMGPT_API_KEY
        ? "CUSTOMGPT_API_KEY is configured."
        : customGptKeyRequiredForFielding
          ? "CUSTOMGPT_API_KEY is not configured."
          : "CUSTOMGPT_API_KEY is not configured; referenced approved source notes can still support proactive context for browser-chat fielding.",
      action: env.CUSTOMGPT_API_KEY
        ? null
        : customGptKeyRequiredForFielding
          ? "Add CUSTOMGPT_API_KEY in Research Setup before testing grounded answers."
          : "Add CUSTOMGPT_API_KEY when you want CustomGPT-powered source answers and references.",
      actionHref: env.CUSTOMGPT_API_KEY
        ? null
        : setupHrefWithReturnTo(study.id, "customgpt-project"),
    }),
    buildCustomGptSourceMaterialItem({
      studyId: study.id,
      sourceContextQuestionCount: readiness.sourceContextQuestionCount,
      approvedNotesCoverAll: readiness.sourceContext.approvedNotesCoverAll,
      projectId: customGptProjectId,
      coverage: customGptSourceCoverage,
    }),
    launchCheckItem({
      key: "side_pane_asset",
      label: "Side-Pane Assets",
      status: study.assets.length > 0 ? "pass" : "warning",
      detail:
        study.assets.length > 0
          ? `${study.assets.length} side-pane asset(s) are configured.`
          : "No side-pane assets are configured.",
      action:
        study.assets.length > 0
          ? null
          : "Upload a PDF, webpage, image, or other source asset on the Study Graph page.",
      actionHref:
        study.assets.length > 0
          ? null
          : studyGraphHref(study.id, "staged-assets"),
    }),
    launchCheckItem({
      key: "openai_key",
      label: "OpenAI API Key",
      status: env.OPENAI_API_KEY
        ? "pass"
        : realtimeVoiceRequiredForFielding
          ? "fail"
          : realtimeVoiceEnabled
            ? "warning"
            : "pass",
      detail: env.OPENAI_API_KEY
        ? "OPENAI_API_KEY is configured."
        : realtimeVoiceRequiredForFielding
          ? "Realtime voice is required for fielding but OPENAI_API_KEY is missing."
          : realtimeVoiceEnabled
            ? "Realtime voice is enabled but optional for fielding; OPENAI_API_KEY is needed before voice can be used."
            : "Realtime voice is disabled; OPENAI_API_KEY is not required for browser-chat fielding.",
      action:
        !env.OPENAI_API_KEY &&
        (realtimeVoiceRequiredForFielding || realtimeVoiceEnabled)
          ? realtimeVoiceRequiredForFielding
            ? "Add OPENAI_API_KEY in Research Setup to field with realtime voice."
            : "Add OPENAI_API_KEY in Research Setup when you are ready to use realtime voice."
          : null,
      actionHref:
        !env.OPENAI_API_KEY &&
        (realtimeVoiceRequiredForFielding || realtimeVoiceEnabled)
          ? setupHrefWithReturnTo(study.id, "voice-settings")
          : null,
    }),
    launchCheckItem({
      key: "voice",
      label: "Voice",
      status: readiness.voice.fieldingReady
        ? realtimeVoiceEnabled && !readiness.voice.realtimeAvailable
          ? "warning"
          : "pass"
        : "fail",
      detail:
        !realtimeVoiceRequiredForFielding && !realtimeVoiceEnabled
          ? "Realtime voice is optional and disabled for browser-chat fielding."
          : !realtimeVoiceRequiredForFielding &&
              realtimeVoiceEnabled &&
              !readiness.voice.realtimeAvailable
            ? "Realtime voice is enabled but optional for fielding; add OPENAI_API_KEY before using voice."
            : !realtimeVoiceEnabled
              ? "Realtime voice is required for fielding but disabled for this study."
              : readiness.voice.realtimeAvailable
                ? "Realtime voice is enabled and OpenAI is configured."
                : "Realtime voice is required for fielding but OPENAI_API_KEY is missing.",
      action: readiness.voice.fieldingReady
        ? realtimeVoiceEnabled && !readiness.voice.realtimeAvailable
          ? "Add OPENAI_API_KEY before using voice, or leave it optional for browser-chat fielding."
          : null
        : "Enable realtime voice and add an OpenAI key, or turn off voice-required fielding.",
      actionHref:
        readiness.voice.fieldingReady &&
        (!realtimeVoiceEnabled || readiness.voice.realtimeAvailable)
          ? null
          : studySettingsHref(study.id, "voice-settings"),
    }),
    launchCheckItem({
      key: "test_session",
      label: "Test Sessions",
      status: study.sessions.length > 0 ? "pass" : "warning",
      detail:
        study.sessions.length > 0
          ? "At least one test or respondent session exists."
          : "No sessions have been started for this study.",
      action:
        study.sessions.length > 0
          ? null
          : "Launch a seeded browser interview and review the audit.",
      actionHref:
        study.sessions.length > 0
          ? null
          : studyGraphHref(study.id, "test-session"),
    }),
  ];
  const blockingItemCount = items.filter(
    (item) => item.status === "fail",
  ).length;
  const warningItemCount = items.filter(
    (item) => item.status === "warning",
  ).length;

  return studyLaunchCheckResponseSchema.parse({
    studyId: study.id,
    studyName: study.name,
    generatedAt: new Date().toISOString(),
    status: blockingItemCount === 0 ? "ready" : "needs_setup",
    blockingItemCount,
    warningItemCount,
    recommendedActions: buildRecommendedLaunchActions(items),
    items,
  });
}

function sameJsonValue(
  left: Prisma.JsonValue | null,
  right: Prisma.JsonValue | null,
) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

type GuideCleanupQuestionNode = {
  id: string;
  key: string;
  title: string;
  prompt: string;
  config: Prisma.JsonValue | null;
  isTerminal: boolean;
  moduleId: string | null;
};

type GuideCleanupGroup = {
  cleanupNodes: GuideCleanupQuestionNode[];
  predecessor: GuideCleanupQuestionNode | null;
  successor: GuideCleanupQuestionNode | null;
};

type GuideCleanupSourceAsset = {
  id: string;
  title: string;
  description: string | null;
  storageKey: string;
};

function buildGuideCleanupGroups(
  questionNodes: GuideCleanupQuestionNode[],
  cleanupNodeIds: Set<string>,
) {
  const groups: GuideCleanupGroup[] = [];
  let index = 0;
  while (index < questionNodes.length) {
    const node = questionNodes[index];
    if (!cleanupNodeIds.has(node.id)) {
      index += 1;
      continue;
    }

    const cleanupNodes: GuideCleanupQuestionNode[] = [];
    while (
      index < questionNodes.length &&
      cleanupNodeIds.has(questionNodes[index].id)
    ) {
      cleanupNodes.push(questionNodes[index]);
      index += 1;
    }

    const firstNodeIndex = questionNodes.findIndex(
      (candidate) => candidate.id === cleanupNodes[0].id,
    );
    const predecessor =
      firstNodeIndex > 0 ? questionNodes[firstNodeIndex - 1] : null;
    const successor =
      index < questionNodes.length ? questionNodes[index] : null;

    groups.push({
      cleanupNodes,
      predecessor:
        predecessor && !cleanupNodeIds.has(predecessor.id) ? predecessor : null,
      successor:
        successor && !cleanupNodeIds.has(successor.id) ? successor : null,
    });
  }

  return groups;
}

function referenceKey(reference: GroundedReference) {
  return [
    reference.citationId,
    reference.url ?? "",
    reference.title ?? "",
  ].join("|");
}

function mergeGroundedReferences(
  existingReferences: GroundedReference[],
  fallbackReferences: GroundedReference[],
) {
  const seen = new Set<string>();
  const merged: GroundedReference[] = [];

  for (const reference of [...existingReferences, ...fallbackReferences]) {
    const parsed = groundedReferenceSchema.parse(reference);
    const key = referenceKey(parsed);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(parsed);
  }

  return merged;
}

function buildGuideCleanupSourceReferences(
  assets: GuideCleanupSourceAsset[],
) {
  return assets
    .filter((asset) => /^https?:\/\//i.test(asset.storageKey))
    .map((asset) =>
      groundedReferenceSchema.parse({
        citationId: `asset:${asset.id}`,
        title: asset.title,
        url: asset.storageKey,
        description:
          asset.description ??
          "Configured study source asset for approved survey context.",
      }),
    );
}

function buildGuideSourceContextHintUpdates(
  groups: GuideCleanupGroup[],
  fallbackReferences: GroundedReference[] = [],
) {
  return groups.flatMap((group) => {
    if (!group.predecessor) {
      return [];
    }

    const retainedHints = uniqueStrings(
      group.cleanupNodes.flatMap((node) => {
        const hint = extractSourceContextHintFromScriptedResponsePrompt(
          node.prompt,
        );
        return hint ? [hint] : [];
      }),
    );
    if (retainedHints.length === 0) {
      return [];
    }

    const predecessorConfig = asObject(group.predecessor.config);
    const existingHint =
      typeof predecessorConfig.sourceContextHint === "string" &&
      predecessorConfig.sourceContextHint.trim()
        ? predecessorConfig.sourceContextHint.trim()
        : null;
    const { mergedHint, addedHintCount, changed } = mergeSourceContextHints(
      existingHint,
      retainedHints,
    );
    const existingReferences = sourceContextReferencesFromConfig(
      predecessorConfig,
    );
    const mergedReferences = mergeGroundedReferences(
      existingReferences,
      fallbackReferences,
    );
    const referencesChanged =
      mergedReferences.length !== existingReferences.length;

    if (!changed && !referencesChanged) {
      return [];
    }

    return [
      {
        nodeId: group.predecessor.id,
        nodeKey: group.predecessor.key,
        title: group.predecessor.title,
        sourceContextHint: mergedHint,
        retainedHintCount: addedHintCount,
        referenceUpdated: referencesChanged,
        config: {
          ...predecessorConfig,
          requiresGroundedStudyContext: true,
          sourceContextHint: mergedHint,
          ...(mergedReferences.length > 0
            ? { sourceContextReferences: mergedReferences }
            : {}),
        },
        sourceContextReferences: mergedReferences,
      },
    ];
  });
}

export async function applyStudyGuideCleanup(
  studyId: string,
  input: ApplyStudyGuideCleanup,
) {
  const parsed = applyStudyGuideCleanupSchema.parse(input);
  if (!parsed.confirm) {
    throw new Error("Guide cleanup requires explicit confirmation.");
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      actionRules: true,
      actions: {
        orderBy: {
          priority: "asc",
        },
      },
      branchRules: true,
      modules: true,
      assets: {
        orderBy: {
          position: "asc",
        },
      },
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
      sessions: {
        where: {
          status: {
            in: [SessionStatus.PENDING, SessionStatus.ACTIVE],
          },
        },
        select: {
          id: true,
          status: true,
        },
        take: 1,
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  if (study.sessions.length > 0) {
    throw new Error(
      "Guide cleanup cannot be applied while active or pending sessions exist. Complete or remove those sessions first.",
    );
  }

  const cleanupItems = findScriptedResponseImportNodes({
    modules: study.modules,
    questionNodes: study.questionNodes,
  });
  const cleanupNodeIds = new Set(cleanupItems.map((item) => item.node.id));

  if (cleanupNodeIds.size === 0) {
    return studyGuideCleanupApplyResponseSchema.parse({
      studyId,
      deletedNodeCount: 0,
      deletedActionCount: 0,
      deletedBranchRuleCount: 0,
      deletedActionRuleCount: 0,
      createdBranchRuleCount: 0,
      createdActionRuleCount: 0,
      movedNodeCount: 0,
      sourceContextHintUpdatedNodeCount: 0,
      sourceContextReferenceUpdatedNodeCount: 0,
      retainedSourceContextHintCount: 0,
      remainingScriptedResponseNodeCount: 0,
      bridges: [],
    });
  }

  const nodeById = new Map(study.questionNodes.map((node) => [node.id, node]));
  const actionsByNodeId = new Map<string, typeof study.actions>();
  for (const action of study.actions) {
    if (!action.nodeId) {
      continue;
    }

    const actions = actionsByNodeId.get(action.nodeId) ?? [];
    actions.push(action);
    actionsByNodeId.set(action.nodeId, actions);
  }

  const cleanupActionIds = new Set(
    study.actions
      .filter((action) => action.nodeId && cleanupNodeIds.has(action.nodeId))
      .map((action) => action.id),
  );
  const actionById = new Map(
    study.actions.map((action) => [action.id, action]),
  );

  const groups = buildGuideCleanupGroups(study.questionNodes, cleanupNodeIds);

  const successorByCleanupNodeId = new Map<string, string>();
  const predecessorByCleanupNodeId = new Map<string, string>();
  const cleanupNodeIdByActionId = new Map<string, string>();
  const cleanupActionIdsByGroup = new Map<number, Set<string>>();
  const bridges = groups.map((group, groupIndex) => {
    const groupActionIds = new Set<string>();
    for (const cleanupNode of group.cleanupNodes) {
      if (group.successor) {
        successorByCleanupNodeId.set(cleanupNode.id, group.successor.id);
      }
      if (group.predecessor) {
        predecessorByCleanupNodeId.set(cleanupNode.id, group.predecessor.id);
      }

      for (const action of actionsByNodeId.get(cleanupNode.id) ?? []) {
        cleanupNodeIdByActionId.set(action.id, cleanupNode.id);
        groupActionIds.add(action.id);
      }
    }

    cleanupActionIdsByGroup.set(groupIndex, groupActionIds);

    return {
      fromNodeId: group.predecessor?.id ?? null,
      fromNodeKey: group.predecessor?.key ?? null,
      toNodeId: group.successor?.id ?? null,
      toNodeKey: group.successor?.key ?? null,
    };
  });

  const survivingBranchRules = study.branchRules.filter(
    (rule) =>
      !cleanupNodeIds.has(rule.fromNodeId) &&
      !cleanupNodeIds.has(rule.toNodeId),
  );
  const branchRulesToCreate: Prisma.BranchRuleCreateManyInput[] = [];
  const branchRuleExists = (candidate: {
    fromNodeId: string;
    toNodeId: string;
    conditionType: BranchConditionType;
    factKey: string | null;
    comparisonValue: Prisma.JsonValue | null;
  }) =>
    [...survivingBranchRules, ...branchRulesToCreate].some(
      (rule) =>
        rule.fromNodeId === candidate.fromNodeId &&
        rule.toNodeId === candidate.toNodeId &&
        rule.conditionType === candidate.conditionType &&
        (rule.factKey ?? null) === candidate.factKey &&
        sameJsonValue(
          "comparisonValue" in rule
            ? (rule.comparisonValue as Prisma.JsonValue | null)
            : null,
          candidate.comparisonValue,
        ),
    );

  for (const rule of study.branchRules) {
    if (
      !cleanupNodeIds.has(rule.toNodeId) ||
      cleanupNodeIds.has(rule.fromNodeId)
    ) {
      continue;
    }

    const successorNodeId = successorByCleanupNodeId.get(rule.toNodeId);
    const fromNode = nodeById.get(rule.fromNodeId);
    if (!successorNodeId || !fromNode || fromNode.isTerminal) {
      continue;
    }

    const candidate = {
      fromNodeId: rule.fromNodeId,
      toNodeId: successorNodeId,
      conditionType: rule.conditionType,
      factKey: rule.factKey ?? null,
      comparisonValue: rule.comparisonValue ?? null,
    };
    if (branchRuleExists(candidate)) {
      continue;
    }

    branchRulesToCreate.push({
      id: `guide_cleanup_branch_${randomUUID()}`,
      studyId,
      fromNodeId: candidate.fromNodeId,
      toNodeId: candidate.toNodeId,
      conditionType: candidate.conditionType,
      factKey: candidate.factKey,
      ...(candidate.comparisonValue === null
        ? {}
        : {
            comparisonValue: candidate.comparisonValue as Prisma.InputJsonValue,
          }),
      priority: rule.priority,
      rationale: rule.rationale
        ? `Guide cleanup preserved route: ${rule.rationale}`
        : "Guide cleanup bridged around imported scripted-response nodes.",
    });
  }

  for (const group of groups) {
    if (
      !group.predecessor ||
      !group.successor ||
      group.predecessor.isTerminal
    ) {
      continue;
    }

    const hasIncomingBridge = study.branchRules.some(
      (rule) =>
        rule.fromNodeId === group.predecessor?.id &&
        cleanupNodeIds.has(rule.toNodeId),
    );
    const candidate = {
      fromNodeId: group.predecessor.id,
      toNodeId: group.successor.id,
      conditionType: BranchConditionType.ALWAYS,
      factKey: null,
      comparisonValue: null,
    };
    if (hasIncomingBridge || branchRuleExists(candidate)) {
      continue;
    }

    branchRulesToCreate.push({
      id: `guide_cleanup_branch_${randomUUID()}`,
      studyId,
      fromNodeId: candidate.fromNodeId,
      toNodeId: candidate.toNodeId,
      conditionType: candidate.conditionType,
      priority: 0,
      rationale:
        "Guide cleanup bridged around imported scripted-response nodes.",
    });
  }

  const survivingActionRules = study.actionRules.filter(
    (rule) =>
      !cleanupActionIds.has(rule.toActionId) &&
      (!rule.fromActionId || !cleanupActionIds.has(rule.fromActionId)),
  );
  const actionRulesToCreate: Prisma.ActionRuleCreateManyInput[] = [];
  const actionRuleExists = (candidate: {
    fromActionId: string | null;
    toActionId: string;
    ruleType: ActionRuleType;
    conditionJson: Prisma.JsonValue | null;
  }) =>
    [...survivingActionRules, ...actionRulesToCreate].some(
      (rule) =>
        (rule.fromActionId ?? null) === candidate.fromActionId &&
        rule.toActionId === candidate.toActionId &&
        rule.ruleType === candidate.ruleType &&
        sameJsonValue(
          "conditionJson" in rule
            ? (rule.conditionJson as Prisma.JsonValue | null)
            : null,
          candidate.conditionJson,
        ),
    );

  for (const rule of study.actionRules) {
    if (
      !cleanupActionIds.has(rule.toActionId) ||
      (rule.fromActionId && cleanupActionIds.has(rule.fromActionId))
    ) {
      continue;
    }

    const cleanupNodeId = cleanupNodeIdByActionId.get(rule.toActionId);
    const successorNodeId = cleanupNodeId
      ? successorByCleanupNodeId.get(cleanupNodeId)
      : null;
    const successorAction = successorNodeId
      ? actionsByNodeId.get(successorNodeId)?.[0]
      : null;
    if (!successorAction) {
      continue;
    }

    const candidate = {
      fromActionId: rule.fromActionId ?? null,
      toActionId: successorAction.id,
      ruleType: rule.ruleType,
      conditionJson: rule.conditionJson ?? null,
    };
    if (actionRuleExists(candidate)) {
      continue;
    }

    actionRulesToCreate.push({
      id: `guide_cleanup_action_${randomUUID()}`,
      studyId,
      fromActionId: candidate.fromActionId,
      toActionId: candidate.toActionId,
      ruleType: candidate.ruleType,
      ...(candidate.conditionJson === null
        ? {}
        : { conditionJson: candidate.conditionJson as Prisma.InputJsonValue }),
      priority: rule.priority,
      rationale: rule.rationale
        ? `Guide cleanup preserved action route: ${rule.rationale}`
        : "Guide cleanup bridged around imported scripted-response actions.",
    });
  }

  for (const [groupIndex, group] of groups.entries()) {
    if (!group.predecessor || !group.successor) {
      continue;
    }

    const predecessorAction = actionsByNodeId.get(group.predecessor.id)?.[0];
    const successorAction = actionsByNodeId.get(group.successor.id)?.[0];
    if (!predecessorAction || !successorAction) {
      continue;
    }

    const groupActionIds = cleanupActionIdsByGroup.get(groupIndex) ?? new Set();
    const hasIncomingBridge = study.actionRules.some(
      (rule) =>
        rule.fromActionId === predecessorAction.id &&
        groupActionIds.has(rule.toActionId),
    );
    const candidate = {
      fromActionId: predecessorAction.id,
      toActionId: successorAction.id,
      ruleType: ActionRuleType.ALWAYS,
      conditionJson: null,
    };
    if (hasIncomingBridge || actionRuleExists(candidate)) {
      continue;
    }

    actionRulesToCreate.push({
      id: `guide_cleanup_action_${randomUUID()}`,
      studyId,
      fromActionId: candidate.fromActionId,
      toActionId: candidate.toActionId,
      ruleType: candidate.ruleType,
      priority: 0,
      rationale:
        "Guide cleanup bridged around imported scripted-response actions.",
    });
  }

  const scriptedModuleIds = new Set(
    study.modules
      .filter((module) => isScriptedResponseSectionTitle(module.title))
      .map((module) => module.id),
  );
  const nodeMoves = groups
    .filter(
      (group) =>
        group.predecessor?.moduleId &&
        group.successor?.moduleId &&
        scriptedModuleIds.has(group.successor.moduleId) &&
        group.successor.moduleId !== group.predecessor.moduleId,
    )
    .map((group) => ({
      nodeId: group.successor!.id,
      moduleId: group.predecessor!.moduleId!,
    }));
  const sourceContextHintUpdates = buildGuideSourceContextHintUpdates(
    groups,
    buildGuideCleanupSourceReferences(study.assets),
  );

  const result = await prisma.$transaction(async (tx) => {
    for (const update of sourceContextHintUpdates) {
      await tx.questionNode.update({
        where: {
          id: update.nodeId,
        },
        data: {
          config: update.config,
        },
      });
    }

    for (const move of nodeMoves) {
      await tx.questionNode.update({
        where: {
          id: move.nodeId,
        },
        data: {
          moduleId: move.moduleId,
        },
      });
      await tx.studyAction.updateMany({
        where: {
          studyId,
          nodeId: move.nodeId,
        },
        data: {
          moduleId: move.moduleId,
        },
      });
    }

    const deletedActionRules =
      cleanupActionIds.size > 0
        ? await tx.actionRule.deleteMany({
            where: {
              studyId,
              OR: [
                {
                  fromActionId: {
                    in: Array.from(cleanupActionIds),
                  },
                },
                {
                  toActionId: {
                    in: Array.from(cleanupActionIds),
                  },
                },
              ],
            },
          })
        : { count: 0 };

    const deletedBranchRules = await tx.branchRule.deleteMany({
      where: {
        studyId,
        OR: [
          {
            fromNodeId: {
              in: Array.from(cleanupNodeIds),
            },
          },
          {
            toNodeId: {
              in: Array.from(cleanupNodeIds),
            },
          },
        ],
      },
    });

    const deletedActions =
      cleanupActionIds.size > 0
        ? await tx.studyAction.deleteMany({
            where: {
              studyId,
              id: {
                in: Array.from(cleanupActionIds),
              },
            },
          })
        : { count: 0 };

    const deletedNodes = await tx.questionNode.deleteMany({
      where: {
        studyId,
        id: {
          in: Array.from(cleanupNodeIds),
        },
      },
    });

    const createdBranchRules =
      branchRulesToCreate.length > 0
        ? await tx.branchRule.createMany({
            data: branchRulesToCreate,
          })
        : { count: 0 };
    const createdActionRules =
      actionRulesToCreate.length > 0
        ? await tx.actionRule.createMany({
            data: actionRulesToCreate,
          })
        : { count: 0 };

    return {
      deletedActionRuleCount: deletedActionRules.count,
      deletedBranchRuleCount: deletedBranchRules.count,
      deletedActionCount: deletedActions.count,
      deletedNodeCount: deletedNodes.count,
      createdBranchRuleCount: createdBranchRules.count,
      createdActionRuleCount: createdActionRules.count,
      sourceContextHintUpdatedNodeCount: sourceContextHintUpdates.length,
      sourceContextReferenceUpdatedNodeCount: sourceContextHintUpdates.filter(
        (update) => update.referenceUpdated,
      ).length,
      retainedSourceContextHintCount: sourceContextHintUpdates.reduce(
        (total, update) => total + update.retainedHintCount,
        0,
      ),
    };
  });

  const remainingStudy = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      modules: true,
      assets: {
        orderBy: {
          position: "asc",
        },
      },
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });

  if (!remainingStudy) {
    throw new Error(`Study ${studyId} was not found after cleanup.`);
  }

  const remainingCleanupNodes = findScriptedResponseImportNodes({
    modules: remainingStudy.modules,
    questionNodes: remainingStudy.questionNodes,
  });

  return studyGuideCleanupApplyResponseSchema.parse({
    studyId,
    ...result,
    movedNodeCount: nodeMoves.length,
    remainingScriptedResponseNodeCount: remainingCleanupNodes.length,
    bridges,
  });
}

export async function retainStudyGuideSourceNotes(
  studyId: string,
  input: RetainStudyGuideSourceNotes,
) {
  const parsed = retainStudyGuideSourceNotesSchema.parse(input);
  if (!parsed.confirm) {
    throw new Error("Source-note retention requires explicit confirmation.");
  }

  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      modules: true,
      assets: {
        orderBy: {
          position: "asc",
        },
      },
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const cleanupItems = findScriptedResponseImportNodes({
    modules: study.modules,
    questionNodes: study.questionNodes,
  });
  const cleanupNodeIds = new Set(cleanupItems.map((item) => item.node.id));

  if (cleanupNodeIds.size === 0) {
    return studyGuideSourceNoteRetentionResponseSchema.parse({
      studyId,
      sourceContextHintUpdatedNodeCount: 0,
      sourceContextReferenceUpdatedNodeCount: 0,
      retainedSourceContextHintCount: 0,
      remainingScriptedResponseNodeCount: 0,
      updatedNodes: [],
    });
  }

  const groups = buildGuideCleanupGroups(study.questionNodes, cleanupNodeIds);
  const sourceContextHintUpdates = buildGuideSourceContextHintUpdates(
    groups,
    buildGuideCleanupSourceReferences(study.assets),
  );

  await prisma.$transaction(async (tx) => {
    for (const update of sourceContextHintUpdates) {
      await tx.questionNode.update({
        where: {
          id: update.nodeId,
        },
        data: {
          config: update.config,
        },
      });
    }
  });

  return studyGuideSourceNoteRetentionResponseSchema.parse({
    studyId,
    sourceContextHintUpdatedNodeCount: sourceContextHintUpdates.length,
    sourceContextReferenceUpdatedNodeCount: sourceContextHintUpdates.filter(
      (update) => update.referenceUpdated,
    ).length,
    retainedSourceContextHintCount: sourceContextHintUpdates.reduce(
      (total, update) => total + update.retainedHintCount,
      0,
    ),
    remainingScriptedResponseNodeCount: cleanupItems.length,
    updatedNodes: sourceContextHintUpdates.map((update) => ({
      nodeId: update.nodeId,
      nodeKey: update.nodeKey,
      title: update.title,
      sourceContextHint: update.sourceContextHint,
      sourceContextReferences: update.sourceContextReferences,
    })),
  });
}

export async function getStudySettings(studyId: string) {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      assets: {
        select: { id: true },
      },
      modules: {
        select: {
          id: true,
          title: true,
        },
      },
      questionNodes: {
        orderBy: {
          position: "asc",
        },
        select: {
          id: true,
          key: true,
          title: true,
          prompt: true,
          isTerminal: true,
          moduleId: true,
          nodeType: true,
          config: true,
        },
      },
      branchRules: {
        select: {
          fromNodeId: true,
          conditionType: true,
        },
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const config = asObject(study.config);
  const scriptedResponseImportNodes = findScriptedResponseImportNodes({
    modules: study.modules,
    questionNodes: study.questionNodes,
  });
  const scriptedResponseNodeIds = new Set(
    scriptedResponseImportNodes.map((item) => item.node.id),
  );

  return studySettingsResponseSchema.parse({
    studyId: study.id,
    studyName: study.name,
    customGptProjectId: stringFromConfig(config, "customGptProjectId"),
    timeboxStrategy: timeboxStrategyFromConfig(config),
    targetDurationSeconds: numberFromConfig(
      config,
      "targetDurationSeconds",
      900,
    ),
    closingReserveSeconds: numberFromConfig(
      config,
      "closingReserveSeconds",
      90,
    ),
    maxAttemptsPerQuestion: numberFromConfig(
      config,
      "maxAttemptsPerQuestion",
      2,
    ),
    maxOffTopicRedirects: numberFromConfig(config, "maxOffTopicRedirects", 2),
    realtimeVoiceEnabled: booleanFromConfig(
      config,
      "realtimeVoiceEnabled",
      false,
    ),
    realtimeVoiceRequiredForFielding: booleanFromConfig(
      config,
      "realtimeVoiceRequiredForFielding",
      false,
    ),
    fieldingReadiness: buildFieldingReadiness({
      config,
      questionNodes: study.questionNodes,
      branchRules: study.branchRules,
      assetCount: study.assets.length,
      excludedSourceContextNodeIds: scriptedResponseNodeIds,
    }),
  });
}

export async function updateStudySettings(
  studyId: string,
  input: UpdateStudySettings,
) {
  const parsed = updateStudySettingsSchema.parse(input);
  const study = await prisma.study.findUnique({
    where: { id: studyId },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const nextConfig: Prisma.JsonObject = {
    ...asObject(study.config),
  };

  for (const [key, value] of Object.entries(parsed)) {
    if (value === undefined) {
      continue;
    }

    if (key === "customGptProjectId") {
      if (typeof value === "string" && value.trim()) {
        nextConfig.customGptProjectId = value.trim();
      } else {
        delete nextConfig.customGptProjectId;
      }
      continue;
    }

    nextConfig[key] = value;
  }

  await prisma.study.update({
    where: { id: studyId },
    data: {
      config: nextConfig,
    },
  });

  return getStudySettings(studyId);
}

function toStudyQuestionGroundingResponse(
  studyId: string,
  node: { id: string; prompt: string },
  config: Prisma.JsonObject,
) {
  const requirement = resolveGroundedStudyContextRequirement({
    prompt: node.prompt,
    requiresGroundedStudyContext: config.requiresGroundedStudyContext,
  });

  return studyQuestionGroundingResponseSchema.parse({
    studyId,
    nodeId: node.id,
    requiresGroundedStudyContext: requirement.requiresGroundedStudyContext,
    sourceContextDetected: requirement.detectedByPrompt,
    sourceContextOverride: requirement.sourceContextOverride,
    sourceContextHint:
      typeof config.sourceContextHint === "string" &&
      config.sourceContextHint.trim()
        ? config.sourceContextHint.trim()
        : null,
    sourceContextReferences: sourceContextReferencesFromConfig(config),
  });
}

export async function updateStudyQuestionGrounding(
  studyId: string,
  nodeId: string,
  input: UpdateStudyQuestionGrounding,
) {
  const parsed = updateStudyQuestionGroundingSchema.parse(input);
  const node = await prisma.questionNode.findFirst({
    where: {
      id: nodeId,
      studyId,
    },
  });

  if (!node) {
    throw new Error(`Question ${nodeId} was not found in study ${studyId}.`);
  }

  const nextConfig: Prisma.JsonObject = {
    ...asObject(node.config),
    requiresGroundedStudyContext: parsed.requiresGroundedStudyContext,
  };

  if (Object.prototype.hasOwnProperty.call(parsed, "sourceContextHint")) {
    if (typeof parsed.sourceContextHint === "string") {
      nextConfig.sourceContextHint = parsed.sourceContextHint.trim();
    } else {
      delete nextConfig.sourceContextHint;
      delete nextConfig.sourceContextReferences;
    }
  }

  if (Object.prototype.hasOwnProperty.call(parsed, "sourceContextReferences")) {
    const sourceContextReferences = parsed.sourceContextReferences ?? [];
    if (sourceContextReferences.length > 0) {
      nextConfig.sourceContextReferences = sourceContextReferences;
    } else {
      delete nextConfig.sourceContextReferences;
    }
  }

  const updatedNode = await prisma.questionNode.update({
    where: {
      id: node.id,
    },
    data: {
      config: nextConfig,
    },
  });

  return toStudyQuestionGroundingResponse(studyId, updatedNode, nextConfig);
}

export async function updateStudySourceContextNotes(
  studyId: string,
  input: UpdateStudySourceContextNotes,
) {
  const parsed = updateStudySourceContextNotesSchema.parse(input);
  const nodeIds = parsed.notes.map((note) => note.nodeId);
  const uniqueNodeIds = new Set(nodeIds);

  if (uniqueNodeIds.size !== nodeIds.length) {
    throw new Error("Duplicate source-context note node IDs are not allowed.");
  }

  const nodes = await prisma.questionNode.findMany({
    where: {
      id: {
        in: nodeIds,
      },
      studyId,
    },
  });
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const missingNodeIds = nodeIds.filter((nodeId) => !nodesById.has(nodeId));

  if (missingNodeIds.length > 0) {
    throw new Error(
      `Question(s) not found in study ${studyId}: ${missingNodeIds.join(", ")}`,
    );
  }

  const updatedNodes = await prisma.$transaction(
    parsed.notes.map((note) => {
      const node = nodesById.get(note.nodeId);
      if (!node) {
        throw new Error(`Question ${note.nodeId} was not found.`);
      }

      const nextConfig: Prisma.JsonObject = {
        ...asObject(node.config),
        requiresGroundedStudyContext: true,
        sourceContextHint: note.sourceContextHint.trim(),
      };

      if (note.sourceContextReferences.length > 0) {
        nextConfig.sourceContextReferences = note.sourceContextReferences;
      } else {
        delete nextConfig.sourceContextReferences;
      }

      return prisma.questionNode.update({
        where: {
          id: node.id,
        },
        data: {
          config: nextConfig,
        },
      });
    }),
  );

  return updateStudySourceContextNotesResponseSchema.parse({
    studyId,
    appliedCount: updatedNodes.length,
    questions: updatedNodes.map((node) =>
      toStudyQuestionGroundingResponse(studyId, node, asObject(node.config)),
    ),
  });
}

export async function previewStudyQuestionGrounding(
  studyId: string,
  nodeId: string,
) {
  const study = await prisma.study.findUnique({
    where: {
      id: studyId,
    },
    include: {
      questionNodes: {
        where: {
          id: nodeId,
        },
        take: 1,
      },
      actions: {
        orderBy: {
          priority: "asc",
        },
      },
      actionRules: {
        include: {
          fromAction: {
            include: {
              asset: true,
            },
          },
        },
        orderBy: {
          priority: "asc",
        },
      },
      assetStageRules: {
        include: {
          asset: true,
          triggerAction: true,
        },
        orderBy: {
          priority: "asc",
        },
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const node = study.questionNodes[0] ?? null;
  if (!node) {
    throw new Error(`Question ${nodeId} was not found in study ${studyId}.`);
  }

  const config = asObject(study.config);
  const projectId =
    stringFromConfig(config, "customGptProjectId") ??
    env.CUSTOMGPT_PROJECT_ID ??
    null;
  const askAction = study.actions.find(
    (action) =>
      action.nodeId === node.id && action.actionType === "ASK_QUESTION",
  );
  const incomingShowAssetAction = askAction
    ? (study.actionRules.find(
        (rule) =>
          rule.toActionId === askAction.id &&
          rule.fromAction?.actionType === "SHOW_ASSET" &&
          rule.fromAction.asset,
      )?.fromAction ?? null)
    : null;
  const stagedAsset =
    incomingShowAssetAction?.asset ??
    (incomingShowAssetAction
      ? (study.assetStageRules.find(
          (rule) => rule.triggerActionId === incomingShowAssetAction.id,
        )?.asset ?? null)
      : null);
  const assetTitle = stagedAsset?.title ?? null;
  const nodeConfig = asObject(node.config);
  const sourceContextHint =
    typeof nodeConfig.sourceContextHint === "string" &&
    nodeConfig.sourceContextHint.trim()
      ? nodeConfig.sourceContextHint.trim()
      : null;
  const sourceLine =
    typeof nodeConfig.sourceLine === "number" &&
    Number.isFinite(nodeConfig.sourceLine)
      ? nodeConfig.sourceLine
      : null;
  const sourceContextReferences = sourceContextReferencesFromConfig(nodeConfig);
  const importedGuidePreview = sourceContextHint
    ? {
        answer: sourceContextHint,
        references:
          sourceContextReferences.length > 0
            ? sourceContextReferences
            : [
                {
                  citationId: `guide:${node.id}`,
                  title: "Imported survey guide",
                  url: null,
                  description: sourceLine
                    ? `Researcher-provided source-context hint imported from guide line ${sourceLine}.`
                    : "Researcher-provided source-context hint imported from the survey guide.",
                },
              ],
      }
    : null;
  const surveyContext = [
    `Study: ${study.name}`,
    study.description ? `Study description: ${study.description}` : null,
    `Question title: ${node.title}`,
    `Question prompt: ${node.prompt}`,
    assetTitle ? `Staged source asset: ${assetTitle}` : null,
    "Preview purpose: generate the source context that would be shown before this survey question. Do not answer for the respondent.",
  ]
    .filter(Boolean)
    .join("\n");
  const generatedAt = new Date().toISOString();

  try {
    const result = await askCustomGptForProactiveStudyContext({
      projectId,
      question: node.prompt,
      surveyContext,
      assetTitle,
    });
    const hasUnreferencedCustomGptAnswer =
      Boolean(result.answer) && result.references.length === 0;

    if (hasUnreferencedCustomGptAnswer && importedGuidePreview) {
      return studyQuestionGroundingPreviewResponseSchema.parse({
        studyId,
        nodeId: node.id,
        nodeKey: node.key,
        questionTitle: node.title,
        questionPrompt: node.prompt,
        generatedAt,
        projectId,
        source: "imported_guide",
        status: "passed",
        checked: result.enabled,
        assetTitle,
        answer: importedGuidePreview.answer,
        references: importedGuidePreview.references,
        referenceCount: importedGuidePreview.references.length,
        reason:
          "CustomGPT returned source context but no references; using the approved guide note.",
      });
    }

    if (hasUnreferencedCustomGptAnswer) {
      return studyQuestionGroundingPreviewResponseSchema.parse({
        studyId,
        nodeId: node.id,
        nodeKey: node.key,
        questionTitle: node.title,
        questionPrompt: node.prompt,
        generatedAt,
        projectId,
        source: "customgpt",
        status: "failed",
        checked: result.enabled,
        assetTitle,
        answer: null,
        references: [],
        referenceCount: 0,
        reason:
          "CustomGPT returned proactive source context but no references. Add cited source material before fielding.",
      });
    }

    if (!result.answer && importedGuidePreview) {
      return studyQuestionGroundingPreviewResponseSchema.parse({
        studyId,
        nodeId: node.id,
        nodeKey: node.key,
        questionTitle: node.title,
        questionPrompt: node.prompt,
        generatedAt,
        projectId,
        source: "imported_guide",
        status: "passed",
        checked: result.enabled,
        assetTitle,
        answer: importedGuidePreview.answer,
        references: importedGuidePreview.references,
        referenceCount: importedGuidePreview.references.length,
        reason: null,
      });
    }

    return studyQuestionGroundingPreviewResponseSchema.parse({
      studyId,
      nodeId: node.id,
      nodeKey: node.key,
      questionTitle: node.title,
      questionPrompt: node.prompt,
      generatedAt,
      projectId,
      source: result.answer ? "customgpt" : "none",
      status: !result.enabled ? "skipped" : result.answer ? "passed" : "failed",
      checked: result.enabled,
      assetTitle,
      answer: result.answer,
      references: result.references,
      referenceCount: result.references.length,
      reason:
        result.reason ??
        (result.answer ? null : "CustomGPT did not return a preview answer."),
    });
  } catch (error) {
    if (importedGuidePreview) {
      return studyQuestionGroundingPreviewResponseSchema.parse({
        studyId,
        nodeId: node.id,
        nodeKey: node.key,
        questionTitle: node.title,
        questionPrompt: node.prompt,
        generatedAt,
        projectId,
        source: "imported_guide",
        status: "passed",
        checked: false,
        assetTitle,
        answer: importedGuidePreview.answer,
        references: importedGuidePreview.references,
        referenceCount: importedGuidePreview.references.length,
        reason: null,
      });
    }

    return studyQuestionGroundingPreviewResponseSchema.parse({
      studyId,
      nodeId: node.id,
      nodeKey: node.key,
      questionTitle: node.title,
      questionPrompt: node.prompt,
      generatedAt,
      projectId,
      source: "none",
      status: "failed",
      checked: true,
      assetTitle,
      answer: null,
      references: [],
      referenceCount: 0,
      reason:
        error instanceof Error ? error.message : "CustomGPT preview failed.",
    });
  }
}

export async function previewStudySourceContext(studyId: string) {
  const study = await prisma.study.findUnique({
    where: {
      id: studyId,
    },
    include: {
      modules: true,
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const scriptedResponseImportNodes = findScriptedResponseImportNodes({
    modules: study.modules,
    questionNodes: study.questionNodes,
  });
  const scriptedResponseNodeIds = new Set(
    scriptedResponseImportNodes.map((item) => item.node.id),
  );
  const previewNodes = study.questionNodes.filter((node) => {
    if (scriptedResponseNodeIds.has(node.id)) {
      return false;
    }

    const config = asObject(node.config);
    const requirement = resolveGroundedStudyContextRequirement({
      prompt: node.prompt,
      requiresGroundedStudyContext: config.requiresGroundedStudyContext,
    });

    return requirement.requiresGroundedStudyContext;
  });
  const previews = [];

  for (const node of previewNodes) {
    previews.push(await previewStudyQuestionGrounding(studyId, node.id));
  }

  const passedCount = previews.filter(
    (preview) => preview.status === "passed",
  ).length;
  const skippedCount = previews.filter(
    (preview) => preview.status === "skipped",
  ).length;
  const failedCount = previews.filter(
    (preview) => preview.status === "failed",
  ).length;
  const status =
    failedCount > 0
      ? "failed"
      : previews.length > 0 && passedCount === previews.length
        ? "passed"
        : "skipped";

  return studySourceContextPreviewResponseSchema.parse({
    studyId,
    generatedAt: new Date().toISOString(),
    status,
    previewCount: previews.length,
    passedCount,
    skippedCount,
    failedCount,
    previews,
  });
}

export async function createStudyAsset(
  studyId: string,
  input: CreateStudyAsset,
) {
  const parsed = createStudyAssetSchema.parse(input);
  const study = await prisma.study.findUnique({
    where: {
      id: studyId,
    },
    include: {
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
      actions: true,
      assets: true,
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const targetNode =
    (parsed.stageNodeId
      ? study.questionNodes.find((node) => node.id === parsed.stageNodeId)
      : null) ??
    study.questionNodes.find((node) => !node.isTerminal) ??
    study.questionNodes[0] ??
    null;

  if (!targetNode) {
    throw new Error("Add at least one question before staging an asset.");
  }

  const targetQuestionAction =
    study.actions.find(
      (action) =>
        action.nodeId === targetNode.id && action.actionType === "ASK_QUESTION",
    ) ?? null;

  if (!targetQuestionAction) {
    throw new Error(
      `Question ${targetNode.key} does not have an ask action to attach an asset to.`,
    );
  }

  const sourceName =
    parsed.fileName ??
    (parsed.storageKey ? fileNameFromPath(parsed.storageKey) : null) ??
    parsed.title;
  const mimeType =
    parsed.mimeType ??
    mimeTypeFromName(parsed.fileName) ??
    mimeTypeFromName(parsed.storageKey) ??
    "application/octet-stream";
  const assetKey = await uniqueAssetKey(
    studyId,
    slugify(parsed.title).slice(0, 48) || "side-pane-asset",
  );
  const assetId = randomUUID();
  const actionId = randomUUID();
  const stageRuleId = randomUUID();
  const storageKey = parsed.fileBase64
    ? `db://study-assets/${assetId}/content`
    : (parsed.storageKey?.trim() ?? sourceName);
  const maxAssetPosition = study.assets.reduce(
    (maxPosition, asset) => Math.max(maxPosition, asset.position),
    0,
  );

  const created = await prisma.$transaction(async (tx) => {
    const asset = await tx.studyAsset.create({
      data: {
        id: assetId,
        studyId,
        key: assetKey,
        title: parsed.title,
        description: parsed.description?.trim() || null,
        assetType: inferAssetType({
          explicitType: parsed.assetType,
          mimeType,
          sourceName,
        }),
        storageKey,
        mimeType,
        metadata: {
          source: "study-admin",
          fileName: parsed.fileName ?? null,
          fileBase64: parsed.fileBase64 ?? null,
        } satisfies Prisma.JsonObject,
        status: "ACTIVE",
        position: maxAssetPosition + 1,
      },
    });

    const action = await tx.studyAction.create({
      data: {
        id: actionId,
        studyId,
        moduleId: targetNode.moduleId,
        nodeId: null,
        assetId: asset.id,
        key: `show-${asset.key}`,
        actionType: "SHOW_ASSET",
        goal: `Stage ${asset.title} in the side pane.`,
        mustComplete: true,
        priority: Math.max(1, targetQuestionAction.priority - 1),
        config: {
          displayMode: parsed.displayMode,
          stagedBeforeNodeId: targetNode.id,
        } satisfies Prisma.JsonObject,
      },
    });

    const stageRule = await tx.assetStageRule.create({
      data: {
        id: stageRuleId,
        studyId,
        assetId: asset.id,
        moduleId: targetNode.moduleId,
        triggerActionId: action.id,
        triggerType: "AFTER_ACTION",
        displayMode: parsed.displayMode,
        required: true,
        priority: 1,
        rationale: `Show ${asset.title} before ${targetNode.title}.`,
      },
    });

    await tx.actionRule.create({
      data: {
        id: `${actionId}_to_${targetQuestionAction.id}`,
        studyId,
        fromActionId: action.id,
        toActionId: targetQuestionAction.id,
        ruleType: "AFTER_ACTION",
        priority: 1,
        rationale: `Show ${asset.title} before ${targetNode.title}.`,
      },
    });

    return { asset, action, stageRule };
  });

  return studyAssetMutationResponseSchema.parse({
    studyId,
    asset: {
      id: created.asset.id,
      key: created.asset.key,
      title: created.asset.title,
      description: created.asset.description ?? null,
      assetType: created.asset.assetType,
      mimeType: created.asset.mimeType ?? null,
      storageKey: created.asset.storageKey,
      position: created.asset.position,
    },
    action: {
      id: created.action.id,
      key: created.action.key,
      actionType: created.action.actionType,
      moduleId: created.action.moduleId,
      nodeId: created.action.nodeId,
      nodeKey: null,
      assetId: created.action.assetId,
      assetKey: created.asset.key,
      goal: created.action.goal ?? null,
      mustComplete: created.action.mustComplete,
      priority: created.action.priority,
    },
    stageRule: {
      id: created.stageRule.id,
      assetId: created.stageRule.assetId,
      assetKey: created.asset.key,
      triggerActionId: created.stageRule.triggerActionId,
      triggerActionKey: created.action.key,
      triggerType: created.stageRule.triggerType,
      displayMode: created.stageRule.displayMode,
      required: created.stageRule.required,
      priority: created.stageRule.priority,
      rationale: created.stageRule.rationale ?? null,
    },
  });
}

export async function updateStudyAssetDisplayMode(
  studyId: string,
  assetId: string,
  input: UpdateStudyAssetDisplayMode,
) {
  const parsed = updateStudyAssetDisplayModeSchema.parse(input);
  const asset = await prisma.studyAsset.findFirst({
    where: {
      id: assetId,
      studyId,
    },
    select: {
      id: true,
      key: true,
    },
  });

  if (!asset) {
    throw new Error(`Asset ${assetId} was not found in study ${studyId}.`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const existingStageRuleCount = await tx.assetStageRule.count({
      where: {
        studyId,
        assetId,
      },
    });

    if (existingStageRuleCount === 0) {
      throw new Error(`Asset ${assetId} is not staged in this study.`);
    }

    const stageRuleUpdate = await tx.assetStageRule.updateMany({
      where: {
        studyId,
        assetId,
      },
      data: {
        displayMode: parsed.displayMode,
      },
    });
    const sessionAssetUpdate = await tx.sessionAsset.updateMany({
      where: {
        studyId,
        assetId,
        session: {
          status: {
            in: [SessionStatus.ACTIVE, SessionStatus.PENDING],
          },
        },
      },
      data: {
        displayMode: parsed.displayMode,
      },
    });
    const stageRules = await tx.assetStageRule.findMany({
      where: {
        studyId,
        assetId,
      },
      include: {
        asset: true,
        triggerAction: true,
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    });

    return {
      stageRuleUpdate,
      sessionAssetUpdate,
      stageRules,
    };
  });

  return studyAssetDisplayModeResponseSchema.parse({
    studyId,
    assetId,
    displayMode: parsed.displayMode,
    updatedStageRuleCount: result.stageRuleUpdate.count,
    updatedActiveSessionAssetCount: result.sessionAssetUpdate.count,
    stageRules: result.stageRules.map((stageRule) => ({
      id: stageRule.id,
      assetId: stageRule.assetId,
      assetKey: stageRule.asset.key,
      triggerActionId: stageRule.triggerActionId,
      triggerActionKey: stageRule.triggerAction?.key ?? null,
      triggerType: stageRule.triggerType,
      displayMode: stageRule.displayMode,
      required: stageRule.required,
      priority: stageRule.priority,
      rationale: stageRule.rationale ?? null,
    })),
  });
}

export async function createStudyBranchRule(
  studyId: string,
  input: CreateStudyBranchRule,
) {
  const parsed = createStudyBranchRuleSchema.parse(input);
  if (parsed.fromNodeId === parsed.toNodeId) {
    throw new Error("Branch source and target must be different questions.");
  }

  const matchKeywords = normalizeMatchKeywords(parsed.matchKeywords);

  if (matchKeywords.length === 0) {
    throw new Error("At least one match keyword is required.");
  }

  const [fromNode, toNode, questionNodes, conditionalRuleCount, existingRules] =
    await Promise.all([
      prisma.questionNode.findFirst({
        where: {
          id: parsed.fromNodeId,
          studyId,
        },
      }),
      prisma.questionNode.findFirst({
        where: {
          id: parsed.toNodeId,
          studyId,
        },
      }),
      prisma.questionNode.findMany({
        where: {
          studyId,
        },
        orderBy: {
          position: "asc",
        },
      }),
      prisma.branchRule.count({
        where: {
          studyId,
          fromNodeId: parsed.fromNodeId,
          conditionType: {
            not: "ALWAYS",
          },
        },
      }),
      prisma.branchRule.findMany({
        where: {
          studyId,
          fromNodeId: parsed.fromNodeId,
          toNodeId: parsed.toNodeId,
          conditionType: "ANSWER_CONTAINS",
        },
      }),
    ]);

  if (!fromNode) {
    throw new Error(`Source question ${parsed.fromNodeId} was not found.`);
  }

  if (!toNode) {
    throw new Error(`Target question ${parsed.toNodeId} was not found.`);
  }

  const fromConfig = asObject(fromNode.config);
  const existingFactKeys = factKeysFromConfig(fromConfig);
  const fallbackFactKey = normalizeFactKey(
    `branch_route_${fromNode.key}`,
    "branch_route_answer",
  );
  const factKey = normalizeFactKey(
    parsed.factKey ?? fallbackFactKey,
    fallbackFactKey,
  );

  const duplicateRule = existingRules.find((rule) =>
    sameKeywordSet(
      comparisonValueKeywords(rule.comparisonValue),
      matchKeywords,
    ),
  );
  if (duplicateRule) {
    throw new Error("A matching conditional branch rule already exists.");
  }

  const nextFactKeys = uniqueStrings([...existingFactKeys, factKey]);
  const rationale =
    parsed.rationale ??
    `Route to ${toNode.title} when ${fromNode.title} mentions ${matchKeywords.join(
      ", ",
    )}.`;
  const fromNodeIndex = questionNodes.findIndex(
    (node) => node.id === fromNode.id,
  );
  const inferredFallbackNode =
    fromNodeIndex >= 0
      ? (questionNodes
          .slice(fromNodeIndex + 1)
          .find((node) => !node.isTerminal) ??
        questionNodes.slice(fromNodeIndex + 1)[0] ??
        null)
      : null;

  const createdRule = await prisma.$transaction(async (tx) => {
    if (nextFactKeys.length !== existingFactKeys.length) {
      await tx.questionNode.update({
        where: {
          id: fromNode.id,
        },
        data: {
          config: {
            ...fromConfig,
            factKeys: nextFactKeys,
          },
        },
      });
    }

    const fallbackRule = await tx.branchRule.findFirst({
      where: {
        studyId,
        fromNodeId: fromNode.id,
        conditionType: "ALWAYS",
      },
      orderBy: {
        priority: "asc",
      },
    });

    if (
      fallbackRule &&
      !/fallback|conditions do not match/i.test(fallbackRule.rationale ?? "")
    ) {
      await tx.branchRule.update({
        where: {
          id: fallbackRule.id,
        },
        data: {
          rationale: fallbackRule.rationale
            ? `Fallback when conditions do not match. Original route: ${fallbackRule.rationale}`
            : "Fallback when conditions do not match.",
        },
      });
    } else if (!fallbackRule && inferredFallbackNode) {
      await tx.branchRule.create({
        data: {
          id: `fallback_${randomUUID()}`,
          studyId,
          fromNodeId: fromNode.id,
          toNodeId: inferredFallbackNode.id,
          conditionType: BranchConditionType.ALWAYS,
          factKey: null,
          priority: conditionalRuleCount + 100,
          rationale:
            "Fallback when conditions do not match. Preserves imported guide order.",
        },
      });
    }

    return tx.branchRule.create({
      data: {
        studyId,
        fromNodeId: fromNode.id,
        toNodeId: toNode.id,
        conditionType: "ANSWER_CONTAINS",
        factKey,
        comparisonValue: matchKeywords,
        priority: conditionalRuleCount,
        rationale,
      },
    });
  });

  return studyBranchRuleMutationResponseSchema.parse({
    studyId,
    rule: branchRuleToGraphEdge(createdRule),
  });
}

export async function createStudyBranchRules(
  studyId: string,
  input: CreateStudyBranchRules,
) {
  const parsed = createStudyBranchRulesSchema.parse(input);
  const createdRules = [];
  let skippedCount = 0;

  for (const [index, rule] of parsed.rules.entries()) {
    try {
      const created = await createStudyBranchRule(studyId, rule);
      createdRules.push(created.rule);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unable to create branch rule.";

      if (message.includes("already exists")) {
        skippedCount += 1;
        continue;
      }

      throw new Error(`Rule ${index + 1}: ${message}`);
    }
  }

  return studyBranchRuleBatchMutationResponseSchema.parse({
    studyId,
    rules: createdRules,
    createdCount: createdRules.length,
    skippedCount,
  });
}

function chunkBranchRules(
  rules: CreateStudyBranchRules["rules"],
  chunkSize = 50,
) {
  const chunks: Array<CreateStudyBranchRules["rules"]> = [];

  for (let index = 0; index < rules.length; index += chunkSize) {
    chunks.push(rules.slice(index, index + chunkSize));
  }

  return chunks;
}

export async function applyRecommendedStudyBranchRules(studyId: string) {
  const graph = await getStudyGraph(studyId);
  const recommendedSuggestions = graph.branchSuggestions.filter(
    (suggestion) => suggestion.recommended,
  );
  const rulesToCreate = recommendedSuggestions.map((suggestion) => ({
    fromNodeId: suggestion.fromNodeId,
    toNodeId: suggestion.toNodeId,
    matchKeywords: suggestion.matchKeywords,
    rationale: suggestion.rationale,
  }));
  const createdRules = [];
  let skippedCount = 0;

  for (const rules of chunkBranchRules(rulesToCreate)) {
    const result = await createStudyBranchRules(studyId, {
      rules,
    });
    createdRules.push(...result.rules);
    skippedCount += result.skippedCount;
  }

  const dryRuns: StudyRecommendedBranchRouteDryRun[] = [];
  for (const suggestion of recommendedSuggestions) {
    try {
      const simulation = await simulateStudyBranchRoute(studyId, {
        fromNodeId: suggestion.fromNodeId,
        answer: suggestion.sampleAnswer,
      });
      const selectedTitle = simulation.selectedTargetNode?.title ?? "no route";
      const matchedExpected =
        simulation.selectedTargetNode?.nodeId === suggestion.toNodeId;

      dryRuns.push({
        suggestionId: suggestion.id,
        fromNodeTitle: suggestion.fromNodeTitle,
        toNodeTitle: suggestion.toNodeTitle,
        sampleAnswer: suggestion.sampleAnswer,
        status: matchedExpected ? "pass" : "fail",
        detail: matchedExpected
          ? `Sample answer routed to ${suggestion.toNodeTitle}.`
          : `Expected ${suggestion.toNodeTitle}, but routed to ${selectedTitle}. ${simulation.selectedReason}`,
      });
    } catch (error) {
      dryRuns.push({
        suggestionId: suggestion.id,
        fromNodeTitle: suggestion.fromNodeTitle,
        toNodeTitle: suggestion.toNodeTitle,
        sampleAnswer: suggestion.sampleAnswer,
        status: "fail",
        detail:
          error instanceof Error
            ? error.message
            : "Unable to dry-run this recommended route.",
      });
    }
  }

  const passedDryRunCount = dryRuns.filter(
    (result) => result.status === "pass",
  ).length;

  return studyRecommendedBranchRulesApplyResponseSchema.parse({
    studyId,
    suggestionCount: graph.branchSuggestions.length,
    recommendedCount: recommendedSuggestions.length,
    rules: createdRules,
    createdCount: createdRules.length,
    skippedCount,
    dryRunCount: dryRuns.length,
    passedDryRunCount,
    failedDryRunCount: dryRuns.length - passedDryRunCount,
    dryRuns,
  });
}

export async function simulateStudyBranchRoute(
  studyId: string,
  input: SimulateStudyBranchRoute,
) {
  const parsed = simulateStudyBranchRouteSchema.parse(input);
  const study = await prisma.study.findUnique({
    where: {
      id: studyId,
    },
    include: {
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
      branchRules: {
        where: {
          fromNodeId: parsed.fromNodeId,
        },
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const fromNode = study.questionNodes.find(
    (node) => node.id === parsed.fromNodeId,
  );
  if (!fromNode) {
    throw new Error(`Source question ${parsed.fromNodeId} was not found.`);
  }

  const orderIndexByNodeId = new Map(
    study.questionNodes.map((node, index) => [node.id, index]),
  );
  const nodeById = new Map(study.questionNodes.map((node) => [node.id, node]));
  const outgoingRules = [...study.branchRules].sort((left, right) => {
    if (left.priority !== right.priority) {
      return left.priority - right.priority;
    }

    return (
      (orderIndexByNodeId.get(left.toNodeId) ?? 9999) -
      (orderIndexByNodeId.get(right.toNodeId) ?? 9999)
    );
  });
  const conditionalEvaluations = outgoingRules
    .filter((rule) => rule.conditionType !== "ALWAYS")
    .map((rule) => {
      const targetNode = nodeById.get(rule.toNodeId);
      if (!targetNode) {
        throw new Error(`Target question ${rule.toNodeId} was not found.`);
      }

      const result = evaluateBranchRule(rule, parsed.answer);
      return {
        rule: branchRuleToGraphEdge(rule),
        targetNode: {
          nodeId: targetNode.id,
          nodeKey: targetNode.key,
          title: targetNode.title,
        },
        matched: result.matched,
        reason: result.reason,
        matchedKeywordCount: result.matchedKeywordCount,
        matchedKeywordLength: result.matchedKeywordLength,
        targetOrder: orderIndexByNodeId.get(rule.toNodeId) ?? 9999,
      };
    });
  const matchedConditional =
    conditionalEvaluations
      .filter((evaluation) => evaluation.matched)
      .sort(compareBranchRuleEvaluations)[0] ?? null;
  const fallbackRule = outgoingRules.find(
    (rule) => rule.conditionType === "ALWAYS",
  );
  const selectedRule =
    matchedConditional?.rule ??
    (fallbackRule ? branchRuleToGraphEdge(fallbackRule) : null);
  const selectedTargetNode =
    matchedConditional?.targetNode ??
    (fallbackRule
      ? (() => {
          const targetNode = nodeById.get(fallbackRule.toNodeId);
          if (!targetNode) {
            throw new Error(
              `Target question ${fallbackRule.toNodeId} was not found.`,
            );
          }

          return {
            nodeId: targetNode.id,
            nodeKey: targetNode.key,
            title: targetNode.title,
          };
        })()
      : null);
  const selectedReason = matchedConditional
    ? matchedConditional.reason
    : fallbackRule
      ? "No conditional route matched, so the fallback route would run."
      : "No conditional or fallback route is configured from this question.";

  return studyBranchRouteSimulationResponseSchema.parse({
    studyId,
    fromNode: {
      nodeId: fromNode.id,
      nodeKey: fromNode.key,
      title: fromNode.title,
    },
    answer: parsed.answer,
    selectedRule,
    selectedTargetNode,
    selectedReason,
    matchedCondition: Boolean(matchedConditional),
    evaluatedRules: conditionalEvaluations,
    fallbackRule: fallbackRule ? branchRuleToGraphEdge(fallbackRule) : null,
  });
}

async function getStudyCustomGptProjectIdForAdmin(studyId: string) {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    select: {
      id: true,
      config: true,
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const config = asObject(study.config);

  return (
    stringFromConfig(config, "customGptProjectId") ??
    env.CUSTOMGPT_PROJECT_ID ??
    null
  );
}

export async function getStudyCustomGptSources(studyId: string) {
  const projectId = await getStudyCustomGptProjectIdForAdmin(studyId);
  const result = await listCustomGptSources({ projectId });

  return studyCustomGptSourcesResponseSchema.parse({
    studyId,
    projectId: result.projectId,
    enabled: result.enabled,
    reason: result.reason,
    added: false,
    sources: result.sources,
  });
}

export async function addStudyCustomGptSitemapSource(
  studyId: string,
  input: AddStudyCustomGptSitemapSource,
) {
  const parsed = addStudyCustomGptSitemapSourceSchema.parse(input);
  const projectId = await getStudyCustomGptProjectIdForAdmin(studyId);
  const result = await addCustomGptSitemapSource({
    projectId,
    sitemapPath: parsed.sitemapPath,
  });

  return studyCustomGptSourcesResponseSchema.parse({
    studyId,
    projectId: result.projectId,
    enabled: result.enabled,
    reason: result.reason,
    added: true,
    sources: result.sources,
  });
}

function getAssetStoredFileContent(asset: {
  id: string;
  key: string;
  mimeType: string | null;
  metadata: Prisma.JsonValue | null;
}) {
  const metadata = asObject(asset.metadata);
  const fileBase64 = metadata.fileBase64;

  if (typeof fileBase64 !== "string" || fileBase64.length === 0) {
    throw new Error(
      `Asset ${asset.id} does not have stored file content. Add a website/sitemap source for URL-only assets.`,
    );
  }

  const fileName =
    typeof metadata.fileName === "string" && metadata.fileName.trim()
      ? metadata.fileName.trim()
      : asset.key;

  return {
    bytes: Buffer.from(fileBase64, "base64"),
    mimeType: asset.mimeType ?? "application/octet-stream",
    fileName,
  };
}

export async function addStudyCustomGptAssetSource(
  studyId: string,
  input: AddStudyCustomGptAssetSource,
) {
  const parsed = addStudyCustomGptAssetSourceSchema.parse(input);
  const [projectId, asset] = await Promise.all([
    getStudyCustomGptProjectIdForAdmin(studyId),
    prisma.studyAsset.findFirst({
      where: {
        id: parsed.assetId,
        studyId,
      },
      select: {
        id: true,
        key: true,
        title: true,
        mimeType: true,
        metadata: true,
      },
    }),
  ]);

  if (!asset) {
    throw new Error(
      `Asset ${parsed.assetId} was not found in study ${studyId}.`,
    );
  }

  const file = getAssetStoredFileContent(asset);
  const result = await addCustomGptFileSource({
    projectId,
    fileName: file.fileName,
    mimeType: file.mimeType,
    bytes: file.bytes,
  });

  return studyCustomGptSourcesResponseSchema.parse({
    studyId,
    projectId: result.projectId,
    enabled: result.enabled,
    reason: result.reason,
    added: true,
    sources: result.sources,
  });
}

export async function verifyStudyCustomGpt(studyId: string) {
  const study = await prisma.study.findUnique({
    where: { id: studyId },
    include: {
      questionNodes: {
        orderBy: {
          position: "asc",
        },
      },
    },
  });

  if (!study) {
    throw new Error(`Study ${studyId} was not found.`);
  }

  const config = asObject(study.config);
  const projectId =
    stringFromConfig(config, "customGptProjectId") ??
    env.CUSTOMGPT_PROJECT_ID ??
    null;
  const startedAt = Date.now();
  const sourceContextQuestion =
    study.questionNodes.find((node) => {
      const nodeConfig = asObject(node.config);

      return resolveGroundedStudyContextRequirement({
        prompt: node.prompt,
        requiresGroundedStudyContext: nodeConfig.requiresGroundedStudyContext,
      }).requiresGroundedStudyContext;
    }) ?? null;
  const verificationMode = sourceContextQuestion
    ? "source_context_question"
    : "general_project";
  const sourceContextFields = {
    verificationMode,
    sourceContextQuestionId: sourceContextQuestion?.id ?? null,
    sourceContextQuestionTitle: sourceContextQuestion?.title ?? null,
    sourceContextQuestionPrompt: sourceContextQuestion?.prompt ?? null,
  } as const;

  try {
    const result = sourceContextQuestion
      ? await askCustomGptForProactiveStudyContext({
          projectId,
          question: sourceContextQuestion.prompt,
          surveyContext: [
            `Study: ${study.name}`,
            study.description ? `Description: ${study.description}` : null,
            `Question title: ${sourceContextQuestion.title}`,
            `Question prompt: ${sourceContextQuestion.prompt}`,
            "Verification purpose: generate the proactive study/source context that would be shown before this survey question. Return enough detail for an HCP to react and include references from the approved source material.",
          ]
            .filter(Boolean)
            .join("\n"),
          assetTitle: null,
        })
      : await askCustomGptForSurveyClarification({
          projectId,
          question:
            "What source material should I use when answering questions during this survey?",
          surveyContext: [
            `Study: ${study.name}`,
            study.description ? `Description: ${study.description}` : null,
            "This is a structured medical market research interview. Answer from the approved CustomGPT project content and include references when available.",
          ]
            .filter(Boolean)
            .join("\n"),
        });

    if (!result.enabled) {
      return studyCustomGptVerificationResponseSchema.parse({
        studyId: study.id,
        studyName: study.name,
        projectId,
        ...sourceContextFields,
        status: "skipped",
        checked: false,
        responseReceived: false,
        referenceCount: 0,
        latencyMs: null,
        reason: result.reason,
        answerPreview: null,
      });
    }

    const sourceContextMissingReferences =
      verificationMode === "source_context_question" &&
      Boolean(result.answer) &&
      result.references.length === 0;

    return studyCustomGptVerificationResponseSchema.parse({
      studyId: study.id,
      studyName: study.name,
      projectId,
      ...sourceContextFields,
      status:
        result.answer && !sourceContextMissingReferences ? "passed" : "failed",
      checked: true,
      responseReceived: Boolean(result.answer),
      referenceCount: result.references.length,
      latencyMs: elapsedMs(startedAt),
      reason: result.answer
        ? sourceContextMissingReferences
          ? "CustomGPT returned proactive source context but no references. Add source material/citation support before fielding."
          : null
        : (result.reason ?? "CustomGPT did not return an answer."),
      answerPreview: previewAnswer(result.answer),
    });
  } catch (error) {
    return studyCustomGptVerificationResponseSchema.parse({
      studyId: study.id,
      studyName: study.name,
      projectId,
      ...sourceContextFields,
      status: "failed",
      checked: true,
      responseReceived: false,
      referenceCount: 0,
      latencyMs: elapsedMs(startedAt),
      reason:
        error instanceof Error
          ? error.message
          : "Study CustomGPT verification failed.",
      answerPreview: null,
    });
  }
}
