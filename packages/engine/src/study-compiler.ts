import type { GroundedReference } from "@interview/schemas";

export type StudyNodeConfig = {
  factKeys?: string[];
  mustAsk?: boolean;
  responseFormat?: "long_text" | "short_text";
  estimatedSeconds?: number;
  maxAttempts?: number;
  allowForceAdvance?: boolean;
  importSource?: string;
  sourceLine?: number | null;
  minUsefulWords?: number;
  requiresGroundedStudyContext?: boolean;
  sourceContextHint?: string;
  sourceContextReferences?: GroundedReference[];
};

export type StudyRuntimeConfig = {
  targetDurationSeconds?: number;
  closingReserveSeconds?: number;
  maxAttemptsPerQuestion?: number;
  maxOffTopicRedirects?: number;
  medicalSafetyMessage?: string;
  customGptProjectId?: string;
  realtimeVoiceEnabled?: boolean;
};

export type StudyDefinition = {
  study: {
    id: string;
    slug: string;
    name: string;
    description?: string;
    config?: StudyRuntimeConfig;
  };
  modules: Array<{
    id: string;
    key: string;
    title: string;
    position: number;
  }>;
  questionNodes: Array<{
    id: string;
    key: string;
    moduleId?: string;
    title: string;
    prompt: string;
    nodeType:
      | "OPEN_TEXT"
      | "SINGLE_SELECT"
      | "MULTI_SELECT"
      | "NUMERIC"
      | "REFLECT"
      | "CLOSE";
    isEntry?: boolean;
    isTerminal?: boolean;
    position: number;
    config?: StudyNodeConfig;
  }>;
  branchRules: Array<{
    id: string;
    fromNodeId: string;
    toNodeId: string;
    conditionType:
      | "ALWAYS"
      | "ANSWER_EQUALS"
      | "ANSWER_CONTAINS"
      | "SCORE_GTE"
      | "SCORE_LTE";
    factKey?: string | null;
    comparisonValue?: unknown;
    priority: number;
    rationale?: string;
  }>;
};

type RequiredStudyNodeConfig = Required<
  Pick<
    StudyNodeConfig,
    | "factKeys"
    | "mustAsk"
    | "responseFormat"
    | "estimatedSeconds"
    | "maxAttempts"
    | "allowForceAdvance"
  >
>;

export type CompiledQuestionNode = Omit<
  StudyDefinition["questionNodes"][number],
  "config"
> & {
  config: RequiredStudyNodeConfig &
    Pick<
      StudyNodeConfig,
      | "importSource"
      | "sourceLine"
      | "minUsefulWords"
      | "requiresGroundedStudyContext"
      | "sourceContextHint"
      | "sourceContextReferences"
    >;
};

export type CompiledBranchRule = StudyDefinition["branchRules"][number];

export type CompiledStudy = {
  study: StudyDefinition["study"];
  config: Required<
    Pick<
      StudyRuntimeConfig,
      | "targetDurationSeconds"
      | "closingReserveSeconds"
      | "maxAttemptsPerQuestion"
      | "maxOffTopicRedirects"
      | "medicalSafetyMessage"
    >
  > &
    Omit<
      StudyRuntimeConfig,
      | "targetDurationSeconds"
      | "closingReserveSeconds"
      | "maxAttemptsPerQuestion"
      | "maxOffTopicRedirects"
      | "medicalSafetyMessage"
    >;
  modules: StudyDefinition["modules"];
  nodesInOrder: CompiledQuestionNode[];
  nodeById: ReadonlyMap<string, CompiledQuestionNode>;
  nodeByKey: ReadonlyMap<string, CompiledQuestionNode>;
  outgoingRulesByNodeId: ReadonlyMap<string, CompiledBranchRule[]>;
  orderIndexByNodeId: ReadonlyMap<string, number>;
  entryNodeId: string;
  mustAskNodeIds: string[];
};

export function isImportedGuideNode(
  node: Pick<CompiledQuestionNode, "config"> | null | undefined,
) {
  return Boolean(
    node &&
    (node.config.importSource === "survey_import" ||
      typeof node.config.sourceLine === "number"),
  );
}

export function getEffectiveNodeMaxAttempts(
  node: Pick<CompiledQuestionNode, "config"> | null | undefined,
  fallbackMaxAttempts: number,
) {
  const configuredMaxAttempts = node?.config.maxAttempts ?? fallbackMaxAttempts;

  if (isImportedGuideNode(node)) {
    return Math.min(configuredMaxAttempts, 1);
  }

  return configuredMaxAttempts;
}

