import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@interview/schemas";
import {
  buildFallbackInterviewerUtterance,
  buildInterviewerPhrasingInput,
} from "./interviewer-copy";

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    summary: "Captured a usable response.",
    extractedFacts: {},
    offTopic: false,
    turnIntent: "survey_answer",
    participantQuestion: null,
    groundedResponse: null,
    groundedReferences: [],
    safetyFlag: false,
    answerQuality: "adequate",
    shouldAdvance: true,
    followUpAction: "advance",
    missingTopics: [],
    confidence: 0.8,
    ...overrides,
  };
}

describe("interviewer fallback copy", () => {
  it("adds a brief human acknowledgement before the next question", () => {
    const phrasingInput = buildInterviewerPhrasingInput({
      sessionId: "session_human_follow_up",
      selectedQuestion: {
        id: "node_current_pricing",
        title: "Current Pricing Process",
        prompt:
          "How do you currently set or update pricing for this product or service?",
      },
      selectionAction: "ask",
      analysis: makeAnalysis(),
    });

    const utterance = buildFallbackInterviewerUtterance(phrasingInput);

    expect(utterance).toContain("How do you currently set or update pricing");
    expect(utterance).not.toBe(
      "How do you currently set or update pricing for this product or service?",
    );
  });

  it("uses a targeted probe when the answer is partial", () => {
    const phrasingInput = buildInterviewerPhrasingInput({
      sessionId: "session_targeted_probe",
      selectedQuestion: {
        id: "node_company_context",
        title: "Company Context",
        prompt:
          "To start, tell me a bit about your company and who is involved in pricing decisions today.",
      },
      selectionAction: "probe",
      analysis: makeAnalysis({
        answerQuality: "partial",
        shouldAdvance: false,
        followUpAction: "probe",
        missingTopics: ["pricing_stakeholders"],
      }),
    });

    const utterance = buildFallbackInterviewerUtterance(phrasingInput);

    expect(utterance).toContain("who is involved in pricing decisions");
    expect(utterance).toContain("To start, tell me a bit about your company");
  });

  it("smoothly introduces staged assets before the question", () => {
    const phrasingInput = buildInterviewerPhrasingInput({
      sessionId: "session_asset_intro",
      selectedQuestion: {
        id: "node_value_metric",
        title: "Value Metric",
        prompt:
          "What signals tell you a pricing model is working well for your business?",
      },
      selectionAction: "ask",
      analysis: makeAnalysis(),
      assetTitle: "Pricing Storyboard",
    });

    const utterance = buildFallbackInterviewerUtterance(phrasingInput);

    expect(utterance).toContain('review "Pricing Storyboard"');
    expect(utterance).toContain(
      "What signals tell you a pricing model is working",
    );
  });

  it("uses grounded clarification answers without duplicating inline references", () => {
    const groundedAnswer =
      "BRUKINSA is described in the approved site material as zanubrutinib.\n\nReferences: [1] BRUKINSA HCP Site: https://example.test/brukinsa";
    const phrasingInput = buildInterviewerPhrasingInput({
      sessionId: "session_grounded_clarification",
      selectedQuestion: {
        id: "node_begin",
        title: "Begin",
        prompt: "Is it okay to begin?",
      },
      selectionAction: "redirect",
      analysis: makeAnalysis({
        offTopic: true,
        turnIntent: "clarification_question",
        participantQuestion: "What is BRUKINSA?",
        groundedResponse: groundedAnswer,
        groundedReferences: [
          {
            citationId: "1",
            title: "BRUKINSA HCP Site",
            url: "https://example.test/brukinsa",
            description: null,
          },
        ],
        answerQuality: "off_topic",
        shouldAdvance: false,
        followUpAction: "redirect",
        missingTopics: ["okay_begin"],
      }),
    });

    const utterance = buildFallbackInterviewerUtterance(phrasingInput);

    expect(utterance).toContain(
      "BRUKINSA is described in the approved site material as zanubrutinib.",
    );
    expect(utterance).not.toContain("References: [1]");
    expect(utterance).toContain("Coming back to the survey: Is it okay to begin?");
  });
});
