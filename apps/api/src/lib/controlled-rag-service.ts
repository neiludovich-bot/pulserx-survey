import type { GroundedReference } from "@interview/schemas";
import {
  CONTROLLED_RAG_CHUNKS,
  type ControlledRagChunk,
} from "./controlled-rag-source-packs";
import { prisma } from "./prisma";

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

function scoreChunk(chunk: ControlledRagChunk, queryTokens: string[]) {
  const haystackTokens = chunkTokenSet(chunk);
  const tagTokens = chunkTagTokenSet(chunk);
  let score = 0;

  for (const token of queryTokens) {
    if (!haystackTokens.has(token)) {
      continue;
    }

    score += tagTokens.has(token) ? 4 : 1;
  }

  return score;
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
          },
        },
      },
    });

    return chunks.map(
      (chunk) =>
        ({
          id: `db:${chunk.id}`,
          surveySlug: input.surveySlug,
          title: chunk.sourceDocument.title,
          description: chunk.sourceDocument.description,
          url: chunk.sourceDocument.url,
          tags: Array.from(
            new Set([...chunk.tags, ...chunk.sourceDocument.tags]),
          ),
          text: chunk.content,
        }) satisfies ControlledRagChunk,
    );
  } catch {
    return [];
  }
}

async function retrieveChunks(input: ControlledRagSurveyTurnInput) {
  const query = [
    input.participantMessage,
    input.selectedNextQuestion,
    input.selectedQuestionSourceContext,
    input.currentQuestion,
  ].join(" ");
  const queryTokens = tokens(query);
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
      score: scoreChunk(chunk, queryTokens),
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 4)
    .map((match) => match.chunk);
}

function referencesForChunks(chunks: ControlledRagChunk[]) {
  return chunks.map(
    (chunk, index) =>
      ({
        citationId: `rag:${chunk.id}`,
        title: chunk.title,
        url: chunk.url,
        description: chunk.description,
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

export async function askControlledRagForSurveyInterviewerTurn(
  input: ControlledRagSurveyTurnInput,
): Promise<ControlledRagSurveyTurnResult> {
  const chunks = await retrieveChunks(input);

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

  const references = referencesForChunks(chunks);
  const contextNote = input.selectedQuestionSourceContext
    ? `Relevant source need: ${compact(input.selectedQuestionSourceContext, 260)}\n\n`
    : "";
  const alreadyCovered = input.recentInterviewerContext
    ? `Previously covered context was considered, so this answer focuses on the current angle.\n\n`
    : "";
  const answer = [
    contextNote,
    alreadyCovered,
    sourceSummary(chunks),
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
