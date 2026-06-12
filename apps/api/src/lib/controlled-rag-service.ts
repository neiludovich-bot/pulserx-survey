import type { GroundedReference } from "@interview/schemas";
import {
  CONTROLLED_RAG_CHUNKS,
  type ControlledRagChunk,
} from "./controlled-rag-source-packs";
import { getOptionalOpenAIGateway } from "./model-gateway";
import { classifyMvpTurnRoute, type MvpDisplayTopic } from "./mvp-turn-router";
import { prisma } from "./prisma";

type ControlledRagAsset = NonNullable<ControlledRagChunk["assets"]>[number];
type WeightedTokenGroup = {
  tokens: string[];
  weight: number;
};
type DisplayTopic = MvpDisplayTopic;

export type ControlledRagSurveyTurnInput = {
  surveySlug: "brukinsa" | "padcev";
  participantMessage: string;
  surveyContext: string;
  currentQuestion: string | null;
  selectedNextQuestion: string | null;
  selectedQuestionSourceContext: string | null;
  recentInterviewerContext?: string | null;
};

export type ControlledRagSurveyTurnResult = {
  enabled: boolean;
  answer: string | null;
  references: GroundedReference[];
  citationIds: string[];
  conversationId: string | null;
  reason: string | null;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "and",
  "are",
  "ask",
  "asked",
  "before",
  "being",
  "can",
  "could",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "into",
  "material",
  "next",
  "question",
  "source",
  "survey",
  "that",
  "the",
  "their",
  "then",
  "there",
  "this",
  "turn",
  "use",
  "what",
  "when",
  "where",
  "which",
  "with",
  "would",
  "you",
  "your",
]);

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9/+-]+/g, " ")
    .trim();
}

