CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "StudyAssetType" AS ENUM ('PDF', 'SLIDE_DECK', 'IMAGE', 'PI_LABEL', 'VIDEO', 'TEXT');
CREATE TYPE "StudyActionType" AS ENUM ('ASK_QUESTION', 'SHOW_ASSET', 'ASK_ASSET_REACTION', 'PROBE', 'REDIRECT', 'CLOSE');
CREATE TYPE "ActionRuleType" AS ENUM ('ALWAYS', 'AFTER_ACTION', 'IF_FACT_PRESENT', 'IF_FACT_EQUALS', 'IF_CONTRADICTION', 'IF_OFF_TOPIC', 'IF_ASSET_SHOWN');
CREATE TYPE "AssetDisplayMode" AS ENUM ('INLINE_PANE', 'MODAL', 'FULLSCREEN', 'DOWNLOAD_LINK');
CREATE TYPE "AssetStageTriggerType" AS ENUM ('AFTER_ACTION', 'ON_MODULE_ENTRY', 'BEFORE_CLOSE', 'IF_FACT_PRESENT');
CREATE TYPE "CandidateActionReasonCode" AS ENUM ('ENTRY', 'MUST_ASK', 'BRANCH_PRIORITY', 'ASSET_STAGE', 'CONTRADICTION', 'OFF_TOPIC_REDIRECT', 'MODEL_RECOMMENDATION', 'RESEARCHER_OVERRIDE');
CREATE TYPE "AssetReactionKind" AS ENUM ('COMPREHENSION', 'APPEAL', 'CONCERN', 'OBJECTION', 'COMPARISON', 'OPEN_FEEDBACK');
CREATE TYPE "AssetReactionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

CREATE TABLE "study_assets" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "asset_type" "StudyAssetType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "metadata" JSONB,
    "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_actions" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "module_id" TEXT,
    "node_id" TEXT,
    "asset_id" TEXT,
    "key" TEXT NOT NULL,
    "action_type" "StudyActionType" NOT NULL,
    "goal" TEXT,
    "must_complete" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "action_rules" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "from_action_id" TEXT,
    "to_action_id" TEXT NOT NULL,
    "rule_type" "ActionRuleType" NOT NULL DEFAULT 'ALWAYS',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "condition_json" JSONB,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "action_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_stage_rules" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "module_id" TEXT,
    "trigger_action_id" TEXT,
    "trigger_type" "AssetStageTriggerType" NOT NULL,
    "display_mode" "AssetDisplayMode" NOT NULL DEFAULT 'INLINE_PANE',
    "required" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "condition_json" JSONB,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_stage_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "candidate_actions" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_id" TEXT,
    "study_action_id" TEXT,
    "node_id" TEXT,
    "asset_id" TEXT,
    "action_type" "StudyActionType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "allowed" BOOLEAN NOT NULL DEFAULT true,
    "reason_code" "CandidateActionReasonCode" NOT NULL,
    "input" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "candidate_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_assets" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "source_action_id" TEXT,
    "turn_id" TEXT,
    "display_mode" "AssetDisplayMode",
    "shown_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "exposure_metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "session_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "asset_reactions" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_id" TEXT,
    "asset_id" TEXT NOT NULL,
    "kind" "AssetReactionKind" NOT NULL,
    "status" "AssetReactionStatus" NOT NULL DEFAULT 'PENDING',
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB,
    "output" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "asset_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "study_assets_study_id_key_key" ON "study_assets"("study_id", "key");
CREATE UNIQUE INDEX "study_actions_study_id_key_key" ON "study_actions"("study_id", "key");

