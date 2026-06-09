import {
  type MvpSurveyIntentDefinition,
  mvpSurveyDefinitionContractSchema,
} from "@interview/schemas";
import type { MvpGuideQuestion } from "./mvp-brukinsa-guide";

export type MvpSurveySlug = "brukinsa" | "padcev";

export type MvpSurveyDefinition = {
  slug: MvpSurveySlug;
  defaultStudyName: string;
  sourceBrand: string;
  guide: MvpGuideQuestion[];
  intents?: MvpSurveyIntent[];
  projectIdEnvName: string;
  defaultProjectId: () => string | null;
};

export type MvpSurveyIntent = MvpSurveyIntentDefinition;

function assertKnownQuestionIds(input: {
  surveySlug: string;
  intentSlug: string;
  fieldName: string;
  knownIds: Set<string>;
  questionIds: string[] | undefined;
}) {
  for (const questionId of input.questionIds ?? []) {
    if (!input.knownIds.has(questionId)) {
      throw new Error(
        `Survey ${input.surveySlug} intent ${input.intentSlug} references unknown ${input.fieldName} question id: ${questionId}`,
      );
    }
  }
}

export function validateMvpSurveyDefinition(definition: MvpSurveyDefinition) {
  const parsed = mvpSurveyDefinitionContractSchema.parse({
    slug: definition.slug,
    defaultStudyName: definition.defaultStudyName,
    sourceBrand: definition.sourceBrand,
    guide: definition.guide,
    intents: definition.intents ?? [],
  });
  const questionIds = new Set(parsed.guide.map((question) => question.id));

  for (const intent of parsed.intents) {
    assertKnownQuestionIds({
      surveySlug: parsed.slug,
      intentSlug: intent.slug,
      fieldName: "questionOrder",
      knownIds: questionIds,
      questionIds: intent.questionOrder,
    });
    assertKnownQuestionIds({
      surveySlug: parsed.slug,
      intentSlug: intent.slug,
      fieldName: "allowedQuestionIds",
      knownIds: questionIds,
      questionIds: intent.allowedQuestionIds,
    });
    assertKnownQuestionIds({
      surveySlug: parsed.slug,
      intentSlug: intent.slug,
      fieldName: "blockedQuestionIds",
      knownIds: questionIds,
      questionIds: intent.blockedQuestionIds,
    });

    const allowedIds = new Set(intent.allowedQuestionIds ?? []);
    const overlappingIds = (intent.blockedQuestionIds ?? []).filter((questionId) =>
      allowedIds.has(questionId),
    );
    if (overlappingIds.length) {
      throw new Error(
        `Survey ${parsed.slug} intent ${intent.slug} lists question id(s) as both allowed and blocked: ${overlappingIds.join(", ")}`,
      );
    }
  }
}

export function surveyIntentForSlug(
  definition: MvpSurveyDefinition,
  slug?: string,
) {
  if (!definition.intents?.length) {
    return null;
  }

  return (
    definition.intents.find((intent) => intent.slug === slug) ??
    definition.intents[0] ??
    null
  );
}

export function guideForIntent(
  definition: MvpSurveyDefinition,
  intent: MvpSurveyIntent | null,
) {
  if (!intent) {
    return definition.guide;
  }

  const guideById = new Map(
    definition.guide.map((question) => [question.id, question]),
  );

  return intent.questionOrder
    .map((questionId) => guideById.get(questionId))
    .filter((question): question is MvpGuideQuestion => Boolean(question));
}

export function questionAllowedByIntent(
  intent: MvpSurveyIntent | null,
  question: MvpGuideQuestion,
) {
  if (!intent) {
    return true;
  }

  if (intent.blockedQuestionIds?.includes(question.id)) {
    return false;
  }

  if (intent.allowedQuestionIds?.length) {
    return intent.allowedQuestionIds.includes(question.id);
  }

  return true;
}

export function surveyIntentContextLines(intent: MvpSurveyIntent | null) {
  if (!intent) {
    return ["Selected survey intention: default guide."];
  }

  return [
    `Selected survey intention: ${intent.label}. ${intent.primaryIntent}`,
    `Intention steering rule: ${intent.steeringRule}`,
    intent.allowedQuestionIds?.length
      ? `Intent-allowed question ids: ${intent.allowedQuestionIds.join(" | ")}`
      : null,
    intent.blockedQuestionIds?.length
      ? `Intent-blocked question ids unless respondent explicitly asks off-lane: ${intent.blockedQuestionIds.join(" | ")}`
      : null,
    intent.offLaneSourceRule
      ? `Intent off-lane source rule: ${intent.offLaneSourceRule}`
      : null,
    intent.requiredCoverage.length
      ? `Required intent coverage: ${intent.requiredCoverage.join(" | ")}`
      : null,
  ].filter((line): line is string => Boolean(line));
}
