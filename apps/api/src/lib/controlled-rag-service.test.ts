import { describe, expect, it } from "vitest";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";

describe("controlled RAG source provider", () => {
  it("retrieves cited BRUKINSA SEQUOIA context and returns to the selected question", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "brukinsa",
      participantMessage: "What does the SEQUOIA PFS evidence show?",
      surveyContext: "The respondent is discussing CLL/SLL evidence.",
      currentQuestion: "How familiar are you with BRUKINSA today?",
      selectedNextQuestion:
        "How does the SEQUOIA evidence affect your view of BRUKINSA in first-line CLL/SLL?",
      selectedQuestionSourceContext:
        "Retrieve and summarize BRUKINSA CLL/SLL SEQUOIA efficacy information.",
    });

    expect(result.enabled).toBe(true);
    expect(result.answer).toContain("SEQUOIA");
    expect(result.answer).toContain("[1]");
    expect(result.answer).toContain("How does the SEQUOIA evidence affect");
    expect(result.references.length).toBeGreaterThan(0);
    expect(result.references[0]?.url).toContain("brukinsahcp.com");
  });

  it("fails safely when no curated source chunk matches", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "padcev",
      participantMessage: "Tell me about an unrelated topic.",
      surveyContext: "",
      currentQuestion: null,
      selectedNextQuestion: null,
      selectedQuestionSourceContext: null,
    });

    expect(result.enabled).toBe(false);
    expect(result.answer).toBeNull();
    expect(result.references).toEqual([]);
  });

  it("prioritizes an explicit EV-302 response-endpoint ask over the active safety lane", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "padcev",
      participantMessage:
        "What did EV-302 show for response rate and complete response?",
      surveyContext: "The respondent has been discussing PADCEV safety.",
      currentQuestion:
        "Which safety or tolerability details most influence how comfortable you would be using or supporting PADCEV?",
      selectedNextQuestion:
        "When a PADCEV adverse event emerges, what guidance would most help you decide whether to monitor, interrupt dosing, reduce dosing, discontinue, counsel the patient, or involve additional support?",
      selectedQuestionSourceContext:
        "Retrieve PADCEV safety-management resources, monitoring checklists, and dose-modification guidance.",
    });

    expect(result.enabled).toBe(true);
    expect(result.references[0]?.title).toContain("EV-302");
  });
});
