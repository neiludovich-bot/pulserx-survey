import type { RespondentSessionResponse } from "@interview/schemas";
import { describe, expect, it } from "vitest";
import {
  getGroundingAnswerDisplayText,
  getTurnQuestionDisplayText,
  stripInlineReferences,
} from "./grounding";

type TranscriptTurn = RespondentSessionResponse["transcript"][number];

const groundedTurn: TranscriptTurn = {
  id: "turn_1",
  role: "interviewer",
  content: [
    "Source-grounded context from approved material:",
    "",
    "SEQUOIA context summary for the respondent.",
    "",
    "Survey question:",
    "How does the SEQUOIA evidence affect your view of BRUKINSA?",
  ].join("\n"),
  createdAt: "2026-06-01T12:00:00.000Z",
  nodeKey: "sequoia_reaction",
  grounding: {
    kind: "clinical_study_context",
    answer:
      "SEQUOIA context summary for the respondent.\n\nReferences: [1] SEQUOIA Source: https://example.test/sequoia",
    references: [
      {
        citationId: "1",
        title: "SEQUOIA Source",
        url: "https://example.test/sequoia",
        description: null,
      },
    ],
    contextQuestion:
      "How does the SEQUOIA evidence affect your view of BRUKINSA?",
    assetTitle: "BRUKINSA HCP Website",
    generatedAt: "2026-06-01T12:00:01.000Z",
  },
};

describe("respondent grounding display helpers", () => {
  it("shows only the survey question in the chat bubble", () => {
    expect(getTurnQuestionDisplayText(groundedTurn)).toBe(
      "How does the SEQUOIA evidence affect your view of BRUKINSA?",
    );
  });

  it("strips inline reference text when references are rendered separately", () => {
    expect(getGroundingAnswerDisplayText(groundedTurn.grounding!)).toBe(
      "SEQUOIA context summary for the respondent.",
    );
  });

  it("supports audit pages that render grounded answer references separately", () => {
    expect(
      stripInlineReferences(
        "BRUKINSA is described as zanubrutinib.\n\nReferences: [1] BRUKINSA HCP Site: https://example.test/brukinsa",
      ),
    ).toBe("BRUKINSA is described as zanubrutinib.");
  });

  it("falls back to the typed context question when the content is not splittable", () => {
    expect(
      getTurnQuestionDisplayText({
        ...groundedTurn,
        content: "Legacy interviewer content with source context.",
      }),
    ).toBe("How does the SEQUOIA evidence affect your view of BRUKINSA?");
  });
});
