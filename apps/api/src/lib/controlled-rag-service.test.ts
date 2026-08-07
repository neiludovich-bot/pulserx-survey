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

  it("can answer a source probe without appending the parked survey question", async () => {
    const parkedQuestion =
      "How does the SEQUOIA evidence affect your view of BRUKINSA in first-line CLL/SLL?";
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "brukinsa",
      participantMessage: "What does the SEQUOIA PFS evidence show?",
      surveyContext: "The respondent is discussing CLL/SLL evidence.",
      currentQuestion: "How familiar are you with BRUKINSA today?",
      selectedNextQuestion: parkedQuestion,
      selectedQuestionSourceContext:
        "Retrieve and summarize BRUKINSA CLL/SLL SEQUOIA efficacy information.",
      responseMode: "answer_only",
    });

    expect(result.enabled).toBe(true);
    expect(result.answer).toContain("SEQUOIA");
    expect(result.answer).toContain("[1]");
    expect(result.answer).not.toContain(parkedQuestion);
    expect(result.answer).toContain("Should we stay with that");
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

  it("keeps PADCEV efficacy charts out of safety-management visual selection", () => {
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
          title: "EV-302 overall survival chart",
          url: "https://example.com/ev-302-overall-survival.png",
          description: "Overall survival Kaplan-Meier curve",
          assetKind: "CHART",
          tags: ["ev-302", "overall survival", "efficacy"],
          priority: 500,
        },
        {
          title: "Peripheral Neuropathy Dose Modification Summary",
          url: "https://example.com/peripheral-neuropathy-dose-modification.png",
          description:
            "Grade-based dose modification and patient prompts for peripheral neuropathy",
          assetKind: "IMAGE",
          tags: ["neuropathy", "dose modification", "monitoring"],
          priority: 10,
        },
      ],
      ["neuropathy", "padcev"],
      topic,
    );

    expect(topic).toBe("padcev_neuropathy_management");
    expect(ranked[0]?.title).toContain("Peripheral Neuropathy");
    expect(
      ranked.some((asset) => asset.title.includes("overall survival")),
    ).toBe(false);
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
      "PADCEV is described in two roles [1].",
    );
  });

  it("removes internal retrieval narration from clinician-facing answers", () => {
    const cleaned = controlledRagTestInternals.cleanClinicalAnswer(
      "I can orient on the source areas available here: ARAMIS in nmCRPC, ARANOTE in mCSPC without docetaxel, and ARASENS in mCSPC with ADT plus docetaxel. The provided snippets do not give a full adverse-event table [1].",
    );

    expect(cleaned).toContain(
      "The HCP materials frame the evidence around ARAMIS",
    );
    expect(cleaned).toContain(
      "the cited HCP material does not give a full adverse-event table [1]",
    );
    expect(cleaned).not.toMatch(/I can orient|source areas|provided snippets/i);
  });

  it("removes broad NUBEQA source-map language before it reaches clinicians", () => {
    const cleaned = controlledRagTestInternals.cleanClinicalAnswer(
      "I can orient to the main source areas for NUBEQA: in mCSPC, ARANOTE covers NUBEQA plus ADT versus placebo plus ADT with rPFS as the primary endpoint, and ARASENS covers NUBEQA plus ADT plus docetaxel.",
    );

    expect(cleaned).toContain("For NUBEQA, in mCSPC");
    expect(cleaned).not.toMatch(/I can orient|source areas/i);
  });

  it("uses a NUBEQA evidence card for broad positioning instead of a source inventory", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "nubeqa",
      participantMessage: "yes",
      surveyContext: "The respondent just agreed to begin.",
      currentQuestion: "Is it okay to begin?",
      selectedNextQuestion:
        "Clinically, how does NUBEQA's role across nmCRPC and mCSPC fit into your treatment framework?",
      selectedQuestionSourceContext:
        "Before asking the positioning question, summarize only the current NUBEQA HCP indication and high-level role: adult patients with nmCRPC and adult patients with mCSPC, including use with ADT and the mCSPC with/without docetaxel framing when source-supported. Keep it neutral, concise, and source-cited.",
    });

    expect(result.enabled).toBe(true);
    expect(result.answer).toContain("ARAMIS");
    expect(result.answer).toContain("ARANOTE");
    expect(result.answer).toContain("ARASENS");
    expect(result.answer).toContain("Clinically, how does NUBEQA");
    expect(result.answer).not.toMatch(
      /I can orient|source areas|provided snippets|knowledge base/i,
    );
    expect(result.references[0]?.title).not.toContain(
      "Safety, Dosing, and DDI",
    );
  });

  it("prioritizes NUBEQA ARANOTE rPFS visuals for mCSPC rPFS questions", () => {
    const topic = controlledRagTestInternals.displayTopicForTurn({
      surveySlug: "nubeqa",
      participantMessage: "What does ARANOTE show for rPFS without docetaxel?",
      surveyContext: "The respondent is discussing NUBEQA mCSPC evidence.",
      currentQuestion: "What does ARANOTE change about your view?",
      selectedNextQuestion:
        "What, if anything, does the ARANOTE mCSPC evidence change about NUBEQA plus ADT without docetaxel?",
      selectedQuestionSourceContext:
        "Retrieve NUBEQA ARANOTE mCSPC source context and visuals.",
    });
    const ranked = controlledRagTestInternals.rankAssetsForDisplay(
      [
        {
          title: "NUBEQA safety chart",
          url: "https://example.com/safety.svg",
          description: "Adverse reactions chart",
          assetKind: "CHART",
          tags: ["safety", "adverse"],
          priority: 250,
        },
        {
          title: "ARANOTE rPFS chart",
          url: "https://example.com/aranote-rpfs.svg",
          description:
            "Radiographic progression-free survival chart for NUBEQA plus ADT",
          assetKind: "CHART",
          tags: ["aranote", "rpfs", "mcspc"],
          priority: 20,
        },
      ],
      ["aranote", "rpfs", "without", "docetaxel"],
      topic,
    );

    expect(topic).toBe("nubeqa_mcspc_aranote");
    expect(ranked[0]?.title).toBe("ARANOTE rPFS chart");
  });

  it("moves NUBEQA source order off the safety card for ARANOTE evidence asks", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "nubeqa",
      participantMessage: "What does ARANOTE show for rPFS without docetaxel?",
      surveyContext:
        "The respondent has been discussing NUBEQA safety, dosing, and DDI.",
      currentQuestion:
        "What safety, drug-interaction, or dosing issue would most affect your comfort with NUBEQA in practice?",
      selectedNextQuestion:
        "What safety, drug-interaction, or dosing issue would most affect your comfort with NUBEQA in practice?",
      selectedQuestionSourceContext:
        "Retrieve NUBEQA safety, dosing, and DDI source context.",
    });

    expect(result.enabled).toBe(true);
    expect(result.references[0]?.title).toContain("ARANOTE");
    expect(result.references[0]?.title).not.toContain(
      "Safety, Dosing, and DDI",
    );
  });

  it("keeps the NUBEQA safety card first for actual safety, dosing, or DDI asks", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "nubeqa",
      participantMessage:
        "What safety, drug-interaction, or dosing issue should I worry about?",
      surveyContext: "The respondent is discussing NUBEQA clinical fit.",
      currentQuestion:
        "What, if anything, does the ARANOTE mCSPC evidence change about NUBEQA plus ADT without docetaxel?",
      selectedNextQuestion:
        "Which prostate cancer patient types seem like better fits for NUBEQA, and where would you be cautious?",
      selectedQuestionSourceContext:
        "Retrieve NUBEQA patient fit and evidence context.",
    });

    expect(result.enabled).toBe(true);
    expect(result.references[0]?.title).toContain("Safety, Dosing, and DDI");
  });
});