CREATE INDEX "study_assets_study_id_idx" ON "study_assets"("study_id");
CREATE INDEX "study_actions_study_id_idx" ON "study_actions"("study_id");
CREATE INDEX "study_actions_module_id_idx" ON "study_actions"("module_id");
CREATE INDEX "study_actions_node_id_idx" ON "study_actions"("node_id");
CREATE INDEX "study_actions_asset_id_idx" ON "study_actions"("asset_id");
CREATE INDEX "action_rules_study_id_idx" ON "action_rules"("study_id");
CREATE INDEX "action_rules_from_action_id_idx" ON "action_rules"("from_action_id");
CREATE INDEX "action_rules_to_action_id_idx" ON "action_rules"("to_action_id");
CREATE INDEX "asset_stage_rules_study_id_idx" ON "asset_stage_rules"("study_id");
CREATE INDEX "asset_stage_rules_asset_id_idx" ON "asset_stage_rules"("asset_id");
CREATE INDEX "asset_stage_rules_module_id_idx" ON "asset_stage_rules"("module_id");
CREATE INDEX "asset_stage_rules_trigger_action_id_idx" ON "asset_stage_rules"("trigger_action_id");
CREATE INDEX "candidate_actions_study_id_idx" ON "candidate_actions"("study_id");
CREATE INDEX "candidate_actions_session_id_idx" ON "candidate_actions"("session_id");
CREATE INDEX "candidate_actions_turn_id_idx" ON "candidate_actions"("turn_id");
CREATE INDEX "candidate_actions_study_action_id_idx" ON "candidate_actions"("study_action_id");
CREATE INDEX "candidate_actions_node_id_idx" ON "candidate_actions"("node_id");
CREATE INDEX "candidate_actions_asset_id_idx" ON "candidate_actions"("asset_id");
CREATE INDEX "session_assets_study_id_idx" ON "session_assets"("study_id");
CREATE INDEX "session_assets_session_id_idx" ON "session_assets"("session_id");
CREATE INDEX "session_assets_asset_id_idx" ON "session_assets"("asset_id");
CREATE INDEX "session_assets_source_action_id_idx" ON "session_assets"("source_action_id");
CREATE INDEX "session_assets_turn_id_idx" ON "session_assets"("turn_id");
CREATE INDEX "asset_reactions_study_id_idx" ON "asset_reactions"("study_id");
CREATE INDEX "asset_reactions_session_id_idx" ON "asset_reactions"("session_id");
CREATE INDEX "asset_reactions_turn_id_idx" ON "asset_reactions"("turn_id");
CREATE INDEX "asset_reactions_asset_id_idx" ON "asset_reactions"("asset_id");

ALTER TABLE "study_assets"
ADD CONSTRAINT "study_assets_study_id_fkey"
FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "study_actions"
ADD CONSTRAINT "study_actions_study_id_fkey"
FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "study_actions"
ADD CONSTRAINT "study_actions_module_id_fkey"
FOREIGN KEY ("module_id") REFERENCES "study_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "study_actions"
ADD CONSTRAINT "study_actions_node_id_fkey"
FOREIGN KEY ("node_id") REFERENCES "question_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "study_actions"
ADD CONSTRAINT "study_actions_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "study_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "action_rules"
ADD CONSTRAINT "action_rules_study_id_fkey"
FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "action_rules"
ADD CONSTRAINT "action_rules_from_action_id_fkey"
FOREIGN KEY ("from_action_id") REFERENCES "study_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "action_rules"
ADD CONSTRAINT "action_rules_to_action_id_fkey"
FOREIGN KEY ("to_action_id") REFERENCES "study_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_stage_rules"
ADD CONSTRAINT "asset_stage_rules_study_id_fkey"
FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_stage_rules"
ADD CONSTRAINT "asset_stage_rules_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "study_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_stage_rules"
ADD CONSTRAINT "asset_stage_rules_module_id_fkey"
FOREIGN KEY ("module_id") REFERENCES "study_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_stage_rules"
ADD CONSTRAINT "asset_stage_rules_trigger_action_id_fkey"
FOREIGN KEY ("trigger_action_id") REFERENCES "study_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidate_actions"
ADD CONSTRAINT "candidate_actions_study_id_fkey"
FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidate_actions"
ADD CONSTRAINT "candidate_actions_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "candidate_actions"
ADD CONSTRAINT "candidate_actions_turn_id_fkey"
FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidate_actions"
ADD CONSTRAINT "candidate_actions_study_action_id_fkey"
FOREIGN KEY ("study_action_id") REFERENCES "study_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidate_actions"
ADD CONSTRAINT "candidate_actions_node_id_fkey"
FOREIGN KEY ("node_id") REFERENCES "question_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "candidate_actions"
ADD CONSTRAINT "candidate_actions_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "study_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_assets"
ADD CONSTRAINT "session_assets_study_id_fkey"
FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_assets"
ADD CONSTRAINT "session_assets_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_assets"
ADD CONSTRAINT "session_assets_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "study_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "session_assets"
ADD CONSTRAINT "session_assets_source_action_id_fkey"
FOREIGN KEY ("source_action_id") REFERENCES "study_actions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "session_assets"
ADD CONSTRAINT "session_assets_turn_id_fkey"
FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_reactions"
ADD CONSTRAINT "asset_reactions_study_id_fkey"
FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_reactions"
ADD CONSTRAINT "asset_reactions_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "asset_reactions"
ADD CONSTRAINT "asset_reactions_turn_id_fkey"
FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "asset_reactions"
ADD CONSTRAINT "asset_reactions_asset_id_fkey"
FOREIGN KEY ("asset_id") REFERENCES "study_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
