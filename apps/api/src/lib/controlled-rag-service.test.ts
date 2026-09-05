import { afterEach, describe, expect, it, vi } from "vitest";
import * as modelGateway from "./model-gateway";
import {
  askControlledRagForSurveyInterviewerTurn,
  controlledRagTestInternals,
} from "./controlled-rag-service";

describe("controlled RAG source provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  const parkedFactorsInput = {
    surveySlug: "nubeqa" as const,
    participantMessage: "Can you explain that more simply?",
    surveyContext: "Active disease lane: mCSPC. Use only approved source material.",
    currentQuestion: "What are your top factors when evaluating systemic intensification?",
    selectedNextQuestion: "What are your top factors when evaluating systemic intensification?",
    selectedQuestionSourceContext: "Answer the participant's source question without asking a research question.",
    recentInterviewerContext: "participant: What are the known drug-drug interactions with NUBEQA?\ninterviewer: NUBEQA has CYP3A4 and BCRP interaction considerations. [1]",
    responseMode: "answer_only" as const,
  };

  it.each([
    "Can you explain that more simply?",
    "Can explain more simply?",
    "Say more.",
    "What does that mean?",
  ])("keeps a referential clarification on DDI while the factors question is parked: %s", async (participantMessage) => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      ...parkedFactorsInput,
      participantMessage,
    });

    expect(result.enabled).toBe(true);
    expect(result.references[0]?.url).toBe("https://www.nubeqahcp.com/safety/ddi-profile");
    expect(result.answer).toContain("CYP3A4");
    expect(result.answer).not.toContain("For nmCRPC, ARAMIS frames");
    expect(result.answer).not.toContain("top factors");
  });

  it("lets an explicit new ARANOTE request replace the previous DDI source topic", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      ...parkedFactorsInput,
      participantMessage: "Can you explain ARANOTE rPFS more simply?",
    });

    expect(result.references[0]?.title).toContain("ARANOTE");
    expect(result.references[0]?.title).not.toContain("Safety, Dosing, and DDI");
    expect(result.answer).toContain("rPFS is the primary endpoint");
  });

  it("retains the DDI source topic across successive referential clarifications", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      ...parkedFactorsInput,
      participantMessage: "What does that mean?",
      recentInterviewerContext: "participant: Can you explain that more simply?\ninterviewer: Some medicines affect NUBEQA exposure through CYP3A4. NUBEQA also affects BCRP substrates. [1]",
    });

    expect(result.references[0]?.url).toBe("https://www.nubeqahcp.com/safety/ddi-profile");
    expect(result.answer).toContain("CYP3A4");
    expect(result.answer).not.toContain("For nmCRPC, ARAMIS frames");
  });

  it("composes the original clarification with DDI evidence and history, excluding parked questions", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const composeControlledRagAnswer = vi.fn().mockResolvedValue({
      result: { answerBody: "Some medicines can change NUBEQA exposure. [1]" },
    });
    vi.spyOn(modelGateway, "getOptionalOpenAIGateway").mockReturnValue({
      composeControlledRagAnswer,
    } as unknown as NonNullable<ReturnType<typeof modelGateway.getOptionalOpenAIGateway>>);

    const result = await askControlledRagForSurveyInterviewerTurn({
      ...parkedFactorsInput,
      surveyContext: [
        parkedFactorsInput.surveyContext,
        `Current question: ${parkedFactorsInput.currentQuestion}`,
        `Selected next question: ${parkedFactorsInput.selectedNextQuestion}`,
        `Parked survey question to resume after a source-answer pause: ${parkedFactorsInput.currentQuestion}`,
        "Upcoming unasked guide preview: What do you think of ARANOTE?",
      ].join("\n"),
    });

    expect(result.enabled).toBe(true);
    expect(composeControlledRagAnswer).toHaveBeenCalledWith(expect.objectContaining({
      resolvedSourceQuestion: "What are the known drug-drug interactions with NUBEQA?",
      participantMessage: parkedFactorsInput.participantMessage,
      currentQuestion: null,
      selectedNextQuestion: null,
      surveyContext: parkedFactorsInput.surveyContext,
      selectedQuestionSourceContext: parkedFactorsInput.selectedQuestionSourceContext,
      recentInterviewerContext: parkedFactorsInput.recentInterviewerContext,
      clinicalEvidenceCard: expect.objectContaining({ topic: "nubeqa_safety_dosing" }),
    }));
  });

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
    expect(result.answer).not.toContain("Should we stay with that");
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

  it("does not dump NUBEQA source chunks when the broad composer falls back", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "nubeqa",
      participantMessage: "What should I generally know about NUBEQA?",
      surveyContext: "The respondent is starting the NUBEQA survey.",
      currentQuestion: "Is it okay to begin?",
      selectedNextQuestion:
        "Before we get into NUBEQA-specific information, what are the top factors that matter most when you evaluate androgen receptor pathway therapy or systemic intensification for an appropriate prostate cancer patient?",
      selectedQuestionSourceContext:
        "Retrieve current NUBEQA HCP indication and high-level source context across nmCRPC, mCSPC with docetaxel, mCSPC without docetaxel, dosing, and safety.",
    });

    expect(result.enabled).toBe(true);
    expect(result.answer).toContain("ARAMIS");
    expect(result.answer).toContain("ARANOTE");
    expect(result.answer).toContain("ARASENS");
    expect(result.answer).not.toMatch(
      /Use the source page|If the cited material|exact current Kaplan-Meier|source page detail/i,
    );
    expect(result.answer).not.toMatch(
      /The NUBEQA mCSPC HCP efficacy page presents ARASENS.*The NUBEQA HCP dosing page describes.*The NUBEQA mCSPC HCP efficacy page presents ARANOTE/s,
    );
    expect(result.answer?.match(/\?/g) ?? []).toHaveLength(1);
  });

  it("strips composer-invented follow-up questions before appending the selected survey question", () => {
    const selectedQuestion =
      "Before we get into NUBEQA-specific information, what are the top factors that matter most when you evaluate androgen receptor pathway therapy or systemic intensification for an appropriate prostate cancer patient?";
    const cleaned =
      controlledRagTestInternals.stripComposerFollowUpQuestions(
        "For nmCRPC, ARAMIS frames NUBEQA plus ADT versus ADT/placebo. In mCSPC without docetaxel, ARANOTE frames NUBEQA plus ADT versus placebo plus ADT. How does that disease-state split fit with your own treatment framework?",
        selectedQuestion,
        "answer_then_ask",
      );

    expect(cleaned).toContain("ARAMIS");
    expect(cleaned).toContain("ARANOTE");
    expect(cleaned).not.toContain("How does that disease-state split");
    expect(cleaned).not.toContain(selectedQuestion);
    expect(cleaned).not.toContain("?");
  });

  it("preserves decimal source claims while stripping composer questions with abbreviations and quotes", () => {
    const evidence = [
      "At 24 months, 70.3% and 52.1% of patients, respectively, remained free of radiological progression and were alive.",
      "The U.S. source reports HR 0.54 (95% CI, 0.41-0.71; P<0.0001).",
      "Median follow-up was 25.3 months versus 25.0 months.",
    ];
    const answer = [
      `${evidence[0]} What stands out from these results?`,
      `${evidence[1]} How does the U.S. guidance apply? ${evidence[2]}`,
      "Would the 70.3% result change your view?",
      '\u201cWhich result matters most to you?\u201d',
    ].join("\n\n");

    expect(
      controlledRagTestInternals.stripComposerFollowUpQuestions(
        answer,
        null,
        "answer_then_ask",
      ),
    ).toBe(`${evidence[0]}\n\n${evidence[1]} ${evidence[2]}`);
  });

  it("keeps generic ad-hoc evidence-card facts compact enough for composer schema", () => {
    const card = controlledRagTestInternals.buildClinicalEvidenceCard(
      {
        surveySlug: "nubeqa",
        participantMessage: "What is the source saying here?",
        surveyContext: "",
        currentQuestion: null,
        selectedNextQuestion: null,
        selectedQuestionSourceContext: null,
      },
      [
        {
          id: "test-long",
          surveySlug: "nubeqa",
          title: "Long source",
          description: "",
          url: "https://example.com/source",
          tags: ["test"],
          text: "The NUBEQA mCSPC HCP efficacy page presents ARASENS as NUBEQA plus ADT plus docetaxel versus placebo plus ADT plus docetaxel. The page states that NUBEQA in combination with docetaxel significantly reduced the risk of death by nearly a third versus docetaxel and ADT alone, and separately describes time to mCRPC and other secondary endpoints. Use the source page for exact current Kaplan-Meier visuals, landmark analysis caveats, and endpoint hierarchy. If the cited material does not answer the exact question, state that limitation briefly and then give the closest supported information.",
        },
      ],
    );

    expect(card?.keyFacts.every((fact) => fact.length <= 420)).toBe(true);
    expect(card?.keyFacts.join(" ")).not.toMatch(
      /Use the source page|If the cited material/i,
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

  it("keeps the dedicated NUBEQA DDI card first for drug interaction asks", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      surveySlug: "nubeqa",
      participantMessage:
        "What are the known drug-drug interactions with NUBEQA?",
      surveyContext: "The respondent is discussing NUBEQA clinical fit.",
      currentQuestion:
        "What, if anything, does the ARANOTE mCSPC evidence change about NUBEQA plus ADT without docetaxel?",
      selectedNextQuestion:
        "Which prostate cancer patient types seem like better fits for NUBEQA, and where would you be cautious?",
      selectedQuestionSourceContext:
        "Retrieve NUBEQA patient fit and evidence context.",
    });

    expect(result.enabled).toBe(true);
    expect(result.references[0]?.url).toBe("https://www.nubeqahcp.com/safety/ddi-profile");
    expect(result.answer).toContain("CYP3A4");
    expect(result.answer).toContain("BCRP");
  });
});
