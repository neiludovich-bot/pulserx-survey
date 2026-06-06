import {
  phrasingInputSchema,
  participantTurnInputSchema,
  sessionStateJsonSchema,
  type ContradictionFlag,
  type FactValue,
  type ParticipantTurnInput,
  type ParsedParticipantTurnInput,
  type PhrasingInput,
  type QuestionCandidate,
  type SessionStateJson,
} from "@interview/schemas";
import { detectContradictions } from "./contradiction-detector";
import { selectByPolicy, type DeterministicSelection } from "./policy-rules";
import {
  getEffectiveNodeMaxAttempts,
  isImportedGuideNode,
  type CompiledBranchRule,
  type CompiledStudy,
} from "./study-compiler";
import { evaluateStopRules, type StopSelection } from "./stop-rules";

export type TurnAdvanceResult = {
  selection: DeterministicSelection | StopSelection;
  sessionState: SessionStateJson;
};

export type PreparedDecisionTurn = {
  sessionState: SessionStateJson;
  candidateNodeIds: string[];
  contradictions: ContradictionFlag[];
  deterministicSelection: DeterministicSelection | StopSelection | null;
};

type AdvanceTurnInput = {
  compiledStudy: CompiledStudy;
  sessionState: SessionStateJson;
  participantTurn?: ParticipantTurnInput;
};

function isStopSelection(
  selection: DeterministicSelection | StopSelection,
): selection is StopSelection {
  return selection.action === "close";
}

function uniqueIds(values: string[]) {
  return [...new Set(values)];
}

function nowIso() {
  return new Date().toISOString();
}

function getElapsedSeconds(startedAt: string | null) {
  if (!startedAt) {
    return 0;
  }

  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) {
    return 0;
  }

  return Math.max(0, Math.floor((Date.now() - started) / 1000));
}

function refreshTiming(
  compiledStudy: CompiledStudy,
  sessionState: SessionStateJson,
) {
  const startedAt = sessionState.startedAt ?? nowIso();
  const targetDurationSeconds =
    sessionState.targetDurationSeconds ||
    compiledStudy.config.targetDurationSeconds;
  const elapsedSeconds = getElapsedSeconds(startedAt);

  return sessionStateJsonSchema.parse({
    ...sessionState,
    startedAt,
    lastActivityAt: nowIso(),
    targetDurationSeconds,
    elapsedSeconds,
    remainingSeconds: Math.max(0, targetDurationSeconds - elapsedSeconds),
    maxAttemptsPerNode:
      sessionState.maxAttemptsPerNode ||
      compiledStudy.config.maxAttemptsPerQuestion,
    maxOffTopicRedirects:
      sessionState.maxOffTopicRedirects ||
      compiledStudy.config.maxOffTopicRedirects,
  });
}

function getPendingMustAskNodeIds(
  compiledStudy: CompiledStudy,
  completedNodeIds: string[],
) {
  return compiledStudy.mustAskNodeIds.filter(
    (nodeId) => !completedNodeIds.includes(nodeId),
  );
}

function asFactText(value: FactValue | undefined) {
  if (value === undefined) {
    return "";
  }

  if (Array.isArray(value)) {
    return value.join(" ");
  }

  return String(value);
}

