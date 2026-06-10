-- CreateEnum
CREATE TYPE "SourceDocumentType" AS ENUM ('URL', 'PDF', 'TEXT', 'MANUAL_NOTE');

-- CreateEnum
CREATE TYPE "SourceDocumentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceAssetKind" AS ENUM ('CHART', 'TABLE', 'PDF', 'IMAGE', 'VIDEO', 'LINK', 'OTHER');

-- CreateTable
CREATE TABLE "source_documents" (
    "id" TEXT NOT NULL,
    "survey_slug" TEXT NOT NULL,
    "source_brand" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source_type" "SourceDocumentType" NOT NULL,
    "url" TEXT,
    "content" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "SourceDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_chunks" (
    "id" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "survey_slug" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "token_estimate" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_assets" (
    "id" TEXT NOT NULL,
    "source_document_id" TEXT NOT NULL,
    "survey_slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "asset_kind" "SourceAssetKind" NOT NULL,
    "url" TEXT NOT NULL,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "priority" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_documents_survey_slug_idx" ON "source_documents"("survey_slug");

-- CreateIndex
CREATE INDEX "source_documents_source_brand_idx" ON "source_documents"("source_brand");

-- CreateIndex
CREATE INDEX "source_documents_status_idx" ON "source_documents"("status");

-- CreateIndex
CREATE INDEX "source_chunks_source_document_id_idx" ON "source_chunks"("source_document_id");

-- CreateIndex
CREATE INDEX "source_chunks_survey_slug_idx" ON "source_chunks"("survey_slug");

-- CreateIndex
CREATE INDEX "source_assets_source_document_id_idx" ON "source_assets"("source_document_id");

-- CreateIndex
CREATE INDEX "source_assets_survey_slug_idx" ON "source_assets"("survey_slug");

-- CreateIndex
CREATE INDEX "source_assets_asset_kind_idx" ON "source_assets"("asset_kind");

-- AddForeignKey
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_assets" ADD CONSTRAINT "source_assets_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
