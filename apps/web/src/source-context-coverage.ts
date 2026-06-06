import type {
  StudyGraphResponse,
  StudyLaunchCheckResponse,
} from "@interview/schemas";

type SourceContext = StudyGraphResponse["sourceContext"];

function itemStatus(launchCheck: StudyLaunchCheckResponse, key: string) {
  return launchCheck.items.find((item) => item.key === key)?.status ?? null;
}

export function buildSourceContextCoverageSummary(input: {
  sourceContext: SourceContext;
  launchCheck: StudyLaunchCheckResponse;
}) {
  const approvedNoteCount =
    input.sourceContext.referencedApprovedNoteQuestionCount;
  const needsDetailCount =
    input.sourceContext.missingReferencedDetailQuestionCount;
  const customGptKeyReady =
    itemStatus(input.launchCheck, "customgpt_key") === "pass";
  const sourceContextReady =
    itemStatus(input.launchCheck, "source_context") === "pass";

  if (input.sourceContext.enabledQuestionCount === 0) {
    return {
      label: "No Source Context",
      status: "muted" as const,
      detail: "No questions are configured for proactive study/source detail.",
      action:
        "Enable source context on evidence, study, or asset reaction questions.",
    };
  }

  if (needsDetailCount === 0) {
    return {
      label: "Coverage Ready",
      status: "good" as const,
      detail: `${approvedNoteCount} referenced approved source note${
        approvedNoteCount === 1 ? "" : "s"
      } saved for ${input.sourceContext.enabledQuestionCount} source-context question${
        input.sourceContext.enabledQuestionCount === 1 ? "" : "s"
      }.`,
      action:
        "Use Preview Detail or Start Test Here to confirm respondent-facing context.",
    };
  }

  if (sourceContextReady && customGptKeyReady) {
    return {
      label: "CustomGPT + Notes Ready",
      status: "good" as const,
      detail: `${needsDetailCount} source-context question${
        needsDetailCount === 1 ? "" : "s"
      } will pull live CustomGPT detail; ${approvedNoteCount} referenced approved source note${
        approvedNoteCount === 1 ? "" : "s"
      } will be shown immediately as reviewer-controlled context.`,
      action:
        "Run Preview All CustomGPT Detail, then save cited previews where you want fast reviewer-approved respondent context.",
    };
  }

  if (customGptKeyReady) {
    return {
      label: "Preview Needed",
      status: "warning" as const,
      detail: `${needsDetailCount} source-context question${
        needsDetailCount === 1 ? "" : "s"
      } still need referenced approved detail; CustomGPT is configured.`,
      action:
        "Run Preview All CustomGPT Detail, then save passed previews with references as approved notes.",
    };
  }

  return {
    label: "Needs Source Coverage",
    status: "warning" as const,
    detail: `${needsDetailCount} source-context question${
      needsDetailCount === 1 ? "" : "s"
    } still need CustomGPT coverage or referenced approved notes.`,
    action:
      "Add CUSTOMGPT_API_KEY and source material, or copy/download the worklist and paste approved notes with references back in.",
  };
}
