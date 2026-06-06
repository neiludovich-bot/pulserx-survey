import { inflateRawSync } from "node:zlib";
import type { Prisma } from "@prisma/client";
import {
  publishSurveyImportResponseSchema,
  surveyImportPreviewSchema,
  type PreviewSurveyImportRequest,
  type SurveyImportAsset,
  type SurveyImportModule,
  type SurveyImportPreview,
  type SurveyImportQuestion,
} from "@interview/schemas";
import { prisma } from "./prisma";
import { shouldProactivelyGroundClinicalStudyQuestion } from "./study-grounding";

type ZipEntry = {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
};

const WORD_DOCUMENT_PATH = "word/document.xml";

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72) || "imported-survey"
  );
}

function toTitle(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanPrompt(value: string) {
  return value
    .replace(/^\s*(?:q\s*)?\d+[.)\]-]?\s*/i, "")
    .replace(/^\s*[a-z][.)\]-]\s*/i, "")
    .replace(/^["“]|["”]$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionLike(line: string) {
  return (
    /\?["”]?$/.test(line) ||
    /^(?:q\s*)?\d+[.)\]-]\s+\S+.*\?["”]?$/i.test(line) ||
    /^(?:ask|probe|follow[- ]?up)\b/i.test(line)
  );
}

function isExplicitQuestionStart(line: string) {
  return (
    /^(?:q\s*)?\d+[.)\]-]\s+\S+/i.test(line) ||
    /^(?:ask|probe|follow[- ]?up)\b/i.test(line)
  );
}

function isHeadingLike(line: string) {
  if (isQuestionLike(line)) {
    return false;
  }

  const wordCount = line.split(/\s+/).length;
  const hasSentencePunctuation = /[?.]$/.test(line);
  const lettersOnly = line.replace(/[^a-z]/gi, "");
  const isUppercase =
    lettersOnly.length > 0 && lettersOnly === lettersOnly.toUpperCase();
  return (
    /^module\b/i.test(line) ||
    (wordCount <= 16 && isUppercase && !hasSentencePunctuation)
  );
}

function isScriptedResponseSectionHeading(line: string) {
  return /^\s*(?:correct\s+next\s+response|suggested\s+(?:next\s+)?response|expected\s+(?:next\s+)?response|sample\s+(?:interviewer\s+)?response|example\s+(?:interviewer\s+)?response)\s*:?\s*$/i.test(
    line,
  );
}

function isSampleRespondentLine(line: string) {
  return /^\s*(?:respondent|participant|hcp|user)\s*:/i.test(line);
}

function isSourceContextHintLine(line: string) {
  if (isSampleRespondentLine(line) || isQuestionLike(line)) {
    return false;
  }

  return (
    shouldProactivelyGroundClinicalStudyQuestion(line) ||
    /\b(study|trial|evidence|data|endpoint|comparator|PFS|OS|ORR|response rate|safety|tolerability|follow-up|result|caveat|limitation|head-to-head|phase\s*[123])\b/i.test(
      line,
    )
  );
}

function splitInlinePrompt(line: string) {
  const match = line.match(
    /^\s*((?:adaptive follow[- ]?up|follow[- ]?up|probe|ask)\b[^:]*|if\b[^:]+):\s*(.+)$/i,
  );

  if (!match) {
    return null;
  }

  const label = match[1].trim();
  const prompt = match[2].trim();
  if (!prompt) {
    return null;
  }

  return {
    conditionSource: /^if\b/i.test(label)
      ? label.replace(/^if\b/i, "").trim()
      : null,
    prompt,
    optional: !/^ask\b/i.test(label),
  };
}

function conditionKeywords(conditionSource: string) {
  const words = conditionSource
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 0 &&
        ![
          "if",
          "they",
          "them",
          "their",
          "the",
          "that",
          "this",
          "from",
          "with",
          "about",
          "answer",
          "answers",
          "answered",
          "respondent",
          "participant",
          "hcp",
          "treat",
          "treats",
          "treated",
          "treating",
          "uses",
          "using",
          "use",
          "user",
          "users",
          "site",
          "website",
        ].includes(word),
    );

  return [...new Set(words)].slice(0, 5);
}

