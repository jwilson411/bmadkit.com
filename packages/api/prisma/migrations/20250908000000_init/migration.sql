-- CreateEnum
CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'EMAIL_CAPTURED', 'PREMIUM');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "AgentType" AS ENUM ('ANALYST', 'PM', 'UX_EXPERT', 'ARCHITECT', 'USER');

-- CreateEnum
CREATE TYPE "ExecutionStatus" AS ENUM ('PENDING', 'EXECUTING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LLMProvider" AS ENUM ('OPENAI', 'ANTHROPIC');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('PROJECT_BRIEF', 'PRD', 'ARCHITECTURE', 'USER_STORIES');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'GENERATING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('SUCCESS', 'FAILED', 'TIMEOUT');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "subscription_tier" "SubscriptionTier" NOT NULL DEFAULT 'FREE',
    "stripe_customer_id" TEXT,
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planning_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_agent" "AgentType" NOT NULL DEFAULT 'ANALYST',
    "project_input" TEXT NOT NULL,
    "session_data" JSONB NOT NULL DEFAULT '{}',
    "progress_percentage" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '48 hours'),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "planning_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "agent_type" "AgentType" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "sequence_number" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_executions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "agent_type" "AgentType" NOT NULL,
    "status" "ExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "input_context" JSONB NOT NULL DEFAULT '{}',
    "output_data" JSONB NOT NULL DEFAULT '{}',
    "llm_provider" "LLMProvider",
    "token_usage" INTEGER NOT NULL DEFAULT 0,
    "execution_time_ms" INTEGER,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "agent_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "export_formats" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_requests" (
    "id" TEXT NOT NULL,
    "agent_execution_id" TEXT,
    "provider" "LLMProvider" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "response" TEXT,
    "token_count_input" INTEGER NOT NULL DEFAULT 0,
    "token_count_output" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "response_time_ms" INTEGER,
    "status" "RequestStatus" NOT NULL DEFAULT 'SUCCESS',
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_subscription_tier_idx" ON "users"("subscription_tier");

-- CreateIndex
CREATE INDEX "planning_sessions_user_id_idx" ON "planning_sessions"("user_id");

-- CreateIndex
CREATE INDEX "planning_sessions_status_idx" ON "planning_sessions"("status");

-- CreateIndex
CREATE INDEX "planning_sessions_expires_at_idx" ON "planning_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_messages_session_id_sequence_number_key" ON "conversation_messages"("session_id", "sequence_number");

-- CreateIndex
CREATE INDEX "conversation_messages_session_id_idx" ON "conversation_messages"("session_id");

-- CreateIndex
CREATE INDEX "agent_executions_session_id_idx" ON "agent_executions"("session_id");

-- CreateIndex
CREATE INDEX "agent_executions_status_idx" ON "agent_executions"("status");

-- CreateIndex
CREATE INDEX "agent_executions_llm_provider_idx" ON "agent_executions"("llm_provider");

-- CreateIndex
CREATE UNIQUE INDEX "documents_session_id_document_type_version_key" ON "documents"("session_id", "document_type", "version");

-- CreateIndex
CREATE INDEX "documents_session_id_idx" ON "documents"("session_id");

-- CreateIndex
CREATE INDEX "documents_document_type_idx" ON "documents"("document_type");

-- CreateIndex
CREATE INDEX "llm_requests_provider_idx" ON "llm_requests"("provider");

-- CreateIndex
CREATE INDEX "llm_requests_created_at_idx" ON "llm_requests"("created_at");

-- CreateIndex
CREATE INDEX "llm_requests_agent_execution_id_idx" ON "llm_requests"("agent_execution_id");

-- AddForeignKey
ALTER TABLE "planning_sessions" ADD CONSTRAINT "planning_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "planning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_executions" ADD CONSTRAINT "agent_executions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "planning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "planning_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_requests" ADD CONSTRAINT "llm_requests_agent_execution_id_fkey" FOREIGN KEY ("agent_execution_id") REFERENCES "agent_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;