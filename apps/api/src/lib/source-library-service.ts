import {
  sourceLibraryBulkImportResponseSchema,
  sourceLibraryListResponseSchema,
  sourceLibraryMutationResponseSchema,
  type CreateSourceLibraryDocument,
  type SourceAssetKind,
  type SourceLibraryBulkImport,
} from "@interview/schemas";
import { prisma } from "./prisma";

import { chunkSourceText } from './source-text-chunks';
export { chunkSourceText } from './source-text-chunks';

type SourceLibraryDocumentRecord = {
  id: string;
  surveySlug: string;
  sourceBrand: string;
  title: string;
  description: string | null;
  sourceType: "URL" | "PDF" | "TEXT" | "MANUAL_NOTE";
  url: string | null;
  content: string | null;
  tags: string[];
  priority: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  createdAt: Date;
  updatedAt: Date;
  _count: {
    chunks: number;
    assets: number;
  };
};

function dbConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function normalizeTags(tags: string[]) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    ),
  );
}

function estimateTokens(value: string) {
  return Math.max(1, Math.ceil(value.length / 4));
}

function normalizeAssetKind(value: string): SourceAssetKind {
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (
    normalized === "CHART" ||
    normalized === "TABLE" ||
    normalized === "PDF" ||
    normalized === "IMAGE" ||
    normalized === "VIDEO" ||
    normalized === "LINK" ||
    normalized === "OTHER"
  ) {
    return normalized;
  }

  if (
    normalized === "FIGURE" ||
    normalized === "FLOWCHART" ||
    normalized === "GRAPH" ||
    normalized === "CLAIM_BLOCK"
  ) {
    return "CHART";
  }

  if (
    normalized === "CHECKLIST" ||
    normalized === "REFERENCE_BLOCK" ||
    normalized === "LABEL_SECTION" ||
    normalized === "PDF_SECTION"
  ) {
    return "TABLE";
  }

  return "OTHER";
}

function mapDocument(document: SourceLibraryDocumentRecord) {
  return {
    id: document.id,
    surveySlug: document.surveySlug,
    sourceBrand: document.sourceBrand,
    title: document.title,
    description: document.description,
    sourceType: document.sourceType,
    url: document.url,
    contentPreview: document.content
      ? document.content.slice(0, 240).trim()
      : null,
    tags: document.tags,
    priority: document.priority,
    status: document.status,
    chunkCount: document._count.chunks,
    assetCount: document._count.assets,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString(),
  };
}

function sourceTextForChunking(input: CreateSourceLibraryDocument) {
  return [
    input.title,
    input.description ?? "",
    input.url ? `Source URL: ${input.url}` : "",
    input.content ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function listSourceLibraryDocuments(surveySlug?: string | null) {
  if (!dbConfigured()) {
    return sourceLibraryListResponseSchema.parse({
      dbConfigured: false,
      generatedAt: new Date().toISOString(),
      documents: [],
    });
  }

  const documents = await prisma.sourceDocument.findMany({
    where: surveySlug ? { surveySlug } : undefined,
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    include: {
      _count: {
        select: {
          chunks: true,
          assets: true,
        },
      },
    },
  });

  return sourceLibraryListResponseSchema.parse({
    dbConfigured: true,
    generatedAt: new Date().toISOString(),
    documents: documents.map(mapDocument),
  });
}

export async function createSourceLibraryDocument(
  input: CreateSourceLibraryDocument,
) {
  if (!dbConfigured()) {
    throw new Error("Source library database is not configured.");
  }

  const tags = normalizeTags(input.tags);
  const sourceText = sourceTextForChunking(input);
  const chunks = chunkSourceText(sourceText);
  const assets = input.assets.map((asset) => ({
    title: asset.title,
    description: asset.description ?? null,
    assetKind: normalizeAssetKind(asset.assetKind),
    url: asset.url,
    tags: normalizeTags(asset.tags),
    priority: asset.priority,
    surveySlug: input.surveySlug,
  }));

  const created = await prisma.sourceDocument.create({
    data: {
      surveySlug: input.surveySlug,
      sourceBrand: input.sourceBrand,
      title: input.title,
      description: input.description ?? null,
      sourceType: input.sourceType,
      url: input.url ?? null,
      content: input.content ?? null,
      tags,
      priority: input.priority,
      status: input.status,
    },
  });

  try {
    if (chunks.length > 0) {
      await prisma.sourceChunk.createMany({
        data: chunks.map((chunk, index) => ({
          sourceDocumentId: created.id,
          surveySlug: input.surveySlug,
          content: chunk,
          tags,
          position: index,
          tokenEstimate: estimateTokens(chunk),
        })),
      });
    }

    if (assets.length > 0) {
      await prisma.sourceAsset.createMany({
        data: assets.map((asset) => ({
          ...asset,
          sourceDocumentId: created.id,
        })),
      });
    }

    const document = await prisma.sourceDocument.findUniqueOrThrow({
      where: {
        id: created.id,
      },
      include: {
        _count: {
          select: {
            chunks: true,
            assets: true,
          },
        },
      },
    });

    return sourceLibraryMutationResponseSchema.parse({
      document: mapDocument(document),
    });
  } catch (error) {
    await prisma.sourceDocument
      .delete({
        where: {
          id: created.id,
        },
      })
      .catch(() => undefined);

    throw error;
  }
}

export async function importSourceLibraryDocuments(
  input: SourceLibraryBulkImport,
) {
  if (!dbConfigured()) {
    throw new Error("Source library database is not configured.");
  }

  if (input.replaceExisting) {
    await prisma.sourceDocument.deleteMany({
      where: {
        surveySlug: input.surveySlug,
      },
    });
  }

  const importedDocuments = [];

  for (const documentInput of input.documents) {
    const normalizedInput: CreateSourceLibraryDocument = {
      ...documentInput,
      surveySlug: documentInput.surveySlug ?? input.surveySlug,
      sourceBrand: documentInput.sourceBrand ?? input.sourceBrand,
    };
    const result = await createSourceLibraryDocument(normalizedInput);
    importedDocuments.push(result.document);
  }

  return sourceLibraryBulkImportResponseSchema.parse({
    dbConfigured: true,
    generatedAt: new Date().toISOString(),
    importedCount: importedDocuments.length,
    documents: importedDocuments,
  });
}
