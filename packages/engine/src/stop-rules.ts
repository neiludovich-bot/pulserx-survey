import type { SessionStateJson } from "@interview/schemas";
import type { CompiledStudy } from "./study-compiler";

export type StopSelection = {
  action: "close";
  rule:
    | "terminal_node"
    | "no_remaining_candidates"
    | "time_limit_reached"
    | "safety_escalation";
  rationale: string;
  selectedNodeId: null;
  selectedNodeKey: null;
  source: "deterministic";
  contradictions: [];
};

type StopInput = {
  compiledStudy: CompiledStudy;
  sessionState: SessionStateJson;
  candidateNodeIds: string[];
};

export function evaluateStopRules({
  compiledStudy,
  sessionState,
  candidateNodeIds,
}: StopInput): StopSelection | null {
  if (sessionState.safetyEscalationCount >= 2) {
    return {
      action: "close",
      rule: "safety_escalation",
      rationale:
        "The participant raised repeated medical safety concerns, so the survey should close rather than continue probing.",
      selectedNodeId: null,
      selectedNodeKey: null,
      source: "deterministic",
      contradictions: [],
    };
  }

  if (sessionState.remainingSeconds <= 0) {
    return {
      action: "close",
      rule: "time_limit_reached",
      rationale:
        "The session reached its target duration, so the interview should close.",
      selectedNodeId: null,
      selectedNodeKey: null,
      source: "deterministic",
      contradictions: [],
    };
  }

  const currentNode = sessionState.currentNodeId
    ? compiledStudy.nodeById.get(sessionState.currentNodeId)
    : undefined;
  const currentNodeCompleted =
    currentNode !== undefined &&
    sessionState.completedNodeIds.includes(currentNode.id);

  if (currentNode?.isTerminal && currentNodeCompleted) {
    return {
      action: "close",
      rule: "terminal_node",
      rationale:
        "The current node is terminal and has already been completed, so the interview should close.",
      selectedNodeId: null,
      selectedNodeKey: null,
      source: "deterministic",
      contradictions: [],
    };
  }

  if (
    currentNodeCompleted &&
    candidateNodeIds.length === 0 &&
    sessionState.pendingMustAskNodeIds.length === 0
  ) {
    return {
      action: "close",
      rule: "no_remaining_candidates",
      rationale:
        "There are no remaining candidate nodes or pending must-ask questions, so the interview should close.",
      selectedNodeId: null,
      selectedNodeKey: null,
      source: "deterministic",
      contradictions: [],
    };
  }

  return null;
}
