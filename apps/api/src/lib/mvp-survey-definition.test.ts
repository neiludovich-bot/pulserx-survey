import { describe, expect, it } from "vitest";
import {
  type MvpSurveyDefinition,
  guideForIntent,
  questionAllowedByIntent,
  surveyIntentContextLines,
  surveyIntentForSlug,
  validateMvpSurveyDefinition,
} from "./mvp-survey-definition";

const testGuide = [
  {
    id: "intro_consent",
    module: "Intro",
    objective: "Confirm consent.",
    canonicalQuestion: "Is it okay to begin?",
    sourceContextRequirement: null,
    routeKeywords: [],
    completionSignals: ["agrees"],
    adaptiveProbes: [],
    analyzableOutputs: ["consent"],
  },
  {
    id: "safety",
    module: "Safety",
    objective: "Explore safety.",
    canonicalQuestion: "Which safety details matter?",
    sourceContextRequirement: "Use safety sources.",
    routeKeywords: ["safety"],
    completionSignals: ["safety concern"],
    adaptiveProbes: [],
    analyzableOutputs: ["safety_driver"],
  },
  {
    id: "efficacy",
    module: "Evidence",
    objective: "Explore efficacy.",
    canonicalQuestion: "Which efficacy data matter?",
    sourceContextRequirement: "Use efficacy sources.",
    routeKeywords: ["efficacy"],
    completionSignals: ["efficacy concern"],
    adaptiveProbes: [],
    analyzableOutputs: ["efficacy_driver"],
  },
];

function definition(overrides: Partial<MvpSurveyDefinition> = {}) {
  return {
    slug: "padcev",
    defaultStudyName: "PADCEV HCP MVP",
    sourceBrand: "PADCEV",
    guide: testGuide,
    intents: [
      {
        slug: "side-effect-management",
        label: "Side Effect Management",
        primaryIntent: "Stay in safety management.",
        requiredCoverage: ["safety confidence"],
        steeringRule: "Do not route into efficacy unless requested.",
        questionOrder: ["intro_consent", "safety"],
        allowedQuestionIds: ["intro_consent", "safety"],
        blockedQuestionIds: ["efficacy"],
        offLaneSourceRule: "Efficacy is off-lane.",
      },
    ],
    projectIdEnvName: "CUSTOMGPT_PADCEV_PROJECT_ID",
    defaultProjectId: () => "97350",
    ...overrides,
  } satisfies MvpSurveyDefinition;
}

describe("MVP survey definition", () => {
  it("validates and applies intent-specific question lanes", () => {
    const surveyDefinition = definition();

    expect(() => validateMvpSurveyDefinition(surveyDefinition)).not.toThrow();

    const intent = surveyIntentForSlug(
      surveyDefinition,
      "side-effect-management",
    );
    expect(intent?.label).toBe("Side Effect Management");
    expect(guideForIntent(surveyDefinition, intent).map((question) => question.id))
      .toEqual(["intro_consent", "safety"]);
    expect(questionAllowedByIntent(intent, testGuide[1])).toBe(true);
    expect(questionAllowedByIntent(intent, testGuide[2])).toBe(false);
    expect(surveyIntentContextLines(intent).join("\n")).toContain(
      "Intent-blocked question ids",
    );
  });

  it("rejects intents that reference unknown question ids", () => {
    const surveyDefinition = definition({
      intents: [
        {
          slug: "broken",
          label: "Broken",
          primaryIntent: "References a missing question.",
          requiredCoverage: [],
          steeringRule: "Broken.",
          questionOrder: ["intro_consent", "missing_question"],
        },
      ],
    });

    expect(() => validateMvpSurveyDefinition(surveyDefinition)).toThrow(
      /missing_question/,
    );
  });

  it("keeps the full guide available when no intent slug is selected", () => {
    const surveyDefinition = definition();

    expect(surveyIntentForSlug(surveyDefinition)).toBeNull();
    expect(guideForIntent(surveyDefinition, null).map((question) => question.id))
      .toEqual(["intro_consent", "safety", "efficacy"]);
  });
});