function getStudyName(input: PreviewSurveyImportRequest, sourceName: string) {
  if (input.studyName?.trim()) {
    return input.studyName.trim();
  }

  return toTitle(
    sourceName
      .replace(/\.[^.]+$/, "")
      .replace(/\b(question|list|guide|docx|survey)\b/gi, "")
      .trim() || "Imported Adaptive Survey",
  );
}

function defaultFactKey(prompt: string, index: number) {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(
      (word) =>
        word.length > 3 &&
        ![
          "what",
          "when",
          "where",
          "which",
          "would",
          "could",
          "should",
          "about",
          "their",
          "there",
          "with",
          "from",
          "that",
          "this",
          "your",
          "they",
          "have",
          "does",
        ].includes(word),
    )
    .slice(0, 3);

  const baseKey = words.length > 0 ? words.join("_") : "answer";

  return `${baseKey}_${index}`;
}

function decodeXmlText(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readUInt16(buffer: Buffer, offset: number) {
  return buffer.readUInt16LE(offset);
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32LE(offset);
}

function parseCentralDirectory(buffer: Buffer) {
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (readUInt32(buffer, offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error("DOCX archive is missing a ZIP directory.");
  }

  const entryCount = readUInt16(buffer, eocdOffset + 10);
  const centralDirectoryOffset = readUInt32(buffer, eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32(buffer, offset) !== 0x02014b50) {
      throw new Error("DOCX archive has an invalid ZIP directory.");
    }

    const compressionMethod = readUInt16(buffer, offset + 10);
    const compressedSize = readUInt32(buffer, offset + 20);
    const uncompressedSize = readUInt32(buffer, offset + 24);
    const fileNameLength = readUInt16(buffer, offset + 28);
    const extraLength = readUInt16(buffer, offset + 30);
    const commentLength = readUInt16(buffer, offset + 32);
    const localHeaderOffset = readUInt32(buffer, offset + 42);
    const name = buffer
      .subarray(offset + 46, offset + 46 + fileNameLength)
      .toString("utf8");

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(buffer: Buffer, entry: ZipEntry) {
  const offset = entry.localHeaderOffset;
  if (readUInt32(buffer, offset) !== 0x04034b50) {
    throw new Error(`DOCX entry ${entry.name} has an invalid local header.`);
  }

  const fileNameLength = readUInt16(buffer, offset + 26);
  const extraLength = readUInt16(buffer, offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(
    dataStart,
    dataStart + entry.compressedSize,
  );

  if (entry.compressionMethod === 0) {
    return compressed;
  }

  if (entry.compressionMethod === 8) {
    const inflated = inflateRawSync(compressed);
    if (
      entry.uncompressedSize > 0 &&
      inflated.length !== entry.uncompressedSize
    ) {
      throw new Error(`DOCX entry ${entry.name} did not inflate cleanly.`);
    }
    return inflated;
  }

  throw new Error(
    `DOCX entry ${entry.name} uses unsupported compression ${entry.compressionMethod}.`,
  );
}

export function extractTextFromDocx(buffer: Buffer) {
  const entries = parseCentralDirectory(buffer);
  const documentEntry = entries.find(
    (entry) => entry.name === WORD_DOCUMENT_PATH,
  );

  if (!documentEntry) {
    throw new Error("DOCX did not contain word/document.xml.");
  }

  const xml = readZipEntry(buffer, documentEntry).toString("utf8");
  return Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g))
    .map((paragraph) =>
      Array.from(paragraph[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g))
        .map((match) => decodeXmlText(match[1]))
        .join(""),
    )
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

function sourceTextFromRequest(input: PreviewSurveyImportRequest) {
  if (input.fileBase64) {
    const buffer = Buffer.from(input.fileBase64, "base64");
    const sourceName = input.fileName ?? "uploaded-survey-guide.docx";

    if (/\.docx$/i.test(sourceName)) {
      return {
        sourceName,
        text: extractTextFromDocx(buffer),
      };
    }

    return {
      sourceName,
      text: buffer.toString("utf8"),
    };
  }

  return {
    sourceName: input.fileName ?? "pasted-survey-guide.txt",
    text: input.sourceText ?? "",
  };
}

function fileNameFromPath(value: string) {
  const cleaned = value.split(/[?#]/)[0] ?? value;
  return cleaned.split(/[\\/]/).filter(Boolean).at(-1) ?? cleaned;
}

function mimeTypeFromName(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  if (/\.pdf$/i.test(value)) {
    return "application/pdf";
  }

  if (/\.(png)$/i.test(value)) {
    return "image/png";
  }

  if (/\.(jpe?g)$/i.test(value)) {
    return "image/jpeg";
  }

  if (/\.webp$/i.test(value)) {
    return "image/webp";
  }

  if (/\.html?$/i.test(value)) {
    return "text/html";
  }

  if (/\.(txt|md)$/i.test(value)) {
    return "text/plain";
  }

  if (/\.(mp4|webm|mov)$/i.test(value)) {
    return "video/mp4";
  }

  return null;
}

function inferAssetType(input: {
  explicitType?: SurveyImportAsset["assetType"];
  mimeType: string | null;
  sourceName: string;
}): SurveyImportAsset["assetType"] {
  if (input.explicitType) {
    return input.explicitType;
  }

  if (
    input.mimeType === "application/pdf" ||
    /\.pdf$/i.test(input.sourceName)
  ) {
    return "PDF";
  }

  if (input.mimeType?.startsWith("image/")) {
    return "IMAGE";
  }

  if (input.mimeType?.startsWith("video/")) {
    return "VIDEO";
  }

  return "TEXT";
}

function buildImportAsset(
  input: PreviewSurveyImportRequest,
): SurveyImportAsset | null {
  const hasAssetIntent = Boolean(
    input.assetTitle ||
    input.assetDescription ||
    input.assetStorageKey ||
    input.assetFileName ||
    input.assetFileBase64 ||
    input.assetMimeType ||
    input.assetType,
  );

  if (!hasAssetIntent) {
    return null;
  }

  if (!input.assetStorageKey && !input.assetFileBase64) {
    throw new Error(
      "Provide a side-pane asset file or URL/path before previewing the import.",
    );
  }

  const sourceName =
    input.assetFileName ??
    (input.assetStorageKey ? fileNameFromPath(input.assetStorageKey) : null) ??
    "side-pane-asset";
  const title =
    input.assetTitle?.trim() ??
    toTitle(sourceName.replace(/\.[^.]+$/, "") || "Side Pane Asset");
  const mimeType =
    input.assetMimeType ??
    mimeTypeFromName(input.assetFileName) ??
    mimeTypeFromName(input.assetStorageKey) ??
    "application/octet-stream";

  return {
    key: slugify(title).slice(0, 48) || "side-pane-asset",
    title,
    description: input.assetDescription?.trim() || null,
    assetType: inferAssetType({
      explicitType: input.assetType,
      mimeType,
      sourceName,
    }),
    storageKey: input.assetFileBase64
      ? `db://pending-upload/${slugify(sourceName)}`
      : input.assetStorageKey?.trim() || sourceName,
    mimeType,
    fileName: input.assetFileName ?? null,
    fileBase64: input.assetFileBase64 ?? null,
    displayMode: input.assetDisplayMode ?? "INLINE_PANE",
  };
}

function formatMinutes(seconds: number) {
  const minutes = seconds / 60;

  return Number.isInteger(minutes)
    ? `${minutes} minutes`
    : `${minutes.toFixed(1)} minutes`;
}

function promptMentionsReviewAsset(prompt: string) {
  return /\b(website|site|page|pdf|asset|material|guide|visual|concept|message|claim|label)\b/i.test(
    prompt,
  );
}

function addImportReadinessWarnings(input: {
  questions: SurveyImportQuestion[];
  warnings: string[];
  targetDurationSeconds: number;
  closingReserveSeconds: number;
  customGptProjectId?: string | null;
  asset: SurveyImportAsset | null;
}) {
  const estimatedQuestionSeconds = input.questions.reduce(
    (total, question) => total + question.estimatedSeconds,
    0,
  );
  const availableInterviewSeconds = Math.max(
    0,
    input.targetDurationSeconds - input.closingReserveSeconds,
  );

  if (
    availableInterviewSeconds > 0 &&
    estimatedQuestionSeconds > availableInterviewSeconds
  ) {
    input.warnings.push(
      `Estimated guide length is ${formatMinutes(estimatedQuestionSeconds)}, which is longer than the ${formatMinutes(input.targetDurationSeconds)} target. The runtime time limit will move to wrap-up before every question is reached.`,
    );
  }

  if (!input.customGptProjectId) {
    input.warnings.push(
      "No per-study CustomGPT project ID was provided. Add one in Study Settings if participant side questions should be answered from approved source material.",
    );
  }

  if (
    !input.customGptProjectId &&
    input.questions.some((question) => question.requiresGroundedStudyContext)
  ) {
    input.warnings.push(
      "Some prompts ask respondents to react to studies, evidence, or clinical source material. Add a CustomGPT project with the approved source material so those questions can receive proactive context.",
    );
  }

  if (
    !input.asset &&
    input.questions.some((question) =>
      promptMentionsReviewAsset(question.prompt),
    )
  ) {
    input.warnings.push(
      "Some prompts appear to reference a website, guide, or material, but no side-pane asset was attached.",
    );
  }
}

export function previewSurveyImport(input: PreviewSurveyImportRequest) {
  const { sourceName, text } = sourceTextFromRequest(input);
  const lines = text
    .split(/\r?\n/)
    .map((line, index) => ({
      text: line.trim(),
      lineNumber: index + 1,
    }))
    .filter((line) => line.text.length > 0);
  const studyName = getStudyName(input, sourceName);
  const asset = buildImportAsset(input);
  const modules = new Map<string, SurveyImportModule>();
  const questions: SurveyImportQuestion[] = [];
  const warnings: string[] = [];
  let currentModuleKey = "main";
  let pendingOptionalPrompt = false;
  let pendingConditionSource: string | null = null;
  let lastUnconditionalQuestionKey: string | null = null;
  let skippingScriptedResponseBlock = false;
  let scriptedResponseBlockLines: Array<{ text: string; lineNumber: number }> =
    [];
  let skippedScriptedResponseLineCount = 0;
  let capturedSourceContextHintCount = 0;

  modules.set(currentModuleKey, {
    key: currentModuleKey,
    title: "Main Interview",
    position: 1,
  });

  const attachScriptedResponseBlockToPreviousQuestion = () => {
    if (scriptedResponseBlockLines.length === 0) {
      return;
    }

    const hintLines = scriptedResponseBlockLines
      .filter((line) => isSourceContextHintLine(line.text))
      .map((line) => cleanPrompt(line.text))
      .filter((line) => line.length >= 12);

    if (hintLines.length > 0 && questions.length > 0) {
      const question = questions[questions.length - 1];
      const existingHint = question.sourceContextHint
        ? `${question.sourceContextHint}\n`
        : "";
      question.sourceContextHint = `${existingHint}${hintLines.join("\n")}`;
      question.requiresGroundedStudyContext = true;
      capturedSourceContextHintCount += hintLines.length;
    }

    scriptedResponseBlockLines = [];
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const inlinePrompt = splitInlinePrompt(line.text);
    const questionText = inlinePrompt?.prompt ?? line.text;
    const nextLine = lines[lineIndex + 1]?.text ?? "";
    const looksLikeLocalSection =
      !isQuestionLike(line.text) &&
      isQuestionLike(nextLine) &&
      line.text.split(/\s+/).length <= 8 &&
      !/[?.]$/.test(line.text);
    const lineStartsNewSection =
      isHeadingLike(line.text) || looksLikeLocalSection;
    const lineStartsFieldablePrompt =
      Boolean(inlinePrompt) || isExplicitQuestionStart(line.text);

    if (isScriptedResponseSectionHeading(line.text)) {
      attachScriptedResponseBlockToPreviousQuestion();
      skippingScriptedResponseBlock = true;
      skippedScriptedResponseLineCount += 1;
      continue;
    }

    if (
      skippingScriptedResponseBlock &&
      !lineStartsNewSection &&
      !lineStartsFieldablePrompt
    ) {
      scriptedResponseBlockLines.push(line);
      skippedScriptedResponseLineCount += 1;
      continue;
    }

    if (
      skippingScriptedResponseBlock &&
      (lineStartsNewSection || lineStartsFieldablePrompt)
    ) {
      attachScriptedResponseBlockToPreviousQuestion();
      skippingScriptedResponseBlock = false;
    }

    if (
      !inlinePrompt &&
      /^(?:adaptive follow[- ]?up|if\b.*|probe)\s*:\s*$/i.test(line.text)
    ) {
      pendingOptionalPrompt = true;
      pendingConditionSource = /^if\b/i.test(line.text)
        ? line.text.replace(/^if\b/i, "").replace(/:\s*$/, "").trim()
        : null;
      continue;
    }

    if (!inlinePrompt && /^ask\s*:\s*$/i.test(line.text)) {
      pendingOptionalPrompt = false;
      pendingConditionSource = null;
      continue;
    }

    if (lineStartsNewSection) {
      const key =
        slugify(line.text).slice(0, 48) || `module_${modules.size + 1}`;
      currentModuleKey = key;
      if (!modules.has(key)) {
        modules.set(key, {
          key,
          title: toTitle(line.text),
          position: modules.size + 1,
        });
      }
      continue;
    }

    if (isSampleRespondentLine(line.text)) {
      skippedScriptedResponseLineCount += 1;
      continue;
    }

    if (!inlinePrompt && !isQuestionLike(line.text)) {
      continue;
    }

    const prompt = cleanPrompt(questionText);
    if (prompt.length < 12) {
      continue;
    }

    const index = questions.length + 1;
    const key = slugify(prompt).slice(0, 48) || `question_${index}`;
    const isOptionalProbe =
      inlinePrompt?.optional ?? /^(probe|follow[- ]?up)\b/i.test(line.text);
    const conditionSource =
      inlinePrompt?.conditionSource ?? pendingConditionSource;
    const keywords = conditionSource ? conditionKeywords(conditionSource) : [];
    const questionKey = `${key}_${index}`;
    const requiresGroundedStudyContext =
      shouldProactivelyGroundClinicalStudyQuestion(prompt);
    questions.push({
      key: questionKey,
      moduleKey: currentModuleKey,
      title:
        prompt.length > 68
          ? `${prompt.slice(0, 65).replace(/\s+\S*$/, "")}...`
          : prompt,
      prompt,
      mustAsk: !isOptionalProbe && !pendingOptionalPrompt,
      condition:
        conditionSource && keywords.length > 0
          ? {
              source: conditionSource,
              sourceQuestionKey: lastUnconditionalQuestionKey,
              matchKeywords: keywords,
            }
          : null,
      factKeys: [defaultFactKey(prompt, index)],
      estimatedSeconds: isOptionalProbe ? 45 : 70,
      requiresGroundedStudyContext,
      sourceContextHint: null,
      sourceLine: line.lineNumber,
    });
    if (!conditionSource) {
      lastUnconditionalQuestionKey = questionKey;
    }
    pendingOptionalPrompt = false;
    pendingConditionSource = null;
  }

  attachScriptedResponseBlockToPreviousQuestion();

  if (questions.length === 0) {
    throw new Error(
      "No questions were detected. Try pasting the raw question list text.",
    );
  }

  if (skippedScriptedResponseLineCount > 0) {
    warnings.push(
      `Skipped ${skippedScriptedResponseLineCount} scripted response line(s) that appeared to be interviewer examples or respondent quotes rather than survey questions.`,
    );
  }

  if (capturedSourceContextHintCount > 0) {
    warnings.push(
      `Captured ${capturedSourceContextHintCount} scripted response line(s) as proactive source-context guidance on the preceding question(s).`,
    );
  }

  if (!questions.some((question) => question.mustAsk)) {
    warnings.push(
      "No must-ask questions were detected; all questions are optional.",
    );
  }

  if (
    !questions.some((question) =>
      /wrap|finish|anything else/i.test(question.prompt),
    )
  ) {
    questions.push({
      key: "wrap_up",
      moduleKey: currentModuleKey,
      title: "Wrap Up",
      prompt:
        "Before we finish, is there anything important that this survey has not covered?",
      mustAsk: false,
      condition: null,
      factKeys: ["wrap_up"],
      estimatedSeconds: 60,
      requiresGroundedStudyContext: false,
      sourceContextHint: null,
      sourceLine: null,
    });
    warnings.push("Added a default wrap-up question.");
  }

  const targetDurationSeconds = Math.round(
    (input.targetDurationMinutes ?? 15) * 60,
  );
  const closingReserveSeconds = 90;

  addImportReadinessWarnings({
    questions,
    warnings,
    targetDurationSeconds,
    closingReserveSeconds,
    customGptProjectId: input.customGptProjectId,
    asset,
  });

  const preview = surveyImportPreviewSchema.parse({
    sourceName,
    studyName,
    slug: slugify(studyName),
    description: `Imported from ${sourceName}. Review questions and settings before fielding.`,
    targetDurationSeconds,
    closingReserveSeconds,
    maxAttemptsPerQuestion: 2,
    maxOffTopicRedirects: 2,
    customGptProjectId: input.customGptProjectId ?? null,
    asset,
    modules: Array.from(modules.values()),
    questions,
    warnings,
  });

  return preview;
}

async function uniqueSlug(baseSlug: string) {
  let slug = baseSlug;
  let suffix = 2;
  while (await prisma.study.findUnique({ where: { slug } })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

function nodeIdFor(index: number) {
  return `import_node_${index}`;
}

export async function publishSurveyImport(preview: SurveyImportPreview) {
  const parsed = surveyImportPreviewSchema.parse(preview);
  const slug = await uniqueSlug(parsed.slug);
  const studyId = `study_${slug.replace(/-/g, "_")}`;
  const importedAsset = parsed.asset
    ? {
        ...parsed.asset,
        id: `${studyId}_asset_${slugify(parsed.asset.key).slice(0, 36)}`,
        storageKey: parsed.asset.fileBase64
          ? `db://study-assets/${studyId}_asset_${slugify(parsed.asset.key).slice(0, 36)}/content`
          : parsed.asset.storageKey,
      }
    : null;
  const showAssetActionId = importedAsset
    ? `${studyId}_action_show_${slugify(importedAsset.key).slice(0, 36)}`
    : null;
  const moduleByKey = new Map(
    parsed.modules.map((module, index) => [
      module.key,
      {
        ...module,
        id: `module_${slug.replace(/-/g, "_")}_${index + 1}`,
      },
    ]),
  );
  const questionRows = parsed.questions.map((question, index) => {
    const isTerminal = index === parsed.questions.length - 1;
    return {
      importQuestion: question,
      id: `${studyId}_${nodeIdFor(index + 1)}`,
      isTerminal,
      position: index + 1,
      actionId: `${studyId}_${nodeIdFor(index + 1)}_action`,
    };
  });
  const branchRuleRows: Prisma.BranchRuleCreateManyInput[] = [];
  const rowByQuestionKey = new Map(
    questionRows.map((question) => [question.importQuestion.key, question]),
  );

  for (let index = 0; index < questionRows.length - 1; index += 1) {
    const question = questionRows[index];
    const condition = question.importQuestion.condition;

    if (condition) {
      const nextAfterConditionGroup =
        questionRows
          .slice(index + 1)
          .find(
            (candidate) =>
              candidate.importQuestion.condition?.sourceQuestionKey !==
              condition.sourceQuestionKey,
          ) ?? null;

      if (nextAfterConditionGroup) {
        branchRuleRows.push({
          id: `${question.id}_to_${nextAfterConditionGroup.id}`,
          studyId,
          fromNodeId: question.id,
          toNodeId: nextAfterConditionGroup.id,
          conditionType: "ALWAYS",
          priority: 20,
          rationale: "Continue after imported conditional follow-up.",
        });
      }
      continue;
    }

    const conditionalRows = questionRows
      .slice(index + 1)
      .filter(
        (candidate) =>
          candidate.importQuestion.condition?.sourceQuestionKey ===
          question.importQuestion.key,
      );
    const nextNonConditionalRow =
      questionRows
        .slice(index + 1)
        .find(
          (candidate) =>
            candidate.importQuestion.condition?.sourceQuestionKey !==
            question.importQuestion.key,
        ) ?? null;

    if (conditionalRows.length === 0) {
      const nextRow = questionRows[index + 1];
      branchRuleRows.push({
        id: `${question.id}_to_${nextRow.id}`,
        studyId,
        fromNodeId: question.id,
        toNodeId: nextRow.id,
        conditionType: "ALWAYS",
        priority: 1,
        rationale: "Imported guide order.",
      });
      continue;
    }

    for (
      let conditionalIndex = 0;
      conditionalIndex < conditionalRows.length;
      conditionalIndex += 1
    ) {
      const conditionalRow = conditionalRows[conditionalIndex];
      const conditional = conditionalRow.importQuestion.condition;
      const sourceRow = conditional?.sourceQuestionKey
        ? rowByQuestionKey.get(conditional.sourceQuestionKey)
        : null;
      const factKey = sourceRow?.importQuestion.factKeys[0];

      if (!conditional || !factKey) {
        continue;
      }

      branchRuleRows.push({
        id: `${question.id}_if_${conditionalRow.id}`,
        studyId,
        fromNodeId: question.id,
        toNodeId: conditionalRow.id,
        conditionType: "ANSWER_CONTAINS",
        factKey,
        comparisonValue: conditional.matchKeywords,
        priority: conditionalIndex + 1,
        rationale: `Imported conditional follow-up: ${conditional.source}.`,
      });
    }

    if (nextNonConditionalRow) {
      branchRuleRows.push({
        id: `${question.id}_to_${nextNonConditionalRow.id}`,
        studyId,
        fromNodeId: question.id,
        toNodeId: nextNonConditionalRow.id,
        conditionType: "ALWAYS",
        priority: 50,
        rationale: "Imported guide fallback when conditions do not match.",
      });
    }
  }

  const study = await prisma.$transaction(async (tx) => {
    const createdStudy = await tx.study.create({
      data: {
        id: studyId,
        slug,
        name: parsed.studyName,
        description: parsed.description,
        status: "ACTIVE",
        config: {
          targetDurationSeconds: parsed.targetDurationSeconds,
          closingReserveSeconds: parsed.closingReserveSeconds,
          maxAttemptsPerQuestion: parsed.maxAttemptsPerQuestion,
          maxOffTopicRedirects: parsed.maxOffTopicRedirects,
          ...(parsed.customGptProjectId
            ? { customGptProjectId: parsed.customGptProjectId }
            : {}),
          importSourceName: parsed.sourceName,
          importWarnings: parsed.warnings,
        } satisfies Prisma.JsonObject,
      },
    });

    if (importedAsset) {
      await tx.studyAsset.create({
        data: {
          id: importedAsset.id,
          studyId: createdStudy.id,
          key: importedAsset.key,
          title: importedAsset.title,
          description: importedAsset.description,
          assetType: importedAsset.assetType,
          storageKey: importedAsset.storageKey,
          mimeType: importedAsset.mimeType,
          metadata: {
            source: "survey-import",
            importSourceName: parsed.sourceName,
            fileName: importedAsset.fileName,
            fileBase64: importedAsset.fileBase64,
          } satisfies Prisma.JsonObject,
          status: "ACTIVE",
          position: 1,
        },
      });
    }

    await tx.studyModule.createMany({
      data: Array.from(moduleByKey.values()).map((module) => ({
        id: module.id,
        studyId: createdStudy.id,
        key: module.key,
        title: module.title,
        position: module.position,
        status: "ACTIVE",
      })),
    });

    await tx.questionNode.createMany({
      data: questionRows.map((question) => ({
        id: question.id,
        studyId: createdStudy.id,
        moduleId:
          moduleByKey.get(question.importQuestion.moduleKey)?.id ?? null,
        key: question.importQuestion.key,
        title: question.importQuestion.title,
        prompt: question.importQuestion.prompt,
        nodeType: question.isTerminal ? "CLOSE" : "OPEN_TEXT",
        isEntry: question.position === 1,
        isTerminal: question.isTerminal,
        position: question.position,
        config: {
          factKeys: question.importQuestion.factKeys,
          mustAsk: question.importQuestion.mustAsk,
          estimatedSeconds: question.importQuestion.estimatedSeconds,
          maxAttempts: Math.min(parsed.maxAttemptsPerQuestion, 1),
          minUsefulWords: 1,
          importSource: "survey_import",
          responseFormat: "long_text",
          requiresGroundedStudyContext:
            question.importQuestion.requiresGroundedStudyContext,
          sourceContextHint: question.importQuestion.sourceContextHint,
          sourceLine: question.importQuestion.sourceLine,
        } satisfies Prisma.JsonObject,
      })),
    });

    await tx.studyAction.createMany({
      data: [
        ...(importedAsset && showAssetActionId
          ? [
              {
                id: showAssetActionId,
                studyId: createdStudy.id,
                moduleId:
                  moduleByKey.get(questionRows[0].importQuestion.moduleKey)
                    ?.id ?? null,
                nodeId: null,
                assetId: importedAsset.id,
                key: `show-${importedAsset.key}`,
                actionType: "SHOW_ASSET" as const,
                goal: `Stage ${importedAsset.title} in the side pane.`,
                mustComplete: true,
                priority: 1,
                config: {
                  displayMode: importedAsset.displayMode,
                } satisfies Prisma.JsonObject,
              },
            ]
          : []),
        ...questionRows.map((question) => ({
          id: question.actionId,
          studyId: createdStudy.id,
          moduleId:
            moduleByKey.get(question.importQuestion.moduleKey)?.id ?? null,
          nodeId: question.id,
          assetId: null,
          key: question.isTerminal
            ? "close-imported-survey"
            : `ask-${question.importQuestion.key}`,
          actionType: question.isTerminal
            ? ("CLOSE" as const)
            : ("ASK_QUESTION" as const),
          goal: question.importQuestion.prompt,
          mustComplete: question.importQuestion.mustAsk,
          priority: question.position + (importedAsset ? 1 : 0),
          config: {} satisfies Prisma.JsonObject,
        })),
      ],
    });

    if (importedAsset && showAssetActionId) {
      await tx.assetStageRule.create({
        data: {
          id: `${studyId}_stage_${slugify(importedAsset.key).slice(0, 36)}`,
          studyId: createdStudy.id,
          assetId: importedAsset.id,
          moduleId:
            moduleByKey.get(questionRows[0].importQuestion.moduleKey)?.id ??
            null,
          triggerActionId: showAssetActionId,
          triggerType: "AFTER_ACTION",
          displayMode: importedAsset.displayMode,
          required: true,
          priority: 1,
          rationale: "Imported side-pane asset for respondent review.",
        },
      });
    }

    if (branchRuleRows.length > 0) {
      await tx.branchRule.createMany({
        data: branchRuleRows,
      });
    }

    if (questionRows.length > 1) {
      await tx.actionRule.createMany({
        data: [
          ...(importedAsset && showAssetActionId
            ? [
                {
                  id: `${showAssetActionId}_to_${questionRows[0].actionId}`,
                  studyId: createdStudy.id,
                  fromActionId: showAssetActionId,
                  toActionId: questionRows[0].actionId,
                  ruleType: "AFTER_ACTION" as const,
                  priority: 1,
                  rationale:
                    "Show imported side-pane asset before the first question.",
                },
              ]
            : []),
          ...questionRows.slice(0, -1).map((question, index) => ({
            id: `${question.actionId}_to_${questionRows[index + 1].actionId}`,
            studyId: createdStudy.id,
            fromActionId: question.actionId,
            toActionId: questionRows[index + 1].actionId,
            ruleType: "ALWAYS" as const,
            priority: 1,
            rationale: "Imported guide order.",
          })),
        ],
      });
    } else if (importedAsset && showAssetActionId) {
      await tx.actionRule.create({
        data: {
          id: `${showAssetActionId}_to_${questionRows[0].actionId}`,
          studyId: createdStudy.id,
          fromActionId: showAssetActionId,
          toActionId: questionRows[0].actionId,
          ruleType: "AFTER_ACTION",
          priority: 1,
          rationale: "Show imported side-pane asset before the first question.",
        },
      });
    }

    return createdStudy;
  });

  const sessionCount = await prisma.session.count({
    where: { studyId: study.id },
  });

  return publishSurveyImportResponseSchema.parse({
    study: {
      id: study.id,
      slug: study.slug,
      name: study.name,
      description: study.description,
      status: study.status,
      sessionCount,
    },
  });
}

export async function getImportedStudyAssetContent(assetId: string) {
  const asset = await prisma.studyAsset.findUnique({
    where: { id: assetId },
  });

  if (!asset) {
    throw new Error(`Asset ${assetId} was not found.`);
  }

  const metadata =
    asset.metadata &&
    typeof asset.metadata === "object" &&
    !Array.isArray(asset.metadata)
      ? (asset.metadata as Prisma.JsonObject)
      : {};
  const fileBase64 = metadata.fileBase64;

  if (typeof fileBase64 !== "string" || fileBase64.length === 0) {
    throw new Error(`Asset ${assetId} does not have imported file content.`);
  }

  return {
    bytes: Buffer.from(fileBase64, "base64"),
    mimeType: asset.mimeType ?? "application/octet-stream",
    fileName:
      typeof metadata.fileName === "string" && metadata.fileName.length > 0
        ? metadata.fileName
        : `${asset.key}`,
  };
}
