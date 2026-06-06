import { describe, expect, it } from "vitest";
import { previewSurveyImport } from "./survey-import-service";

describe("survey import service", () => {
  it("turns raw guide text into a runnable adaptive survey preview", () => {
    const preview = previewSurveyImport({
      studyName: "BRUKINSA HCP Website Survey",
      targetDurationMinutes: 12,
      customGptProjectId: "12345",
      assetTitle: "BRUKINSA HCP Website",
      assetFileName: "brukinsa-hcp-site.pdf",
      assetFileBase64: Buffer.from("fake pdf").toString("base64"),
      assetMimeType: "application/pdf",
      sourceText: [
        "First Impressions",
        "Q1. What is your first impression of the BRUKINSA HCP website?",
        "Q2. What information would you look for first?",
        "Content Clarity",
        "Q3. What feels clear or unclear about the dosing information?",
        "If they treat CLL: What information on the site is most useful?",
        "Probe: What made that stand out?",
      ].join("\n"),
    });

    expect(preview.studyName).toBe("BRUKINSA HCP Website Survey");
    expect(preview.slug).toBe("brukinsa-hcp-website-survey");
    expect(preview.targetDurationSeconds).toBe(720);
    expect(preview.customGptProjectId).toBe("12345");
    expect(preview.warnings).toEqual(
      expect.arrayContaining(["Added a default wrap-up question."]),
    );
    expect(preview.asset).toMatchObject({
      title: "BRUKINSA HCP Website",
      assetType: "PDF",
      fileName: "brukinsa-hcp-site.pdf",
      mimeType: "application/pdf",
      displayMode: "INLINE_PANE",
    });
    expect(preview.modules.map((module) => module.key)).toContain(
      "first-impressions",
    );
    expect(preview.questions).toHaveLength(6);
    expect(preview.questions[0]).toMatchObject({
      moduleKey: "first-impressions",
      mustAsk: true,
    });
    expect(
      new Set(preview.questions.flatMap((question) => question.factKeys)).size,
    ).toBe(preview.questions.length);
    expect(preview.questions[0].factKeys[0]).toMatch(/_1$/);
    expect(preview.questions[3]).toMatchObject({
      prompt: "What information on the site is most useful?",
      mustAsk: false,
      condition: {
        source: "they treat CLL",
        sourceQuestionKey: preview.questions[2].key,
        matchKeywords: ["cll"],
      },
    });
    expect(preview.questions[4]).toMatchObject({
      prompt: "What made that stand out?",
      mustAsk: false,
      condition: null,
    });
    expect(
      preview.questions.some(
        (question) => question.requiresGroundedStudyContext,
      ),
    ).toBe(false);
    expect(preview.questions.at(-1)).toMatchObject({
      key: "wrap_up",
      mustAsk: false,
    });
  });

  it("warns when an imported guide is longer than the target duration", () => {
    const sourceText = Array.from({ length: 12 }, (_, index) => {
      return `Q${index + 1}. What reaction do you have to website message ${index + 1}?`;
    }).join("\n");

    const preview = previewSurveyImport({
      studyName: "Long Website Guide",
      targetDurationMinutes: 5,
      sourceText,
    });

    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("longer than the 5 minutes target"),
        expect.stringContaining("No per-study CustomGPT project ID"),
        expect.stringContaining("no side-pane asset was attached"),
      ]),
    );
  });

  it("marks named study prompts for proactive CustomGPT context", () => {
    const preview = previewSurveyImport({
      studyName: "BRUKINSA Evidence Survey",
      sourceText: [
        "Q1. How does the SEQUOIA evidence affect your view of BRUKINSA in first-line CLL/SLL?",
        "Q2. What is your overall reaction to the website?",
        "Q3. Based on that safety and tolerability profile, how does it affect your risk-benefit view of BRUKINSA for CLL/SLL patients?",
        "Q4. After reviewing the study details below, what stands out as most compelling or limiting for CLL/SLL patients?",
        "Q5. What do these PFS results do to your confidence in the evidence?",
      ].join("\n"),
    });

    expect(preview.questions[0]).toMatchObject({
      requiresGroundedStudyContext: true,
    });
    expect(preview.questions[1]).toMatchObject({
      requiresGroundedStudyContext: false,
    });
    expect(preview.questions[2]).toMatchObject({
      requiresGroundedStudyContext: true,
    });
    expect(preview.questions[3]).toMatchObject({
      requiresGroundedStudyContext: true,
    });
    expect(preview.questions[4]).toMatchObject({
      requiresGroundedStudyContext: true,
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining(
          "studies, evidence, or clinical source material",
        ),
      ]),
    );
  });

  it("skips scripted correct-next-response blocks instead of importing them as questions", () => {
    const preview = previewSurveyImport({
      studyName: "BRUKINSA Scripted Response Cleanup",
      sourceText: [
        "Opening",
        "Q1. Which B-cell malignancies do you personally treat?",
        "Correct Next Response:",
        "Got it — since CLL/SLL is most relevant to your practice, I'll focus there.",
        'Respondent: "It looks like they have a lot of indications, but how deep is the evidence?"',
        "What specifically makes that persuasive: the head-to-head design, the endpoint, or something else?",
        "Final Reactions",
        "Q2. What is your overall reaction to the BRUKINSA evidence story?",
      ].join("\n"),
    });

    expect(preview.modules.map((module) => module.key)).not.toContain(
      "correct-next-response",
    );
    expect(preview.questions.map((question) => question.prompt)).toEqual([
      "Which B-cell malignancies do you personally treat?",
      "What is your overall reaction to the BRUKINSA evidence story?",
      "Before we finish, is there anything important that this survey has not covered?",
    ]);
    expect(
      preview.questions.some((question) =>
        /Got it|Respondent:|What specifically makes that persuasive/i.test(
          question.prompt,
        ),
      ),
    ).toBe(false);
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scripted response line"),
      ]),
    );
  });

  it("captures scripted study details as proactive source-context guidance", () => {
    const preview = previewSurveyImport({
      studyName: "BRUKINSA Study Detail Import",
      sourceText: [
        "Q1. How does this affect your view of BRUKINSA for CLL/SLL patients?",
        "Correct Next Response:",
        "The ALPINE study compared BRUKINSA with ibrutinib and reported response, progression-free survival, and safety data in relapsed or refractory CLL/SLL.",
        'Respondent: "So this is a head-to-head trial?"',
        "What specifically makes that evidence persuasive to you?",
        "Q2. What is your overall reaction to the BRUKINSA evidence story?",
      ].join("\n"),
    });

    expect(preview.questions.map((question) => question.prompt)).toEqual([
      "How does this affect your view of BRUKINSA for CLL/SLL patients?",
      "What is your overall reaction to the BRUKINSA evidence story?",
      "Before we finish, is there anything important that this survey has not covered?",
    ]);
    expect(preview.questions[0]).toMatchObject({
      requiresGroundedStudyContext: true,
      sourceContextHint:
        "The ALPINE study compared BRUKINSA with ibrutinib and reported response, progression-free survival, and safety data in relapsed or refractory CLL/SLL.",
    });
    expect(preview.questions[1]).toMatchObject({
      requiresGroundedStudyContext: true,
      sourceContextHint: null,
    });
    expect(preview.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("scripted response line"),
        expect.stringContaining("proactive source-context guidance"),
      ]),
    );
  });
});
