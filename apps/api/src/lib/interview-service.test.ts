import { ModuleStatus, QuestionNodeType } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildGuideHintProactiveStudyGrounding,
  buildProactiveStudySurveyContext,
  buildDeterministicAnalysis,
  containsMedicalSafetyConcern,
} from "./interview-service";
import { shouldProactivelyGroundClinicalStudyQuestion } from "./study-grounding";

describe("medical safety detection", () => {
  it("does not treat research language about urgency as a live safety event", () => {
    expect(
      containsMedicalSafetyConcern(
        "I need to know which items are urgent versus routine before talking with my clinician.",
      ),
    ).toBe(false);
  });

  it("flags present-tense emergency advice requests", () => {
    expect(
      containsMedicalSafetyConcern(
        "I have severe chest pain right now. What should I do?",
      ),
    ).toBe(true);
  });
});

describe("deterministic imported-guide analysis", () => {
  it("adds module and nearby guide context for proactive study grounding", () => {
    const context = buildProactiveStudySurveyContext({
      study: {
        name: "BRUKINSA",
        modules: [
          {
            id: "module_alpine",
            key: "alpine",
            studyId: "study_brukinsa",
            title: "CLL/SLL - ALPINE Relapsed/Refractory Efficacy",
            description: null,
            status: ModuleStatus.DRAFT,
            position: 12,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
        questionNodes: [
          {
            id: "node_alpine_orientation",
            studyId: "study_brukinsa",
            moduleId: "module_alpine",
            key: "alpine-orientation",
            title: "ALPINE orientation",
            nodeType: QuestionNodeType.OPEN_TEXT,
            prompt:
              "First, think about the ALPINE head-to-head efficacy story in relapsed/refractory CLL/SLL.",
            helpText: null,
            config: null,
            position: 1,
            isEntry: false,
            isTerminal: false,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
          {
            id: "node_alpine_reaction",
            studyId: "study_brukinsa",
            moduleId: "module_alpine",
            key: "alpine-reaction",
            title: "ALPINE reaction",
            nodeType: QuestionNodeType.OPEN_TEXT,
            prompt:
              "How does that head-to-head evidence affect your view of BRUKINSA?",
            helpText: null,
            config: null,
            position: 2,
            isEntry: false,
            isTerminal: false,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
          {
            id: "node_alpine_limit",
            studyId: "study_brukinsa",
            moduleId: "module_alpine",
            key: "alpine-limit",
            title: "ALPINE limits",
            nodeType: QuestionNodeType.OPEN_TEXT,
            prompt:
              "What limits the impact of the ALPINE head-to-head evidence?",
            helpText: null,
            config: null,
            position: 3,
            isEntry: false,
            isTerminal: false,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        ],
      },
      selectedNode: {
        id: "node_alpine_reaction",
        moduleId: "module_alpine",
        title: "ALPINE reaction",
        prompt:
          "How does that head-to-head evidence affect your view of BRUKINSA?",
      },
      assetTitle: "BRUKINSA HCP Website",
    });

    expect(context).toContain("Study: BRUKINSA");
    expect(context).toContain(
      "Current module: CLL/SLL - ALPINE Relapsed/Refractory Efficacy",
    );
    expect(context).toContain("Current side-pane asset: BRUKINSA HCP Website");
    expect(context).toContain("First, think about the ALPINE");
    expect(context).toContain("What limits the impact of the ALPINE");
    expect(context).toContain(
      "Use nearby guide context only to resolve shorthand",
    );
    expect(context).toContain(
      "Survey question: How does that head-to-head evidence affect your view of BRUKINSA?",
    );
  });

  it("turns imported source-context hints into traceable proactive grounding", () => {
    const grounding = buildGuideHintProactiveStudyGrounding({
      selectedNode: {
        id: "node_alpine_reaction",
        prompt: "What is your reaction to the ALPINE study data?",
        config: {
          sourceContextHint:
            "ALPINE compared BRUKINSA with ibrutinib in relapsed/refractory CLL/SLL and reported head-to-head efficacy and safety results for HCP review.",
          sourceLine: 44,
        },
      },
      assetTitle: "BRUKINSA HCP Website",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(grounding).toMatchObject({
      answer: expect.stringContaining("ALPINE compared BRUKINSA"),
      contextQuestion: "What is your reaction to the ALPINE study data?",
      assetTitle: "BRUKINSA HCP Website",
      generatedAt: "2026-01-01T00:00:00.000Z",
      references: [
        {
          citationId: "guide:node_alpine_reaction",
          title: "Imported survey guide",
          url: null,
          description: expect.stringContaining("guide line 44"),
        },
      ],
    });
  });

  it("does not create proactive guide grounding without an imported hint", () => {
    expect(
      buildGuideHintProactiveStudyGrounding({
        selectedNode: {
          id: "node_alpine_reaction",
          prompt: "What is your reaction to the ALPINE study data?",
          config: {},
        },
      }),
    ).toBe(null);
  });

  it("accepts concise usable answers for imported open-ended questions", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "what-stood-out_1",
        title: "What stood out?",
        prompt: "What stood out on the website?",
        config: {
          factKeys: ["stood_out"],
          importSource: "survey_import",
          sourceLine: 12,
          minUsefulWords: 1,
        },
      },
      answer: "Not sure",
      sessionFacts: {},
    });

    expect(analysis.answerQuality).toBe("adequate");
    expect(analysis.shouldAdvance).toBe(true);
    expect(analysis.extractedFacts).toMatchObject({
      stood_out: "Not sure",
    });
  });

  it("accepts legacy imported questions that only have source line metadata", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "b-cell-malignancies_7",
        title: "Which B-cell malignancies do you treat?",
        prompt: "Which B-cell malignancies do you personally treat?",
        config: {
          factKeys: ["b_cell_malignancies"],
          sourceLine: 89,
        },
      },
      answer: "CLL, MCL",
      sessionFacts: {},
    });

    expect(analysis.answerQuality).toBe("adequate");
    expect(analysis.shouldAdvance).toBe(true);
    expect(analysis.extractedFacts).toMatchObject({
      b_cell_malignancies: "CLL, MCL",
    });
  });

  it("treats explicit skip language as a usable survey response", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "asset_reaction",
        title: "Asset reaction",
        prompt:
          "After reviewing the material in the side pane, what feels clear, unclear, or concerning?",
        config: {
          factKeys: ["asset_reaction"],
        },
      },
      answer: "move on",
      sessionFacts: {},
    });

    expect(analysis.answerQuality).toBe("adequate");
    expect(analysis.shouldAdvance).toBe(true);
    expect(analysis.summary).toContain("skip");
  });

  it("routes general participant questions to clarification when study knowledge is configured", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "website_reaction",
        title: "Website reaction",
        prompt: "What stood out on the BRUKINSA HCP website?",
        config: {
          factKeys: ["website_reaction"],
          importSource: "survey_import",
          sourceLine: 22,
          minUsefulWords: 1,
        },
      },
      answer: "What is BRUKINSA?",
      sessionFacts: {},
      allowGeneralClarificationQuestions: true,
    });

    expect(analysis.turnIntent).toBe("clarification_question");
    expect(analysis.offTopic).toBe(true);
    expect(analysis.participantQuestion).toBe("What is BRUKINSA?");
    expect(analysis.followUpAction).toBe("redirect");
  });

  it("routes named clinical study summary requests to clarification", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "study_reaction",
        title: "Study Reaction",
        prompt: "What is your reaction to the ALPINE study data?",
        config: {
          factKeys: ["study_reaction"],
          importSource: "survey_import",
          sourceLine: 31,
          minUsefulWords: 1,
        },
      },
      answer: "summarize ALPINE",
      sessionFacts: {},
      allowGeneralClarificationQuestions: true,
    });

    expect(analysis.turnIntent).toBe("clarification_question");
    expect(analysis.participantQuestion).toBe("summarize ALPINE");
    expect(analysis.shouldAdvance).toBe(false);
    expect(analysis.followUpAction).toBe("redirect");
  });

  it("detects selected questions that need proactive clinical study context", () => {
    expect(
      shouldProactivelyGroundClinicalStudyQuestion(
        "What is your reaction to the ALPINE study data?",
      ),
    ).toBe(true);
    expect(
      shouldProactivelyGroundClinicalStudyQuestion(
        "Based on that safety and tolerability profile, how does it affect your risk-benefit view of BRUKINSA for CLL/SLL patients?",
      ),
    ).toBe(true);
    expect(
      shouldProactivelyGroundClinicalStudyQuestion(
        "After reviewing the study details below, what stands out as most compelling or limiting for CLL/SLL patients?",
      ),
    ).toBe(true);
    expect(
      shouldProactivelyGroundClinicalStudyQuestion(
        "What do these PFS results do to your confidence in the evidence?",
      ),
    ).toBe(true);
    expect(
      shouldProactivelyGroundClinicalStudyQuestion(
        "What kind of efficacy evidence matters most: PFS, ORR, depth of response, durability, head-to-head data, subgroup data, or something else?",
      ),
    ).toBe(false);
    expect(
      shouldProactivelyGroundClinicalStudyQuestion(
        "What stood out on the BRUKINSA HCP website?",
      ),
    ).toBe(false);
  });

  it("keeps ordinary study mentions as survey answers", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "study_reaction",
        title: "Study Reaction",
        prompt: "What is your reaction to the ALPINE study data?",
        config: {
          factKeys: ["study_reaction"],
          importSource: "survey_import",
          sourceLine: 31,
          minUsefulWords: 1,
        },
      },
      answer: "The ALPINE study has shaped my view.",
      sessionFacts: {},
      allowGeneralClarificationQuestions: true,
    });

    expect(analysis.turnIntent).toBe("survey_answer");
    expect(analysis.participantQuestion).toBe(null);
    expect(analysis.shouldAdvance).toBe(true);
  });

  it("keeps obvious unrelated questions off topic even when study knowledge is configured", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "website_reaction",
        title: "Website reaction",
        prompt: "What stood out on the BRUKINSA HCP website?",
        config: {
          factKeys: ["website_reaction"],
          importSource: "survey_import",
          sourceLine: 22,
          minUsefulWords: 1,
        },
      },
      answer: "What about baseball?",
      sessionFacts: {},
      allowGeneralClarificationQuestions: true,
    });

    expect(analysis.turnIntent).toBe("off_topic");
    expect(analysis.participantQuestion).toBe("What about baseball?");
  });

  it("keeps obvious throwaway text from advancing imported questions", () => {
    const analysis = buildDeterministicAnalysis({
      node: {
        key: "what-stood-out_1",
        title: "What stood out?",
        prompt: "What stood out on the website?",
        config: {
          factKeys: ["stood_out"],
          importSource: "survey_import",
          sourceLine: 12,
          minUsefulWords: 1,
        },
      },
      answer: "asdf",
      sessionFacts: {},
    });

    expect(analysis.answerQuality).toBe("nonsense");
    expect(analysis.shouldAdvance).toBe(false);
  });
});
