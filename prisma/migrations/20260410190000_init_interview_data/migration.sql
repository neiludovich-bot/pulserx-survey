CREATE TYPE "StudyStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "ModuleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');
CREATE TYPE "QuestionNodeType" AS ENUM ('OPEN_TEXT', 'SINGLE_SELECT', 'MULTI_SELECT', 'NUMERIC', 'REFLECT', 'CLOSE');
CREATE TYPE "BranchConditionType" AS ENUM ('ALWAYS', 'ANSWER_EQUALS', 'ANSWER_CONTAINS', 'SCORE_GTE', 'SCORE_LTE');
CREATE TYPE "RespondentStatus" AS ENUM ('ACTIVE', 'OPTED_OUT', 'ARCHIVED');
CREATE TYPE "SessionChannel" AS ENUM ('BROWSER_CHAT');
CREATE TYPE "SessionStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'ABANDONED');
CREATE TYPE "TurnRole" AS ENUM ('SYSTEM', 'INTERVIEWER', 'PARTICIPANT');
CREATE TYPE "AnalysisKind" AS ENUM ('ANSWER_EXTRACTION', 'SUMMARY', 'SENTIMENT', 'QUALITY_CHECK');
CREATE TYPE "AnalysisStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "DecisionKind" AS ENUM ('SELECT_NEXT_QUESTION', 'PHRASE_QUESTION', 'CLOSE_SESSION');
CREATE TYPE "DecisionStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "ArtifactType" AS ENUM ('TRANSCRIPT_SNAPSHOT', 'MODEL_INPUT', 'MODEL_OUTPUT', 'EVAL_REPORT', 'EXPORT');
CREATE TYPE "EvalCaseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "EvalRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'PASSED', 'FAILED');

