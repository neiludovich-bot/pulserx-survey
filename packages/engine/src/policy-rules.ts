import type {
  ContradictionFlag,
  ParsedParticipantTurnInput,
  SessionStateJson,
} from "@interview/schemas";
import {
  getEffectiveNodeMaxAttempts,
  type CompiledStudy,
} from "./study-compiler";

export type DeterministicSelection = {
  action: "ask" | "probe" | "redirect";
  rule:
    | "entry"
    | "contradiction"
    | "off_topic_redirect"
    | "insufficient_answer"
    | "attempt_limit_advance"
    | "time_limit_wrap_up"
    | "must_ask"
    | "branch_priority";
  rationale: string;
  selectedNodeId: string;
  selectedNodeKey: string;
  source: "deterministic";
  contradictions: ContradictionFlag[];
};

type PolicyInput = {
  compiledStudy: CompiledStudy;
  sessionState: SessionStateJson;
  candidateNodeIds: string[];
  contradictions: ContradictionFlag[];
  participantTurn?: ParsedParticipantTurnInput;
};

function getNodeOrder(compiledStudy: CompiledStudy, nodeId: string) {
  return (
    compiledStudy.orderIndexByNodeId.get(nodeId) ?? Number.MAX_SAFE_INTEGER
  );
}

function buildSelection(
  compiledStudy: CompiledStudy,
  nodeId: string,
  action: DeterministicSelection["action"],
  rule: DeterministicSelection["rule"],
  rationale: string,
  contradictions: ContradictionFlag[],
): DeterministicSelection {
  const node = compiledStudy.nodeById.get(nodeId);
  if (!node) {
    throw new Error(`Unknown node selected by policy rules: ${nodeId}`);
  }

  return {
    action,
    rule,
    rationale,
    selectedNodeId: node.id,
    selectedNodeKey: node.key,
    source: "deterministic",
    contradictions,
  };
}

function getCurrentAttemptCount(sessionState: SessionStateJson) {
  return sessionState.currentNodeId
    ? (sessionState.attemptCountsByNodeId[sessionState.currentNodeId] ?? 0)
    : 0;
}

function getCurrentMaxAttempts(
  compiledStudy: CompiledStudy,
  sessionState: SessionStateJson,
) {
  if (!sessionState.currentNodeId) {
    return sessionState.maxAttemptsPerNode;
  }

  return (
    getEffectiveNodeMaxAttempts(
      compiledStudy.nodeById.get(sessionState.currentNodeId),
      sessionState.maxAttemptsPerNode,
    )
  );
}

function findWrapUpNodeId(
  compiledStudy: CompiledStudy,
  sessionState: SessionStateJson,
  candidateNodeIds: string[],
) {
  const findIn = (nodeIds: string[]) =>
    nodeIds.find((nodeId) => {
      const node = compiledStudy.nodeById.get(nodeId);
      return Boolean(
        node &&
        !sessionState.completedNodeIds.includes(node.id) &&
        (node.isTerminal || node.nodeType === "CLOSE"),
      );
    }) ?? null;

  return (
    findIn(candidateNodeIds) ??
    findIn(compiledStudy.nodesInOrder.map((node) => node.id))
  );
}

function shouldRedirectCurrentQuestion(input: {
  compiledStudy: CompiledStudy;
  sessionState: SessionStateJson;
  participantTurn: ParsedParticipantTurnInput;
}) {
  const attemptCount = getCurrentAttemptCount(input.sessionState);
  const maxAttempts = getCurrentMaxAttempts(
    input.compiledStudy,
    input.sessionState,
  );

  if (
    input.participantTurn.offTopic &&
    input.sessionState.offTopicRedirectCount >=
      input.sessionState.maxOffTopicRedirects
  ) {
    return false;
  }

  if (input.participantTurn.turnIntent === "clarification_question") {
    return true;
  }

  if (attemptCount >= maxAttempts) {
    return false;
  }

  return true;
}

export function selectByPolicy({
  compiledStudy,
  sessionState,
  candidateNodeIds,
  contradictions,
  participantTurn,
}: PolicyInput): DeterministicSelection | null {
  if (
    sessionState.remainingSeconds <=
      compiledStudy.config.closingReserveSeconds &&
    sessionState.status === "active"
  ) {
    const wrapUpNodeId = findWrapUpNodeId(
      compiledStudy,
      sessionState,
      candidateNodeIds,
    );

    if (wrapUpNodeId) {
      return buildSelection(
        compiledStudy,
        wrapUpNodeId,
        "ask",
        "time_limit_wrap_up",
        "The session is close to its target duration, so the engine is moving to the wrap-up question.",
        contradictions,
      );
    }
  }

  if (contradictions.length > 0 && sessionState.currentNodeId) {
    return buildSelection(
      compiledStudy,
      sessionState.currentNodeId,
      "probe",
      "contradiction",
      "A contradiction was detected in the participant facts, so the engine should probe before advancing.",
      contradictions,
    );
  }

  if (
    participantTurn?.offTopic &&
    sessionState.currentNodeId &&
    shouldRedirectCurrentQuestion({
      compiledStudy,
      sessionState,
      participantTurn,
    })
  ) {
    return buildSelection(
      compiledStudy,
      sessionState.currentNodeId,
      "redirect",
      "off_topic_redirect",
      "The participant went off topic, so the engine should redirect back to the current research question.",
      contradictions,
    );
  }

  if (
    participantTurn &&
    !participantTurn.shouldAdvance &&
    sessionState.currentNodeId &&
    shouldRedirectCurrentQuestion({
      compiledStudy,
      sessionState,
      participantTurn,
    })
  ) {
    return buildSelection(
      compiledStudy,
      sessionState.currentNodeId,
      "probe",
      "insufficient_answer",
      "The participant answer was incomplete or nonsensical, so the engine should probe or re-ask before advancing.",
      contradictions,
    );
  }

  if (
    participantTurn &&
    !participantTurn.shouldAdvance &&
    sessionState.currentNodeId
  ) {
    const currentNode = compiledStudy.nodeById.get(sessionState.currentNodeId);
    if (
      currentNode &&
      !sessionState.completedNodeIds.includes(currentNode.id)
    ) {
      return buildSelection(
        compiledStudy,
        currentNode.id,
        "ask",
        "attempt_limit_advance",
        "The participant did not provide enough detail after the allowed follow-up attempts, so the engine is moving forward without repeating the same prompt.",
        contradictions,
      );
    }
  }

  if (!sessionState.currentNodeId && sessionState.askedNodeIds.length === 0) {
    return buildSelection(
      compiledStudy,
      compiledStudy.entryNodeId,
      "ask",
      "entry",
      "Start the interview at the study entry node.",
      contradictions,
    );
  }

  const mustAskCandidateId = candidateNodeIds
    .filter((nodeId) => compiledStudy.mustAskNodeIds.includes(nodeId))
    .sort(
      (left, right) =>
        getNodeOrder(compiledStudy, left) - getNodeOrder(compiledStudy, right),
    )[0];

  if (mustAskCandidateId) {
    return buildSelection(
      compiledStudy,
      mustAskCandidateId,
      "ask",
      "must_ask",
      "A must-ask node is available and takes precedence over optional follow-up branches.",
      contradictions,
    );
  }

  if (candidateNodeIds.length > 0) {
    const selectedNodeId = candidateNodeIds[0];

    return buildSelection(
      compiledStudy,
      selectedNodeId,
      "ask",
      "branch_priority",
      "The engine followed the next deterministic branch in study order.",
      contradictions,
    );
  }

  return null;
}
