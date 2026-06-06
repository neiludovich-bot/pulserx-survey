import { describe, expect, it } from "vitest";
import type {
  StudyGraphResponse,
  StudyLaunchCheckResponse,
} from "@interview/schemas";
import { buildSourceContextCoverageSummary } from "./source-context-coverage";

function launchCheck(
  itemStatuses: Record<
    string,
    StudyLaunchCheckResponse["items"][number]["status"]
  >,
) {
  return {
    items: Object.entries(itemStatuses).map(([key, status]) => ({
      key,
      label: key,
      status,
      detail: `${key} ${status}`,
      action: null,
      actionHref: null,
    })),
  } as StudyLaunchCheckResponse;
}

function sourceContext(input: {
  enabledQuestionCount: number;
  approvedNoteCount: number;
}) {
  return {
    enabledQuestionCount: input.enabledQuestionCount,
    detectedQuestionCount: input.enabledQuestionCount,
    overrideEnabledCount: 0,
    overrideDisabledCount: 0,
    referencedApprovedNoteQuestionCount: input.approvedNoteCount,
    missingReferencedDetailQuestionCount:
      input.enabledQuestionCount - input.approvedNoteCount,
    importedHintQuestionCount: input.approvedNoteCount,
    missingImportedHintQuestionCount:
      input.enabledQuestionCount - input.approvedNoteCount,
    questions: Array.from(
      { length: input.enabledQuestionCount },
      (_, index) => ({
        nodeId: `node_${index + 1}`,
        nodeKey: `node_${index + 1}`,
        title: `Question ${index + 1}`,
        prompt: `Prompt ${index + 1}`,
        moduleTitle: "Module",
        sourceContextDetected: true,
        sourceContextOverride: null,
        sourceContextHint:
          index < input.approvedNoteCount ? `Approved note ${index + 1}` : null,
        sourceContextReferences:
          index < input.approvedNoteCount
            ? [
                {
                  citationId: `source_${index + 1}`,
                  title: `Source ${index + 1}`,
                  url: `https://example.test/source-${index + 1}`,
                  description: null,
                },
              ]
            : [],
        assetTitle: null,
      }),
    ),
  } as StudyGraphResponse["sourceContext"];
}

describe("source context coverage summary", () => {
  it("points missing-key studies toward CustomGPT setup or approved notes", () => {
    const summary = buildSourceContextCoverageSummary({
      sourceContext: sourceContext({
        enabledQuestionCount: 3,
        approvedNoteCount: 1,
      }),
      launchCheck: launchCheck({
        customgpt_key: "fail",
        source_context: "fail",
      }),
    });

    expect(summary).toMatchObject({
      label: "Needs Source Coverage",
      status: "warning",
    });
    expect(summary.action).toContain("CUSTOMGPT_API_KEY");
  });

  it("points keyed studies toward preview and approval", () => {
    const summary = buildSourceContextCoverageSummary({
      sourceContext: sourceContext({
        enabledQuestionCount: 2,
        approvedNoteCount: 0,
      }),
      launchCheck: launchCheck({
        customgpt_key: "pass",
        source_context: "fail",
      }),
    });

    expect(summary).toMatchObject({
      label: "Preview Needed",
      status: "warning",
    });
    expect(summary.action).toContain("Preview All CustomGPT Detail");
  });

  it("distinguishes runtime CustomGPT coverage from approved notes", () => {
    const summary = buildSourceContextCoverageSummary({
      sourceContext: sourceContext({
        enabledQuestionCount: 3,
        approvedNoteCount: 1,
      }),
      launchCheck: launchCheck({
        customgpt_key: "pass",
        source_context: "pass",
      }),
    });

    expect(summary).toMatchObject({
      label: "CustomGPT + Notes Ready",
      status: "good",
    });
    expect(summary.detail).toContain("will pull live CustomGPT detail");
    expect(summary.detail).toContain("reviewer-controlled context");
    expect(summary.action).toContain("reviewer-approved respondent context");
  });

  it("reports ready coverage when all source-context questions have notes", () => {
    const summary = buildSourceContextCoverageSummary({
      sourceContext: sourceContext({
        enabledQuestionCount: 2,
        approvedNoteCount: 2,
      }),
      launchCheck: launchCheck({
        customgpt_key: "fail",
        source_context: "pass",
      }),
    });

    expect(summary).toMatchObject({
      label: "Coverage Ready",
      status: "good",
    });
  });

  it("does not count source notes without references as ready coverage", () => {
    const summary = buildSourceContextCoverageSummary({
      sourceContext: {
        ...sourceContext({
          enabledQuestionCount: 1,
          approvedNoteCount: 0,
        }),
        referencedApprovedNoteQuestionCount: 0,
        missingReferencedDetailQuestionCount: 1,
        questions: [
          {
            ...sourceContext({
              enabledQuestionCount: 1,
              approvedNoteCount: 0,
            }).questions[0],
            sourceContextHint: "Uncited approved note text.",
          },
        ],
      },
      launchCheck: launchCheck({
        customgpt_key: "fail",
        source_context: "fail",
      }),
    });

    expect(summary).toMatchObject({
      label: "Needs Source Coverage",
      status: "warning",
    });
    expect(summary.detail).toContain("1 source-context question");
  });
});