function comparisonValues(value: unknown) {
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

type BranchRuleMatch = {
  matchedKeywordCount: number;
  matchedKeywordLength: number;
};

function branchRuleMatch(
  rule: CompiledBranchRule,
  sessionState: SessionStateJson,
): BranchRuleMatch | null {
  if (rule.conditionType === "ALWAYS") {
    return {
      matchedKeywordCount: 0,
      matchedKeywordLength: 0,
    };
  }

  if (!rule.factKey) {
    return null;
  }

  const factValue = asFactText(sessionState.facts[rule.factKey]);
  if (!factValue) {
    return null;
  }

  const normalizedFact = factValue.toLowerCase();
  const comparisons = comparisonValues(rule.comparisonValue);

  if (comparisons.length === 0) {
    return null;
  }

  if (rule.conditionType === "ANSWER_CONTAINS") {
    const matchedComparisons = comparisons.filter((comparison) =>
      normalizedFact.includes(comparison),
    );

    return matchedComparisons.length > 0
      ? {
          matchedKeywordCount: matchedComparisons.length,
          matchedKeywordLength: matchedComparisons.join("").length,
        }
      : null;
  }

  if (rule.conditionType === "ANSWER_EQUALS") {
    const matchedComparisons = comparisons.filter(
      (comparison) => normalizedFact === comparison,
    );

    return matchedComparisons.length > 0
      ? {
          matchedKeywordCount: matchedComparisons.length,
          matchedKeywordLength: matchedComparisons.join("").length,
        }
      : null;
  }

  return null;
}

function compareBranchRuleMatches(
  left: {
    rule: CompiledBranchRule;
    match: BranchRuleMatch;
    ruleIndex: number;
  },
  right: {
    rule: CompiledBranchRule;
    match: BranchRuleMatch;
    ruleIndex: number;
  },
) {
  if (left.match.matchedKeywordCount !== right.match.matchedKeywordCount) {
    return right.match.matchedKeywordCount - left.match.matchedKeywordCount;
  }

  if (left.match.matchedKeywordLength !== right.match.matchedKeywordLength) {
    return right.match.matchedKeywordLength - left.match.matchedKeywordLength;
  }

  if (left.rule.priority !== right.rule.priority) {
    return left.rule.priority - right.rule.priority;
  }

  return left.ruleIndex - right.ruleIndex;
}

function getRoutingFactKeys(compiledStudy: CompiledStudy, nodeId: string) {
  const branchRules = compiledStudy.outgoingRulesByNodeId.get(nodeId) ?? [];

  return uniqueIds(
    branchRules
      .filter((rule) => rule.conditionType !== "ALWAYS")
      .map((rule) => rule.factKey)
      .filter((factKey): factKey is string => Boolean(factKey)),
  );
}

function withRoutingFacts(
  compiledStudy: CompiledStudy,
  nodeId: string,
  participantTurn: ParsedParticipantTurnInput,
) {
  const routingFactKeys = getRoutingFactKeys(compiledStudy, nodeId);
  if (routingFactKeys.length === 0) {
    return participantTurn.extractedFacts;
  }

  const extractedFacts = { ...participantTurn.extractedFacts };
  for (const factKey of routingFactKeys) {
    if (extractedFacts[factKey] === undefined) {
      extractedFacts[factKey] = participantTurn.content;
    }
  }

  return extractedFacts;
}

function getCandidateNodeIds(
  compiledStudy: CompiledStudy,
  sessionState: SessionStateJson,
) {
  if (!sessionState.currentNodeId) {
    return [];
  }

  const branchRules =
    compiledStudy.outgoingRulesByNodeId
      .get(sessionState.currentNodeId)
      ?.filter(
        (rule) => !sessionState.completedNodeIds.includes(rule.toNodeId),
      ) ?? [];
  const conditionalBranchCandidates = branchRules
    .map((rule, ruleIndex) => ({
      rule,
      ruleIndex,
      match:
        rule.conditionType === "ALWAYS"
          ? null
          : branchRuleMatch(rule, sessionState),
    }))
    .filter(
      (
        evaluation,
      ): evaluation is {
        rule: CompiledBranchRule;
        ruleIndex: number;
        match: BranchRuleMatch;
      } => evaluation.match !== null,
    )
    .sort(compareBranchRuleMatches)
    .map((evaluation) => evaluation.rule.toNodeId);

  if (conditionalBranchCandidates.length > 0) {
    return uniqueIds(conditionalBranchCandidates);
  }

  const branchCandidates = branchRules
    .filter((rule) => rule.conditionType === "ALWAYS")
    .map((rule) => rule.toNodeId);

  if (branchCandidates.length > 0) {
    return uniqueIds(branchCandidates);
  }

  const globalMustAskFallback = sessionState.pendingMustAskNodeIds.filter(
    (nodeId) =>
      !sessionState.completedNodeIds.includes(nodeId) &&
      !sessionState.askedNodeIds.includes(nodeId),
  );

  return uniqueIds(globalMustAskFallback);
}

function toQuestionCandidate(
  compiledStudy: CompiledStudy,
  nodeId: string,
): QuestionCandidate {
  const node = compiledStudy.nodeById.get(nodeId);
  if (!node) {
    throw new Error(
      `Unable to build phrasing input for unknown node: ${nodeId}`,
    );
  }

  return {
    id: node.id,
    kind: node.isTerminal
      ? "close"
      : node.config.mustAsk
        ? "primary"
        : "follow_up",
    objective: node.title,
    promptSeed: node.prompt,
    tags: node.config.factKeys,
  };
}

function getLastParticipantSummary(sessionState: SessionStateJson) {
  const lastParticipantTurn = [...sessionState.history]
    .reverse()
    .find((turn) => turn.role === "participant");

  return lastParticipantTurn?.content;
}

function getMaxAttemptsForNode(
  compiledStudy: CompiledStudy,
  sessionState: SessionStateJson,
  nodeId: string,
) {
  const node = compiledStudy.nodeById.get(nodeId);
  return getEffectiveNodeMaxAttempts(node, sessionState.maxAttemptsPerNode);
}

function shouldForceAdvanceAfterAttempt(input: {
  compiledStudy: CompiledStudy;
  sessionState: SessionStateJson;
  nodeId: string;
  attemptCount: number;
  participantTurn: ParsedParticipantTurnInput;
  contradictions: ContradictionFlag[];
}) {
  const node = input.compiledStudy.nodeById.get(input.nodeId);
  const maxAttempts = getMaxAttemptsForNode(
    input.compiledStudy,
    input.sessionState,
    input.nodeId,
  );

  if (node?.config.allowForceAdvance === false) {
    return false;
  }

  if (input.contradictions.length > 0) {
    return false;
  }

  if (input.participantTurn.safetyFlag) {
    return false;
  }

  if (input.participantTurn.shouldAdvance) {
    return true;
  }

  if (input.participantTurn.offTopic) {
    if (input.participantTurn.turnIntent === "clarification_question") {
      return (
        input.sessionState.offTopicRedirectCount >=
        input.sessionState.maxOffTopicRedirects
      );
    }

    return (
      input.attemptCount >= maxAttempts ||
      input.sessionState.offTopicRedirectCount >=
        input.sessionState.maxOffTopicRedirects
    );
  }

  return input.attemptCount >= maxAttempts;
}

export function createSessionState(
  compiledStudy: CompiledStudy,
  sessionId: string,
): SessionStateJson {
  const startedAt = nowIso();

  return sessionStateJsonSchema.parse({
    sessionId,
    studyId: compiledStudy.study.id,
    status: "active",
    startedAt,
    lastActivityAt: startedAt,
    targetDurationSeconds: compiledStudy.config.targetDurationSeconds,
    elapsedSeconds: 0,
    remainingSeconds: compiledStudy.config.targetDurationSeconds,
    maxAttemptsPerNode: compiledStudy.config.maxAttemptsPerQuestion,
    maxOffTopicRedirects: compiledStudy.config.maxOffTopicRedirects,
    currentNodeId: null,
    currentNodeKey: null,
    askedNodeIds: [],
    completedNodeIds: [],
    attemptCountsByNodeId: {},
    pendingMustAskNodeIds: compiledStudy.mustAskNodeIds,
    facts: {},
    contradictionFlags: [],
    offTopicRedirectCount: 0,
    safetyEscalationCount: 0,
    history: [],
  });
}

export function buildPhrasingInputForSelection(
  compiledStudy: CompiledStudy,
  sessionState: SessionStateJson,
  selection: TurnAdvanceResult["selection"],
): PhrasingInput | null {
  if (!selection.selectedNodeId) {
    return null;
  }

  return phrasingInputSchema.parse({
    sessionId: sessionState.sessionId,
    selectedQuestion: toQuestionCandidate(
      compiledStudy,
      selection.selectedNodeId,
    ),
    participantContext: {
      tone: "warm",
      lastAnswerSummary: getLastParticipantSummary(sessionState),
    },
    deliveryContext: {
      interactionType: selection.action,
      missingTopics: [],
    },
  });
}

export function advanceTurn({
  compiledStudy,
  sessionState,
  participantTurn,
}: AdvanceTurnInput): TurnAdvanceResult {
  let nextState = sessionStateJsonSchema.parse(sessionState);
  const preparedTurn = prepareDecisionTurn({
    compiledStudy,
    sessionState: nextState,
    participantTurn,
  });

  if (
    preparedTurn.deterministicSelection &&
    isStopSelection(preparedTurn.deterministicSelection)
  ) {
    return {
      selection: preparedTurn.deterministicSelection,
      sessionState: preparedTurn.sessionState,
    };
  }

  const selection = preparedTurn.deterministicSelection;

  if (!selection) {
    throw new Error(
      "No deterministic selection was available for the next turn.",
    );
  }

  return commitSelection(preparedTurn.sessionState, selection);
}

export function prepareDecisionTurn({
  compiledStudy,
  sessionState,
  participantTurn,
}: AdvanceTurnInput): PreparedDecisionTurn {
  let nextState = refreshTiming(
    compiledStudy,
    sessionStateJsonSchema.parse(sessionState),
  );
  let contradictions: ContradictionFlag[] = [];
  const parsedParticipantTurn = participantTurn
    ? participantTurnInputSchema.parse(participantTurn)
    : undefined;

  if (parsedParticipantTurn) {
    const currentNodeId = nextState.currentNodeId;
    const attemptCount = currentNodeId
      ? (nextState.attemptCountsByNodeId[currentNodeId] ?? 0) + 1
      : 0;

    nextState = sessionStateJsonSchema.parse({
      ...nextState,
      attemptCountsByNodeId: currentNodeId
        ? {
            ...nextState.attemptCountsByNodeId,
            [currentNodeId]: attemptCount,
          }
        : nextState.attemptCountsByNodeId,
      history: [
        ...nextState.history,
        {
          role: "participant",
          nodeId: nextState.currentNodeId ?? undefined,
          content: parsedParticipantTurn.content,
          offTopic: parsedParticipantTurn.offTopic,
          turnIntent: parsedParticipantTurn.turnIntent,
        },
      ],
    });

    const currentNode = currentNodeId
      ? compiledStudy.nodeById.get(currentNodeId)
      : null;
    contradictions = isImportedGuideNode(currentNode)
      ? []
      : detectContradictions(
          nextState.facts,
          parsedParticipantTurn.extractedFacts,
        );

    nextState = sessionStateJsonSchema.parse({
      ...nextState,
      contradictionFlags: [...nextState.contradictionFlags, ...contradictions],
      safetyEscalationCount: parsedParticipantTurn.safetyFlag
        ? nextState.safetyEscalationCount + 1
        : nextState.safetyEscalationCount,
    });

    if (parsedParticipantTurn.offTopic) {
      nextState = sessionStateJsonSchema.parse({
        ...nextState,
        offTopicRedirectCount: nextState.offTopicRedirectCount + 1,
      });
    }

    if (currentNodeId) {
      const shouldCompleteCurrent = shouldForceAdvanceAfterAttempt({
        compiledStudy,
        sessionState: nextState,
        nodeId: currentNodeId,
        attemptCount,
        participantTurn: parsedParticipantTurn,
        contradictions,
      });

      if (shouldCompleteCurrent) {
        const extractedFacts = withRoutingFacts(
          compiledStudy,
          currentNodeId,
          parsedParticipantTurn,
        );

        nextState = sessionStateJsonSchema.parse({
          ...nextState,
          facts:
            parsedParticipantTurn.offTopic || parsedParticipantTurn.safetyFlag
              ? nextState.facts
              : {
                  ...nextState.facts,
                  ...extractedFacts,
                },
          completedNodeIds: uniqueIds([
            ...nextState.completedNodeIds,
            currentNodeId,
          ]),
        });
      }
    }
  }

  nextState = sessionStateJsonSchema.parse({
    ...nextState,
    pendingMustAskNodeIds: getPendingMustAskNodeIds(
      compiledStudy,
      nextState.completedNodeIds,
    ),
  });

  const candidateNodeIds = getCandidateNodeIds(compiledStudy, nextState);
  const stopSelection = evaluateStopRules({
    compiledStudy,
    sessionState: nextState,
    candidateNodeIds,
  });

  if (stopSelection) {
    return {
      deterministicSelection: stopSelection,
      candidateNodeIds: [],
      contradictions,
      sessionState: sessionStateJsonSchema.parse({
        ...nextState,
        status: "completed",
        currentNodeId: null,
        currentNodeKey: null,
      }),
    };
  }

  const deterministicSelection = selectByPolicy({
    compiledStudy,
    sessionState: nextState,
    candidateNodeIds,
    contradictions,
    participantTurn: parsedParticipantTurn,
  });

  return {
    deterministicSelection,
    candidateNodeIds,
    contradictions,
    sessionState: nextState,
  };
}

export function buildDecisionCandidates(
  compiledStudy: CompiledStudy,
  candidateNodeIds: string[],
) {
  return candidateNodeIds.map((nodeId, index) => {
    const node = compiledStudy.nodeById.get(nodeId);
    if (!node) {
      throw new Error(`Unknown decision candidate node: ${nodeId}`);
    }

    return {
      nodeId: node.id,
      nodeKey: node.key,
      title: node.title,
      prompt: node.prompt,
      priority: index,
      mustAsk: node.config.mustAsk,
    };
  });
}

export function commitSelection(
  sessionState: SessionStateJson,
  selection: DeterministicSelection,
): TurnAdvanceResult {
  return {
    selection,
    sessionState: sessionStateJsonSchema.parse({
      ...sessionState,
      currentNodeId: selection.selectedNodeId,
      currentNodeKey: selection.selectedNodeKey,
      askedNodeIds: uniqueIds([
        ...sessionState.askedNodeIds,
        selection.selectedNodeId,
      ]),
    }),
  };
}
