import type { RespondentSessionResponse } from "@interview/schemas";

type TranscriptTurn = RespondentSessionResponse["transcript"][number];
type TranscriptTurnGrounding = NonNullable<TranscriptTurn["grounding"]>;

const SOURCE_CONTEXT_HEADER = "Source-grounded context from approved material:";
const SURVEY_QUESTION_SEPARATOR = "\n\nSurvey question:\n";

export function stripInlineReferences(answer: string) {
  const referencesIndex = answer.search(/\n\nReferences:\s*\[\d+\]/);

  if (referencesIndex < 0) {
    return answer.trim();
  }

  return answer.slice(0, referencesIndex).trim();
}

function splitProactiveGroundingContent(content: string) {
  if (!content.startsWith(SOURCE_CONTEXT_HEADER)) {
    return null;
  }

  const questionIndex = content.lastIndexOf(SURVEY_QUESTION_SEPARATOR);
  if (questionIndex < 0) {
    return null;
  }

  const sourceAnswer = content
    .slice(SOURCE_CONTEXT_HEADER.length, questionIndex)
    .trim();
  const surveyQuestion = content
    .slice(questionIndex + SURVEY_QUESTION_SEPARATOR.length)
    .trim();

  if (!sourceAnswer || !surveyQuestion) {
    return null;
  }

  return {
    sourceAnswer,
    surveyQuestion,
  };
}

export function getTurnQuestionDisplayText(turn: TranscriptTurn) {
  if (turn.grounding?.kind !== "clinical_study_context") {
    return turn.content;
  }

  const split = splitProactiveGroundingContent(turn.content);
  if (split) {
    return split.surveyQuestion;
  }

  return turn.grounding.contextQuestion ?? turn.content;
}

export function getGroundingAnswerDisplayText(
  grounding: TranscriptTurnGrounding,
) {
  return stripInlineReferences(grounding.answer);
}