function tokens(value: string) {
  return normalizeText(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
}

function compact(value: string | null | undefined, maxChars: number) {
  if (!value) {
    return "";
  }

  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars - 18).trimEnd()} [truncated]`;
}

function chunkHaystack(chunk: ControlledRagChunk) {
  return normalizeText(
    [chunk.title, chunk.description, chunk.tags.join(" "), chunk.text].join(
      " ",
    ),
  );
}

function chunkTokenSet(chunk: ControlledRagChunk) {
  return new Set(tokens(chunkHaystack(chunk)));
}

function chunkTagTokenSet(chunk: ControlledRagChunk) {
  return new Set(chunk.tags.flatMap((tag) => tokens(tag)));
}

function scoreChunk(
  chunk: ControlledRagChunk,
  queryTokenGroups: WeightedTokenGroup[],
) {
  const haystackTokens = chunkTokenSet(chunk);
  const tagTokens = chunkTagTokenSet(chunk);
  let score = 0;

  for (const group of queryTokenGroups) {
    for (const token of group.tokens) {
      if (!haystackTokens.has(token)) {
        continue;
      }

      score += (tagTokens.has(token) ? 4 : 1) * group.weight;
    }
  }

  return score;
}

function retrievalTokenGroups(input: ControlledRagSurveyTurnInput) {
  return [
    { tokens: tokens(input.participantMessage), weight: 10 },
    { tokens: tokens(input.selectedQuestionSourceContext ?? ""), weight: 3 },
    { tokens: tokens(input.selectedNextQuestion ?? ""), weight: 1 },
    { tokens: tokens(input.currentQuestion ?? ""), weight: 1 },
    { tokens: tokens(input.surveyContext), weight: 1 },
  ].filter((group) => group.tokens.length > 0);
}

function scoreAsset(asset: ControlledRagAsset, queryTokens: string[]) {
  const haystackTokens = new Set(
    tokens(
      [
        asset.title,
        asset.description,
        asset.url,
        asset.assetKind,
        asset.tags.join(" "),
      ].join(" "),
    ),
  );
  const tagTokens = new Set(asset.tags.flatMap((tag) => tokens(tag)));
  const kind = asset.assetKind.toUpperCase();
  let score = asset.priority;

  if (["CHART", "TABLE", "IMAGE"].includes(kind)) {
    score += 90;
  }

  if (kind === "PDF") {
    score += 70;
  }

  for (const token of queryTokens) {
    if (haystackTokens.has(token)) {
      score += tagTokens.has(token) ? 10 : 3;
    }
  }

  if (
    /\b(?:hero|lifestyle|campaign|airplane|aircraft|plane|jet|flight|travel|splash|product shot|pill|tablet|capsule)\b/i.test(
      `${asset.title} ${asset.description ?? ""} ${asset.url}`,
    )
  ) {
    score -= 160;
  }

  return score;
}

function assetSearchText(asset: ControlledRagAsset) {
  return normalizeText(
    [
      asset.title,
      asset.description ?? "",
      asset.url,
      asset.assetKind,
      asset.tags.join(" "),
    ].join(" "),
  );
}

function textMatchesAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function displayTopicForTurn(
  input: ControlledRagSurveyTurnInput,
): DisplayTopic {
  return classifyMvpTurnRoute({
    surveySlug: input.surveySlug,
    participantContent: input.participantMessage,
    currentQuestion: input.currentQuestion,
    selectedQuestionText: input.selectedNextQuestion,
    selectedQuestionSourceContext: input.selectedQuestionSourceContext,
  }).topic;
}

function displayTopicAssetScore(
  asset: ControlledRagAsset,
  topic: DisplayTopic,
) {
  if (!topic) {
    return 0;
  }

  const text = assetSearchText(asset);
  const kind = asset.assetKind.toUpperCase();
  const isVisual = ["CHART", "TABLE", "IMAGE"].includes(kind);
  const isPdf = kind === "PDF" || /\.pdf(?:$|[?#])/i.test(asset.url);
  let score = 0;

  if (isVisual) {
    score += 700;
  }

  if (isPdf) {
    score += 80;
  }

  if (
    textMatchesAny(text, [
      /\b(?:hero|lifestyle|campaign|airplane|aircraft|plane|jet|flight|travel|splash|product shot|pill|tablet|capsule|stays on|stays off|up to 100)\b/,
    ])
  ) {
    score -= 1400;
  }

  if (
    topic === "padcev_ev302_response" &&
    textMatchesAny(text, [
      /\b(?:ev 302|ev302|keynote a39|keynote)\b/,
      /\b(?:ev-302|keynote-a39)\b/,
      /\b(?:orr|overall response|response rate|complete response|partial response|cr|pr|recist)\b/,
    ])
  ) {
    score += 1600;
  }

  if (
    topic === "padcev_ev302_survival" &&
    textMatchesAny(text, [
      /\b(?:ev 302|ev302|keynote a39|keynote)\b/,
      /\b(?:ev-302|keynote-a39)\b/,
      /\b(?:overall survival|survival|os|progression free|progression-free|pfs|hazard ratio|kaplan|km|curve)\b/,
    ])
  ) {
    score += 1600;
  }

  if (
    topic === "padcev_neuropathy_management" &&
    textMatchesAny(text, [
      /\b(?:neuropathy|peripheral neuropathy|\bpn\b|numbness|tingling|muscle weakness)\b/,
      /\b(?:dose modification|dose reduction|withhold|resume|discontinue|monitoring|checklist|patient education|informational resource)\b/,
    ])
  ) {
    score += 1800;
  }

  if (
    topic === "padcev_dose_modification" &&
    textMatchesAny(text, [
      /\b(?:dose modification|dose modifications|dose reduction|dose interruption|withhold|resume|discontinue|recommended dose reduction schedule|dose modifications table)\b/,
    ])
  ) {
    score += 1700;
  }

  if (
    topic === "padcev_safety_resources" &&
    textMatchesAny(text, [
      /\b(?:resource|resources|guide|checklist|monitoring|patient education|counseling|support|adverse reaction management|informational resource)\b/,
    ])
  ) {
    score += 1500;
  }

  if (
    topic === "padcev_safety_management" &&
    textMatchesAny(text, [
      /\b(?:safety|adverse|side effect|toxicity|monitoring|dose modification|neuropathy|rash|skin|hyperglycemia|pneumonitis|ild|ocular|extravasation|checklist|management)\b/,
    ])
  ) {
    score += 1200;
  }

  if (
    topic?.startsWith("padcev_ev302") &&
    textMatchesAny(text, [
      /\b(?:safety|adverse|neuropathy|rash|dose modification|checklist|monitoring|patient education)\b/,
    ])
  ) {
    score -= 500;
  }

  if (
    topic?.startsWith("padcev_safety") ||
    topic === "padcev_neuropathy_management" ||
    topic === "padcev_dose_modification"
  ) {
    if (
      textMatchesAny(text, [
        /\b(?:overall survival|progression free|progression-free|pfs|os|efficacy|ev 302|ev302|keynote|orr|complete response)\b/,
        /\b(?:ev-302|keynote-a39)\b/,
      ])
    ) {
      score -= 450;
    }
  }

  return score;
}

function rankAssetsForDisplay(
  assets: ControlledRagAsset[],
  queryTokens: string[],
  topic: DisplayTopic,
) {
  if (!topic) {
    return rankAssets(assets, queryTokens);
  }

  const seen = new Set<string>();

  return [...assets]
    .map((asset) => {
      const genericScore = scoreAsset(asset, queryTokens);
      const displayScore = displayTopicAssetScore(asset, topic);
      const score = genericScore + displayScore;

      return {
        asset: {
          ...asset,
          priority:
            displayScore > 0
              ? Math.max(asset.priority, Math.round(score))
              : asset.priority,
        },
        score,
      };
    })
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .filter(({ asset }) => {
      if (seen.has(asset.url)) {
        return false;
      }
      seen.add(asset.url);
      return true;
    })
    .slice(0, 8)
    .map(({ asset }) => asset);
}

function rankAssets(assets: ControlledRagAsset[], queryTokens: string[]) {
  const seen = new Set<string>();

  return [...assets]
    .map((asset) => ({ asset, score: scoreAsset(asset, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score)
    .filter(({ asset }) => {
      if (seen.has(asset.url)) {
        return false;
      }
      seen.add(asset.url);
      return true;
    })
    .slice(0, 8)
    .map(({ asset }) => asset);
}

function mergeRankedAssets(
  queryTokens: string[],
  ...assetGroups: Array<ControlledRagAsset[] | undefined>
) {
  return rankAssets(
    assetGroups.flatMap((assets) => assets ?? []),
    queryTokens,
  );
}

function isDisplayVisualAsset(asset: ControlledRagAsset) {
  return ["CHART", "TABLE", "IMAGE"].includes(asset.assetKind);
}

function dedupeAssetsPreservingOrder(
  ...assetGroups: Array<ControlledRagAsset[] | undefined>
) {
  const seen = new Set<string>();
  const deduped: ControlledRagAsset[] = [];

  for (const asset of assetGroups.flatMap((assets) => assets ?? [])) {
    if (seen.has(asset.url)) {
      continue;
    }
    seen.add(asset.url);
    deduped.push(asset);
  }

  return deduped.slice(0, 8);
}

function referenceAssetsForChunk(
  chunkAssets: ControlledRagAsset[] | undefined,
  turnAssets: ControlledRagAsset[],
  queryTokens: string[],
) {
  const ownAssets = rankAssets(chunkAssets ?? [], queryTokens);
  const ownHasVisual = ownAssets.some(isDisplayVisualAsset);
  const turnVisuals = turnAssets.filter(isDisplayVisualAsset);

  if (ownHasVisual) {
    return dedupeAssetsPreservingOrder(ownAssets, turnAssets);
  }

  return dedupeAssetsPreservingOrder(turnVisuals, ownAssets, turnAssets);
}

async function databaseChunks(input: ControlledRagSurveyTurnInput) {
  if (!process.env.DATABASE_URL) {
    return [];
  }

  try {
    const chunks = await prisma.sourceChunk.findMany({
      where: {
        surveySlug: input.surveySlug,
        sourceDocument: {
          status: "ACTIVE",
        },
      },
      orderBy: [{ sourceDocument: { priority: "desc" } }, { position: "asc" }],
      take: 80,
      include: {
        sourceDocument: {
          select: {
            id: true,
            title: true,
            description: true,
            url: true,
            tags: true,
            priority: true,
            assets: {
              where: {
                assetKind: {
                  in: ["CHART", "TABLE", "PDF", "IMAGE", "LINK"],
                },
              },
              orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
              take: 12,
              select: {
                title: true,
                description: true,
                assetKind: true,
                url: true,
                tags: true,
                priority: true,
              },
            },
          },
        },
      },
    });
    const query = [
      input.participantMessage,
      input.selectedNextQuestion,
      input.selectedQuestionSourceContext,
      input.currentQuestion,
    ].join(" ");
    const queryTokens = tokens(query);

    return chunks.map(
      (chunk) =>
        ({
          id: `db:${chunk.id}`,
          surveySlug: input.surveySlug,
          title: chunk.sourceDocument.title,
          description: chunk.sourceDocument.description ?? "",
          url: chunk.sourceDocument.url ?? "",
          tags: Array.from(
            new Set([...chunk.tags, ...chunk.sourceDocument.tags]),
          ),
          text: chunk.content,
          assets: rankAssets(
            chunk.sourceDocument.assets.map((asset) => ({
              ...asset,
              assetKind: asset.assetKind,
            })),
            queryTokens,
          ),
        }) satisfies ControlledRagChunk,
    );
  } catch {
    return [];
  }
}

async function retrieveChunks(input: ControlledRagSurveyTurnInput) {
  const queryTokenGroups = retrievalTokenGroups(input);
  const activeDatabaseChunks = await databaseChunks(input);
  const candidateChunks = [
    ...activeDatabaseChunks,
    ...CONTROLLED_RAG_CHUNKS.filter(
      (chunk) => chunk.surveySlug === input.surveySlug,
    ),
  ];

  return candidateChunks
    .map((chunk) => ({
      chunk,
      score: scoreChunk(chunk, queryTokenGroups),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((match) => match.chunk);
}

async function retrieveTurnAssets(
  input: ControlledRagSurveyTurnInput,
  chunks: ControlledRagChunk[],
) {
  if (!process.env.DATABASE_URL) {
    return [];
  }

  const query = [
    input.participantMessage,
    input.selectedNextQuestion,
    input.selectedQuestionSourceContext,
    input.currentQuestion,
    chunks.map((chunk) => `${chunk.title} ${chunk.tags.join(" ")}`).join(" "),
  ].join(" ");
  const queryTokens = tokens(query);
  const displayTopic = displayTopicForTurn(input);

  try {
    const assets = await prisma.sourceAsset.findMany({
      where: {
        surveySlug: input.surveySlug,
        sourceDocument: {
          status: "ACTIVE",
        },
      },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 120,
      select: {
        title: true,
        description: true,
        assetKind: true,
        url: true,
        tags: true,
        priority: true,
        sourceDocument: {
          select: {
            title: true,
            description: true,
            url: true,
            tags: true,
          },
        },
      },
    });

    const mappedAssets = assets.map((asset) => ({
      title: asset.title,
      description: [
        asset.description,
        asset.sourceDocument.description,
        asset.sourceDocument.title,
      ]
        .filter(Boolean)
        .join(" "),
      assetKind: asset.assetKind,
      url: asset.url,
      tags: Array.from(
        new Set([
          ...asset.tags,
          ...asset.sourceDocument.tags,
          asset.sourceDocument.title,
        ]),
      ),
      priority: asset.priority,
    }));

    return rankAssetsForDisplay(mappedAssets, queryTokens, displayTopic);
  } catch {
    return [];
  }
}

function referencesForChunks(
  chunks: ControlledRagChunk[],
  turnAssets: ControlledRagAsset[],
  queryTokens: string[],
) {
  return chunks.map(
    (chunk, index) =>
      ({
        citationId: `rag:${chunk.id}`,
        title: chunk.title,
        url: chunk.url,
        description: chunk.description,
        assets:
          index === 0
            ? mergeRankedAssets(queryTokens, chunk.assets, turnAssets)
            : referenceAssetsForChunk(chunk.assets, turnAssets, queryTokens),
      }) satisfies GroundedReference,
  );
}

function sourceSummary(chunks: ControlledRagChunk[]) {
  return chunks
    .map((chunk, index) => {
      const marker = `[${index + 1}]`;
      return `${chunk.text} ${marker}`;
    })
    .join("\n\n");
}

function selectedQuestionLead(question: string | null) {
  return question
    ? `\n\n${question}`
    : "\n\nThank you for participating. Your feedback has been recorded, and we can close the interview here.";
}

function fallbackSourceAnswer(
  input: ControlledRagSurveyTurnInput,
  chunks: ControlledRagChunk[],
) {
  const contextNote = input.selectedQuestionSourceContext
    ? `Relevant source need: ${compact(input.selectedQuestionSourceContext, 260)}\n\n`
    : "";
  const alreadyCovered = input.recentInterviewerContext
    ? `Previously covered context was considered, so this answer focuses on the current angle.\n\n`
    : "";

  return [contextNote, alreadyCovered, sourceSummary(chunks)].join("").trim();
}

function ensureCitationMarker(answer: string, chunks: ControlledRagChunk[]) {
  if (/\[\d+\]/.test(answer) || chunks.length === 0) {
    return answer;
  }

  return `${answer.trimEnd()} [1]`;
}

function lowerFirstPlainWord(value: string) {
  return value.replace(/^([A-Z])(?=[a-z])/, (letter) =>
    letter.toLowerCase(),
  );
}

function removeParticipantVoiceMirror(answer: string) {
  const leadingFamiliarityMirror =
    /^\s*I(?:'m| am)\s+(?:not\s+)?(?:very\s+)?familiar(?:\s+with\s+[^.]+)?\.\s*/i;
  const match = answer.match(leadingFamiliarityMirror);

  if (!match) {
    return answer;
  }

  const rest = answer.slice(match[0].length).trimStart();
  if (!rest) {
    return "For orientation, the source materials provide the following context.";
  }

  return `For orientation, ${lowerFirstPlainWord(rest)}`;
}

async function composeSourceAnswer(
  input: ControlledRagSurveyTurnInput,
  chunks: ControlledRagChunk[],
) {
  const gateway = getOptionalOpenAIGateway();

  if (!gateway || process.env.NODE_ENV === "test") {
    return fallbackSourceAnswer(input, chunks);
  }

  try {
    const composition = await gateway.composeControlledRagAnswer({
      surveySlug: input.surveySlug,
      participantMessage: input.participantMessage,
      surveyContext: input.surveyContext,
      currentQuestion: input.currentQuestion,
      selectedNextQuestion: input.selectedNextQuestion,
      selectedQuestionSourceContext: input.selectedQuestionSourceContext,
      recentInterviewerContext: input.recentInterviewerContext ?? null,
      sources: chunks.map((chunk, index) => ({
        index: index + 1,
        title: chunk.title,
        url: chunk.url,
        description: chunk.description,
        tags: chunk.tags,
        text: compact(chunk.text, 1500),
      })),
    });

    return ensureCitationMarker(
      removeParticipantVoiceMirror(composition.result.answerBody),
      chunks,
    );
  } catch {
    return fallbackSourceAnswer(input, chunks);
  }
}

export async function askControlledRagForSurveyInterviewerTurn(
  input: ControlledRagSurveyTurnInput,
): Promise<ControlledRagSurveyTurnResult> {
  const chunks = await retrieveChunks(input);
  const queryTokens = tokens(
    [
      input.participantMessage,
      input.selectedNextQuestion,
      input.selectedQuestionSourceContext,
      input.currentQuestion,
    ].join(" "),
  );

  if (chunks.length === 0) {
    return {
      enabled: false,
      answer: null,
      references: [],
      citationIds: [],
      conversationId: null,
      reason:
        "Controlled RAG did not retrieve a matching curated source chunk.",
    };
  }

  const turnAssets = await retrieveTurnAssets(input, chunks);
  const references = referencesForChunks(chunks, turnAssets, queryTokens);
  const composedAnswer = await composeSourceAnswer(input, chunks);
  const answer = [
    composedAnswer,
    selectedQuestionLead(input.selectedNextQuestion),
  ]
    .join("")
    .trim();

  return {
    enabled: true,
    answer,
    references,
    citationIds: references.map((reference) => reference.citationId),
    conversationId: null,
    reason: null,
  };
}

export const controlledRagTestInternals = {
  displayTopicForTurn,
  rankAssetsForDisplay,
  referencesForChunks,
  removeParticipantVoiceMirror,
};
