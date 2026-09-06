import { interviewGuardrails } from "@interview/prompts";
import {
  phrasingInputSchema,
  selectionDecisionSchema,
  selectorInputSchema,
  type PhrasingInput,
  type ParticipantTurnInput,
  type QuestionCandidate,
  type SelectionDecision,
  type SelectorInput,
  type SessionStateJson,
} from "@interview/schemas";
import {
  advanceTurn,
  buildPhrasingInputForSelection,
  createSessionState,
  type TurnAdvanceResult,
} from "./turn-orchestrator";
import {
  compileStudy,
  type CompiledStudy,
  type StudyDefinition,
} from "./study-compiler";

export * from "./contradiction-detector";
export * from "./demo-study";
export * from "./medical-survey-study";
export * from "./openai-workflows";
export * from "./model-call-timing-context";
export * from "./moderator-planning";
export * from "./source-failure";
export * from "./evidence-ranges";
export * from "./policy-rules";
export * from "./stop-rules";
export * from "./study-compiler";
export * from "./turn-orchestrator";

export class InterviewEngine {
  readonly productName = "Interview Agent";

  selectNextQuestion(input: SelectorInput): SelectionDecision {
    const parsed = selectorInputSchema.parse(input);
    const selectedQuestion = [...parsed.candidateQuestions].sort(
      (left, right) =>
        this.getCoverageScore(left, parsed.coverage) -
        this.getCoverageScore(right, parsed.coverage),
    )[0];

    const missingCoverageGoalIds = parsed.goals
      .filter((goal) => (parsed.coverage[goal.id] ?? 0) < 0.6)
      .map((goal) => goal.id);

    return selectionDecisionSchema.parse({
      action: "ask",
      selectedQuestionId: selectedQuestion.id,
      rationale:
        "Selected the question that best addresses the lowest-covered research objective.",
      confidence: 0.72,
      missingCoverageGoalIds,
    });
  }

  buildPhrasingInput(
    sessionId: string,
    selectedQuestion: QuestionCandidate,
    lastAnswerSummary?: string,
  ): PhrasingInput {
    return phrasingInputSchema.parse({
      sessionId,
      selectedQuestion,
      participantContext: {
        tone: "warm",
        lastAnswerSummary,
      },
    });
  }

  compileStudy(definition: StudyDefinition): CompiledStudy {
    return compileStudy(definition);
  }

  createSessionState(compiledStudy: CompiledStudy, sessionId: string) {
    return createSessionState(compiledStudy, sessionId);
  }

  advanceTurn(input: {
    compiledStudy: CompiledStudy;
    sessionState: SessionStateJson;
    participantTurn?: ParticipantTurnInput;
  }): TurnAdvanceResult {
    return advanceTurn(input);
  }

  buildPhrasingInputForSelection(
    compiledStudy: CompiledStudy,
    sessionState: SessionStateJson,
    selection: TurnAdvanceResult["selection"],
  ) {
    return buildPhrasingInputForSelection(
      compiledStudy,
      sessionState,
      selection,
    );
  }

  getArchitectureSummary() {
    return {
      boundaries: [
        "Selector chooses the next question or interview action.",
        "Phraser turns the chosen question into participant-facing language.",
        "Deterministic policy rules run before any model judgment.",
        "Postgres remains the canonical source of state.",
      ],
      scope: [
        "Browser chat UI",
        "Adaptive sequencing",
        "Typed model contracts",
        "Prisma + Postgres state",
      ],
      guardrails: interviewGuardrails,
    };
  }

  private getCoverageScore(
    candidate: QuestionCandidate,
    coverage: SelectorInput["coverage"],
  ) {
    if (candidate.tags.length === 0) {
      return 1;
    }

    return Math.min(...candidate.tags.map((tag) => coverage[tag] ?? 0));
  }
}