CREATE TABLE "studies" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "StudyStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "studies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_modules" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ModuleStatus" NOT NULL DEFAULT 'DRAFT',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "study_modules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "question_nodes" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "module_id" TEXT,
    "key" TEXT NOT NULL,
    "node_type" "QuestionNodeType" NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "help_text" TEXT,
    "config" JSONB,
    "is_entry" BOOLEAN NOT NULL DEFAULT false,
    "is_terminal" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "branch_rules" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "from_node_id" TEXT NOT NULL,
    "to_node_id" TEXT NOT NULL,
    "condition_type" "BranchConditionType" NOT NULL DEFAULT 'ALWAYS',
    "fact_key" TEXT,
    "comparison_value" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "respondents" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "external_ref" TEXT,
    "status" "RespondentStatus" NOT NULL DEFAULT 'ACTIVE',
    "profile" JSONB,
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "respondents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "respondent_id" TEXT,
    "channel" "SessionChannel" NOT NULL DEFAULT 'BROWSER_CHAT',
    "status" "SessionStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "turns" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "node_id" TEXT,
    "sequence" INTEGER NOT NULL,
    "role" "TurnRole" NOT NULL,
    "content" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analyses" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_id" TEXT,
    "kind" "AnalysisKind" NOT NULL,
    "status" "AnalysisStatus" NOT NULL DEFAULT 'PENDING',
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "input" JSONB,
    "output" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analyses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "turn_id" TEXT,
    "from_node_id" TEXT,
    "selected_node_id" TEXT,
    "kind" "DecisionKind" NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'PENDING',
    "rationale" TEXT,
    "input" JSONB,
    "output" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "session_id" TEXT,
    "turn_id" TEXT,
    "type" "ArtifactType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eval_cases" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "EvalCaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "input" JSONB NOT NULL,
    "expected" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "eval_runs" (
    "id" TEXT NOT NULL,
    "study_id" TEXT NOT NULL,
    "eval_case_id" TEXT,
    "status" "EvalRunStatus" NOT NULL DEFAULT 'QUEUED',
    "score" DOUBLE PRECISION,
    "summary" JSONB,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "eval_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "studies_slug_key" ON "studies"("slug");
CREATE UNIQUE INDEX "study_modules_study_id_key_key" ON "study_modules"("study_id", "key");
CREATE UNIQUE INDEX "question_nodes_study_id_key_key" ON "question_nodes"("study_id", "key");
CREATE UNIQUE INDEX "respondents_study_id_external_ref_key" ON "respondents"("study_id", "external_ref");
CREATE UNIQUE INDEX "turns_session_id_sequence_key" ON "turns"("session_id", "sequence");
CREATE UNIQUE INDEX "eval_cases_study_id_key_key" ON "eval_cases"("study_id", "key");

CREATE INDEX "study_modules_study_id_idx" ON "study_modules"("study_id");
CREATE INDEX "question_nodes_study_id_idx" ON "question_nodes"("study_id");
CREATE INDEX "question_nodes_module_id_idx" ON "question_nodes"("module_id");
CREATE INDEX "branch_rules_study_id_idx" ON "branch_rules"("study_id");
CREATE INDEX "branch_rules_from_node_id_idx" ON "branch_rules"("from_node_id");
CREATE INDEX "branch_rules_to_node_id_idx" ON "branch_rules"("to_node_id");
CREATE INDEX "respondents_study_id_idx" ON "respondents"("study_id");
CREATE INDEX "sessions_study_id_idx" ON "sessions"("study_id");
CREATE INDEX "sessions_respondent_id_idx" ON "sessions"("respondent_id");
CREATE INDEX "turns_study_id_idx" ON "turns"("study_id");
CREATE INDEX "turns_session_id_idx" ON "turns"("session_id");
CREATE INDEX "turns_node_id_idx" ON "turns"("node_id");
CREATE INDEX "analyses_study_id_idx" ON "analyses"("study_id");
CREATE INDEX "analyses_session_id_idx" ON "analyses"("session_id");
CREATE INDEX "analyses_turn_id_idx" ON "analyses"("turn_id");
CREATE INDEX "decisions_study_id_idx" ON "decisions"("study_id");
CREATE INDEX "decisions_session_id_idx" ON "decisions"("session_id");
CREATE INDEX "decisions_turn_id_idx" ON "decisions"("turn_id");
CREATE INDEX "decisions_from_node_id_idx" ON "decisions"("from_node_id");
CREATE INDEX "decisions_selected_node_id_idx" ON "decisions"("selected_node_id");
CREATE INDEX "artifacts_study_id_idx" ON "artifacts"("study_id");
CREATE INDEX "artifacts_session_id_idx" ON "artifacts"("session_id");
CREATE INDEX "artifacts_turn_id_idx" ON "artifacts"("turn_id");
CREATE INDEX "eval_cases_study_id_idx" ON "eval_cases"("study_id");
CREATE INDEX "eval_runs_study_id_idx" ON "eval_runs"("study_id");
CREATE INDEX "eval_runs_eval_case_id_idx" ON "eval_runs"("eval_case_id");

ALTER TABLE "study_modules"
    ADD CONSTRAINT "study_modules_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "question_nodes"
    ADD CONSTRAINT "question_nodes_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "question_nodes"
    ADD CONSTRAINT "question_nodes_module_id_fkey"
    FOREIGN KEY ("module_id") REFERENCES "study_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "branch_rules"
    ADD CONSTRAINT "branch_rules_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "branch_rules"
    ADD CONSTRAINT "branch_rules_from_node_id_fkey"
    FOREIGN KEY ("from_node_id") REFERENCES "question_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "branch_rules"
    ADD CONSTRAINT "branch_rules_to_node_id_fkey"
    FOREIGN KEY ("to_node_id") REFERENCES "question_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "respondents"
    ADD CONSTRAINT "respondents_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "sessions"
    ADD CONSTRAINT "sessions_respondent_id_fkey"
    FOREIGN KEY ("respondent_id") REFERENCES "respondents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "turns"
    ADD CONSTRAINT "turns_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "turns"
    ADD CONSTRAINT "turns_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "turns"
    ADD CONSTRAINT "turns_node_id_fkey"
    FOREIGN KEY ("node_id") REFERENCES "question_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "analyses"
    ADD CONSTRAINT "analyses_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "analyses"
    ADD CONSTRAINT "analyses_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "analyses"
    ADD CONSTRAINT "analyses_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decisions"
    ADD CONSTRAINT "decisions_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decisions"
    ADD CONSTRAINT "decisions_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "decisions"
    ADD CONSTRAINT "decisions_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decisions"
    ADD CONSTRAINT "decisions_from_node_id_fkey"
    FOREIGN KEY ("from_node_id") REFERENCES "question_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "decisions"
    ADD CONSTRAINT "decisions_selected_node_id_fkey"
    FOREIGN KEY ("selected_node_id") REFERENCES "question_nodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "artifacts"
    ADD CONSTRAINT "artifacts_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artifacts"
    ADD CONSTRAINT "artifacts_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "artifacts"
    ADD CONSTRAINT "artifacts_turn_id_fkey"
    FOREIGN KEY ("turn_id") REFERENCES "turns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "eval_cases"
    ADD CONSTRAINT "eval_cases_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eval_runs"
    ADD CONSTRAINT "eval_runs_study_id_fkey"
    FOREIGN KEY ("study_id") REFERENCES "studies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "eval_runs"
    ADD CONSTRAINT "eval_runs_eval_case_id_fkey"
    FOREIGN KEY ("eval_case_id") REFERENCES "eval_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
