import type { StudyGraphResponse } from "@interview/schemas";

export type SourceContextQuestion =
  StudyGraphResponse["sourceContext"]["questions"][number];

export type ParsedSourceContextNote = {
  nodeKey: string;
  nodeId: string;
  sourceContextHint: string;
  sourceContextReferences: SourceContextQuestion["sourceContextReferences"];
};

function hasReferencedApprovedNote(question: SourceContextQuestion) {
  return (
    Boolean(question.sourceContextHint) &&
    question.sourceContextReferences.length > 0
  );
}

export function buildSourceContextWorklist(
  studyId: string,
  questions: SourceContextQuestion[],
) {
  const needsDetailQuestions = questions.filter(
    (question) => !hasReferencedApprovedNote(question),
  );
  const worklistQuestions =
    needsDetailQuestions.length > 0 ? needsDetailQuestions : questions;

  return [
    `Study ID: ${studyId}`,
    `Generated: ${new Date().toISOString()}`,
    `Purpose: proactive CustomGPT/source-material worklist`,
    `Questions needing source detail: ${needsDetailQuestions.length} of ${questions.length}`,
    "",
    "For each item, make sure the CustomGPT project has the approved source material needed to answer the prompt with references. In this app, use Preview Detail and fielding readiness to confirm the respondent will see source-grounded context before the survey question.",
    "",
    ...worklistQuestions.flatMap((question, index) => [
      `${index + 1}. ${question.title}`,
      `Node: ${question.nodeKey}`,
      `Module: ${question.moduleTitle ?? "Unassigned"}`,
      `Asset: ${question.assetTitle ?? "No staged asset"}`,
      `Status: ${
        hasReferencedApprovedNote(question)
          ? "Referenced approved source note saved"
          : question.sourceContextHint
            ? "Needs approved reference"
            : "Needs detail"
      }`,
      `Prompt: ${question.prompt}`,
      question.sourceContextHint
        ? `Approved source note: ${question.sourceContextHint}`
        : "Approved source note:",
      ...formatReferenceLines(question),
      question.sourceContextHint
        ? null
        : "Needed source detail: upload/approve the clinical study, website, PDF, or other cited material that should summarize this evidence before the question.",
      question.sourceContextReferences.length > 0
        ? null
        : "Reference format: Approved reference: Title | URL | Description",
      "",
    ]),
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function formatReferenceLines(question: SourceContextQuestion) {
  if (question.sourceContextReferences.length === 0) {
    return ["Approved reference:"];
  }

  return question.sourceContextReferences.map((reference) =>
    [
      "Approved reference:",
      formatSourceContextReferenceLine(reference),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function formatSourceContextReferenceLine(
  reference: SourceContextQuestion["sourceContextReferences"][number],
) {
  return [reference.title, reference.url, reference.description]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" | ");
}

export function formatSourceContextReferenceDraft(
  references: SourceContextQuestion["sourceContextReferences"],
) {
  return references.map(formatSourceContextReferenceLine).join("\n");
}

function normalizeMultilineNote(lines: string[]) {
  return lines
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function parseSourceContextWorklistNotes(
  worklistText: string,
  questions: SourceContextQuestion[],
) {
  const questionsByKey = new Map(
    questions.map((question) => [question.nodeKey, question]),
  );
  const notesByNodeId = new Map<string, ParsedSourceContextNote>();
  const lines = worklistText.replace(/\r\n?/gu, "\n").split("\n");
  let currentNodeKey: string | null = null;
  let collectingNodeKey: string | null = null;
  let noteLines: string[] = [];
  let referenceLines: string[] = [];

  const flushNote = () => {
    if (!collectingNodeKey) {
      return;
    }

    const question = questionsByKey.get(collectingNodeKey);
    const sourceContextHint = normalizeMultilineNote(noteLines);

    if (question && sourceContextHint) {
      notesByNodeId.set(question.nodeId, {
        nodeId: question.nodeId,
        nodeKey: question.nodeKey,
        sourceContextHint,
        sourceContextReferences: parseReferenceLines(
          question.nodeKey,
          referenceLines,
        ),
      });
    }

    collectingNodeKey = null;
    noteLines = [];
    referenceLines = [];
  };

  for (const line of lines) {
    const nodeMatch = /^Node:\s*(.+)\s*$/u.exec(line);
    if (nodeMatch) {
      flushNote();
      currentNodeKey = nodeMatch[1].trim();
      continue;
    }

    if (/^\d+\.\s/u.test(line)) {
      flushNote();
      continue;
    }

    const approvedNoteMatch = /^Approved source note:\s*(.*)$/u.exec(line);
    if (approvedNoteMatch) {
      flushNote();
      collectingNodeKey = currentNodeKey;
      noteLines = approvedNoteMatch[1].trim()
        ? [approvedNoteMatch[1].trim()]
        : [];
      referenceLines = [];
      continue;
    }

    const approvedReferenceMatch = /^Approved reference(?:\s+\d+)?:\s*(.*)$/u.exec(
      line,
    );
    if (approvedReferenceMatch) {
      if (collectingNodeKey && approvedReferenceMatch[1].trim()) {
        referenceLines.push(approvedReferenceMatch[1].trim());
      }
      continue;
    }

    if (
      /^(Needed source detail|Reference format|Prompt|Status|Module|Asset):/u.test(
        line,
      )
    ) {
      if (collectingNodeKey && line.startsWith("Needed source detail:")) {
        flushNote();
      }
      continue;
    }

    if (collectingNodeKey) {
      noteLines.push(line);
    }
  }

  flushNote();

  return Array.from(notesByNodeId.values());
}

function normalizeReferenceDraftLine(line: string) {
  return line.replace(/^Approved reference(?:\s+\d+)?:\s*/u, "").trim();
}

export function parseSourceContextReferenceDraft(
  nodeKey: string,
  draft: string,
) {
  return parseReferenceLines(
    nodeKey,
    draft
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .map(normalizeReferenceDraftLine)
      .filter(Boolean),
  );
}

function parseReferenceLines(nodeKey: string, lines: string[]) {
  return lines
    .map((line, index) => {
      const parts = normalizeReferenceDraftLine(line)
        .split("|")
        .map((part) => part.trim())
        .filter(Boolean);
      const [first, second, ...rest] = parts;
      const firstIsUrl = isLikelyUrl(first);
      const secondIsUrl = isLikelyUrl(second);
      const title = first && !firstIsUrl ? first : null;
      const url = firstIsUrl ? first : secondIsUrl ? second : null;
      const descriptionParts = firstIsUrl
        ? second
          ? [second, ...rest]
          : rest
        : secondIsUrl
          ? rest
          : second
            ? [second, ...rest]
            : rest;
      const description = descriptionParts.join(" | ").trim() || null;

      if (!title && !url && !description) {
        return null;
      }

      return {
        citationId: `worklist:${nodeKey}:${index + 1}`,
        title,
        url,
        description,
      };
    })
    .filter(
      (
        reference,
      ): reference is SourceContextQuestion["sourceContextReferences"][number] =>
        reference !== null,
    );
}

function isLikelyUrl(value: string | undefined) {
  return Boolean(value && /^https?:\/\//iu.test(value));
}
