import { describe, expect, it } from "vitest";
import {
  askControlledRagForSurveyInterviewerTurn,
  controlledRagTestInternals,
} from "./controlled-rag-service";

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

  it("maps PADCEV neuropathy turns to patient-facing neuropathy visuals before PDF cards", () => {
    const topic = controlledRagTestInternals.displayTopicForTurn({
      surveySlug: "padcev",
      participantMessage: "How should I think about neuropathy risk with PADCEV?",
      surveyContext: "The respondent is in the side-effect management lane.",
      currentQuestion: "Which safety or tolerability details matter?",
      selectedNextQuestion:
        "When a PADCEV adverse event emerges, what guidance would help?",
      selectedQuestionSourceContext:
        "Retrieve PADCEV safety-management resources and dose-modification guidance.",
    });
    const ranked = controlledRagTestInternals.rankAssetsForDisplay(
      [
        {
          title: "Dose Modifications",
          url: "https://example.com/dose-modifications.pdf",
          description: "PDF dose modification resource",
          assetKind: "PDF",
          tags: ["dose modification"],
          priority: 100,
        },
        {
          title: "la/mUC Peripheral Neuropathy Informational Resource",
          url: "https://example.com/peripheral-neuropathy-resource.png",
          description:
            "Patient prompts and dose modifications for peripheral neuropathy",
          assetKind: "IMAGE",
          tags: ["neuropathy", "patient education", "dose modification"],
          priority: 10,
        },
      ],
      ["neuropathy", "padcev"],
      topic,
    );

    expect(topic).toBe("padcev_neuropathy_management");
    expect(ranked[0]?.title).toContain("Peripheral Neuropathy");
  });

  it("maps EV-302 response questions to response visuals instead of safety assets", () => {
    const topic = controlledRagTestInternals.displayTopicForTurn({
      surveySlug: "padcev",
      participantMessage:
        "What did EV-302 show for response rate and complete response?",
      surveyContext: "The respondent is in the side-effect management lane.",
      currentQuestion:
        "When a PADCEV adverse event emerges, what guidance would help?",
      selectedNextQuestion:
        "Which safety or tolerability details most influence comfort?",
      selectedQuestionSourceContext:
        "Retrieve PADCEV safety-management resources and monitoring checklists.",
    });
    const ranked = controlledRagTestInternals.rankAssetsForDisplay(
      [
        {
          title: "PADCEV Adverse Reactions Monitoring Checklist",
          url: "https://example.com/adverse-reaction-checklist.png",
          description: "Safety monitoring checklist",
          assetKind: "IMAGE",
          tags: ["safety", "adverse", "monitoring"],
          priority: 250,
        },
        {
          title: "EV-302 ORR and Complete Response Results",
          url: "https://example.com/ev-302-response-results.png",
          description:
            "EV-302 overall response rate and complete response graphic",
          assetKind: "CHART",
          tags: ["ev-302", "orr", "complete response"],
          priority: 20,
        },
      ],
      ["ev", "302", "response", "complete"],
      topic,
    );

    expect(topic).toBe("padcev_ev302_response");
    expect(ranked[0]?.title).toContain("EV-302");
  });

  it("fills PDF-only citations with the turn's most relevant visual assets", () => {
    const references = controlledRagTestInternals.referencesForChunks(
      [
        {
          id: "chunk-visual",
          surveySlug: "padcev",
          title: "PADCEV Peripheral Neuropathy Informational Resource",
          description: "Neuropathy management visual",
          url: "https://example.com/neuropathy",
          tags: ["neuropathy", "management"],
          text: "Neuropathy management text.",
          assets: [
            {
              title: "Peripheral Neuropathy Visual Guide",
              url: "https://example.com/neuropathy-guide.png",
              description: "Patient prompts and grade-based dose modifications",
              assetKind: "IMAGE",
              tags: ["neuropathy", "dose modification"],
              priority: 100,
            },
          ],
        },
        {
          id: "chunk-pdf",
          surveySlug: "padcev",
          title: "PADCEV Adverse Reactions Monitoring Checklist",
          description: "Checklist PDF",
          url: "https://example.com/checklist",
          tags: ["checklist", "monitoring"],
          text: "Checklist text.",
          assets: [
            {
              title: "PADCEV Adverse Reactions Monitoring Checklist",
              url: "https://example.com/checklist.pdf",
              description: "PDF checklist resource",
              assetKind: "PDF",
              tags: ["checklist", "monitoring"],
              priority: 100,
            },
          ],
        },
      ],
      [
        {
          title: "Peripheral Neuropathy Visual Guide",
          url: "https://example.com/neuropathy-guide.png",
          description: "Patient prompts and grade-based dose modifications",
          assetKind: "IMAGE",
          tags: ["neuropathy", "dose modification"],
          priority: 100,
        },
      ],
      ["neuropathy", "management", "checklist"],
    );

    expect(references[1]?.assets?.[0]?.title).toContain(
      "Peripheral Neuropathy Visual",
    );
    expect(references[1]?.assets?.some((asset) => asset.assetKind === "PDF")).toBe(
      true,
    );
  });

  it("removes participant-voice familiarity mirroring from composed answers", () => {
    const cleaned =
      controlledRagTestInternals.removeParticipantVoiceMirror(
        "I'm not very familiar with PADCEV beyond the basics in the provided sources. From the source material, PADCEV is described in two roles [1].",
      );

    expect(cleaned).toBe(
      "For orientation, from the source material, PADCEV is described in two roles [1].",
    );
  });
});