function normalizeNode(
  node: StudyDefinition["questionNodes"][number],
): CompiledQuestionNode {
  return {
    ...node,
    config: {
      factKeys: node.config?.factKeys ?? [],
      mustAsk: node.config?.mustAsk ?? false,
      responseFormat: node.config?.responseFormat ?? "long_text",
      estimatedSeconds: node.config?.estimatedSeconds ?? 75,
      maxAttempts: node.config?.maxAttempts ?? 2,
      allowForceAdvance: node.config?.allowForceAdvance ?? true,
      importSource: node.config?.importSource,
      sourceLine: node.config?.sourceLine,
      minUsefulWords: node.config?.minUsefulWords,
      requiresGroundedStudyContext: node.config?.requiresGroundedStudyContext,
      sourceContextHint: node.config?.sourceContextHint,
      sourceContextReferences: node.config?.sourceContextReferences,
    },
    isEntry: node.isEntry ?? false,
    isTerminal: node.isTerminal ?? false,
  };
}

function getNodeOrder(
  modules: StudyDefinition["modules"],
  node: CompiledQuestionNode,
) {
  const modulePosition =
    modules.find((module) => module.id === node.moduleId)?.position ?? 999;

  return modulePosition * 1000 + node.position;
}

export function compileStudy(definition: StudyDefinition): CompiledStudy {
  const config = {
    targetDurationSeconds:
      definition.study.config?.targetDurationSeconds ?? 900,
    closingReserveSeconds: definition.study.config?.closingReserveSeconds ?? 90,
    maxAttemptsPerQuestion:
      definition.study.config?.maxAttemptsPerQuestion ?? 2,
    maxOffTopicRedirects: definition.study.config?.maxOffTopicRedirects ?? 2,
    medicalSafetyMessage:
      definition.study.config?.medicalSafetyMessage ??
      "I cannot provide medical advice or assess urgent symptoms in this survey. If this may be an emergency, contact emergency services or a clinician right away.",
    customGptProjectId: definition.study.config?.customGptProjectId,
    realtimeVoiceEnabled: definition.study.config?.realtimeVoiceEnabled,
  };
  const normalizedNodes = definition.questionNodes.map(normalizeNode);
  const nodeById = new Map(normalizedNodes.map((node) => [node.id, node]));
  const nodeByKey = new Map(normalizedNodes.map((node) => [node.key, node]));

  const entryNodes = normalizedNodes.filter((node) => node.isEntry);
  if (entryNodes.length !== 1) {
    throw new Error("Study definition must contain exactly one entry node.");
  }

  for (const rule of definition.branchRules) {
    if (!nodeById.has(rule.fromNodeId) || !nodeById.has(rule.toNodeId)) {
      throw new Error(`Branch rule ${rule.id} references an unknown node.`);
    }
  }

  const nodesInOrder = [...normalizedNodes].sort(
    (left, right) =>
      getNodeOrder(definition.modules, left) -
      getNodeOrder(definition.modules, right),
  );

  const orderIndexByNodeId = new Map(
    nodesInOrder.map((node, index) => [node.id, index]),
  );

  const outgoingRulesByNodeId = new Map<string, CompiledBranchRule[]>();
  for (const rule of definition.branchRules) {
    const rules = outgoingRulesByNodeId.get(rule.fromNodeId) ?? [];
    rules.push(rule);
    outgoingRulesByNodeId.set(rule.fromNodeId, rules);
  }

  for (const [nodeId, rules] of outgoingRulesByNodeId.entries()) {
    rules.sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return (
        (orderIndexByNodeId.get(left.toNodeId) ?? 9999) -
        (orderIndexByNodeId.get(right.toNodeId) ?? 9999)
      );
    });
    outgoingRulesByNodeId.set(nodeId, rules);
  }

  const mustAskNodeIds = nodesInOrder
    .filter((node) => node.config.mustAsk)
    .map((node) => node.id);

  return {
    study: definition.study,
    config,
    modules: definition.modules,
    nodesInOrder,
    nodeById,
    nodeByKey,
    outgoingRulesByNodeId,
    orderIndexByNodeId,
    entryNodeId: entryNodes[0].id,
    mustAskNodeIds,
  };
}
