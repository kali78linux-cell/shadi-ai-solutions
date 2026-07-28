-- Migration: Schema Reconciliation
-- Purpose: Reconcile database schema with existing TypeScript types and services.
-- This migration is idempotent and can be safely re-run.
-- It does NOT delete or modify existing migrations.

-- =====================================================
-- 1. Ensure enum types exist
-- =====================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_status') THEN
    CREATE TYPE conversation_status AS ENUM ('open', 'awaiting_human', 'closed');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_message_role') THEN
    CREATE TYPE ai_message_role AS ENUM ('patient', 'assistant', 'staff', 'system');
  END IF;
END $$;

-- =====================================================
-- 2. Fix conversations table
--    Problem: db/migrations/20260722_ai_core_schema.sql uses CREATE TABLE IF NOT EXISTS
--    which is a no-op for existing tables. This migration properly ALTERs the table.
-- =====================================================

-- Change status column type from text to conversation_status enum
-- Map old 'active' value to 'open'
DO $$ BEGIN
  IF (SELECT column_default IS NOT NULL FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'status') THEN
    ALTER TABLE public.conversations ALTER COLUMN status DROP DEFAULT;
  END IF;
END $$;

DO $$ BEGIN
  IF (SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'status') != 'conversation_status' THEN
    ALTER TABLE public.conversations ALTER COLUMN status TYPE conversation_status
      USING (CASE
        WHEN status = 'active' THEN 'open'::conversation_status
        ELSE status::text::conversation_status
      END);
  END IF;
END $$;

ALTER TABLE public.conversations ALTER COLUMN status SET DEFAULT 'open';

-- Add missing columns
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

-- =====================================================
-- 3. Fix messages table
--    Problem: Same CREATE TABLE IF NOT EXISTS issue.
--    Also: old CHECK constraint allows 'user' but code inserts 'patient'.
-- =====================================================

-- Drop old CHECK constraint on role
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_role_check;

-- Change role column type from text to ai_message_role enum
-- Safely map old values: 'user' -> 'patient' (since 'user' is not in the enum)
DO $$ BEGIN
  IF (SELECT udt_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'role') != 'ai_message_role' THEN
    ALTER TABLE public.messages ALTER COLUMN role TYPE ai_message_role
      USING (CASE
        WHEN role = 'user' THEN 'patient'::ai_message_role
        WHEN role = 'assistant' THEN 'assistant'::ai_message_role
        WHEN role = 'system' THEN 'system'::ai_message_role
        ELSE role::text::ai_message_role
      END);
  END IF;
END $$;

-- Add missing columns
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS clinic_id uuid,
  ADD COLUMN IF NOT EXISTS sender_id uuid,
  ADD COLUMN IF NOT EXISTS content_json jsonb,
  ADD COLUMN IF NOT EXISTS tokens integer,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS response_time_ms integer,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- Backfill clinic_id from parent conversation (for existing rows)
UPDATE public.messages m
SET clinic_id = c.clinic_id
FROM public.conversations c
WHERE m.conversation_id = c.id AND m.clinic_id IS NULL;

-- Enforce NOT NULL on clinic_id after backfill
ALTER TABLE public.messages ALTER COLUMN clinic_id SET NOT NULL;

-- =====================================================
-- 4. Fix clinic_ai_knowledge table
--    Problem: Code inserts chunk_index but column not defined in any migration.
--    Also: embedding_vector column needed for vector search (from 20260726_vector_search).
-- =====================================================

ALTER TABLE public.clinic_ai_knowledge ADD COLUMN IF NOT EXISTS chunk_index integer;

-- Ensure vector extension and embedding_vector column exist
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE public.clinic_ai_knowledge
  ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

-- Create match_clinic_documents RPC function if not exists
CREATE OR REPLACE FUNCTION match_clinic_documents (
  p_clinic_id UUID,
  p_query_embedding vector(1536),
  p_match_threshold FLOAT,
  p_match_count INT
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    k.id,
    k.document_id,
    k.content,
    1 - (k.embedding_vector <=> p_query_embedding) AS similarity
  FROM
    public.clinic_ai_knowledge AS k
  WHERE
    k.clinic_id = p_clinic_id
    AND 1 - (k.embedding_vector <=> p_query_embedding) > p_match_threshold
  ORDER BY
    k.embedding_vector <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

-- Create IVFFLAT index for approximate nearest neighbor search if not exists
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
ON public.clinic_ai_knowledge
USING ivfflat (embedding_vector vector_l2_ops)
WITH (lists = 100);

-- =====================================================
-- 5. Fix clinic_ai_settings table
--    Problem: Code references confidence_threshold column but it doesn't exist.
-- =====================================================

ALTER TABLE public.clinic_ai_settings ADD COLUMN IF NOT EXISTS confidence_threshold numeric;

-- =====================================================
-- 6. Fix ai_usage table
--    Problem: Column named tokens_consumed but code uses total_tokens.
--    Also: prompt_tokens and completion_tokens may be missing.
-- =====================================================

-- Rename tokens_consumed to total_tokens if it exists
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_usage' AND column_name = 'tokens_consumed'
  ) THEN
    ALTER TABLE public.ai_usage RENAME COLUMN tokens_consumed TO total_tokens;
  END IF;
END $$;

ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS prompt_tokens integer;
ALTER TABLE public.ai_usage ADD COLUMN IF NOT EXISTS completion_tokens integer;

-- =====================================================
-- 7. Fix notifications table
--    Problem: Missing status, scheduled_for, attempt_count, last_error columns.
-- =====================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS last_error text;

-- =====================================================
-- 8. Fix patients table
--    Problem: Code uses full_name and phone_number but schema has name and phone.
--    Also: date_of_birth and metadata columns are missing.
--    Fix: Conditionally rename columns using DO blocks.
-- =====================================================

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'name'
  ) THEN
    ALTER TABLE public.patients RENAME COLUMN name TO full_name;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'patients' AND column_name = 'phone'
  ) THEN
    ALTER TABLE public.patients RENAME COLUMN phone TO phone_number;
  END IF;
END $$;

ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS metadata jsonb;

-- =====================================================
-- 9. Fix leads table
--    Problem: Code and seed.sql insert name, email, phone but columns don't exist.
-- =====================================================

ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS phone text;

-- =====================================================
-- 10. Create profiles table
--     Problem: lib/services/users.ts queries profiles table but it's not defined.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  email text,
  phone text,
  role text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their own profile" ON public.profiles;
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Trigger for profiles updated_at
DROP TRIGGER IF EXISTS set_updated_at_profiles ON public.profiles;
CREATE TRIGGER set_updated_at_profiles
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- 11. Ensure clinic_knowledge_documents table exists with all required columns
--     Problem: Verify table exists with columns used by knowledgeService.ts.
-- =====================================================

CREATE TABLE IF NOT EXISTS public.clinic_knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  filename text NOT NULL,
  original_filename text NOT NULL,
  file_type text,
  mime_type text,
  file_size bigint NOT NULL,
  checksum text,
  language char(2) DEFAULT 'ar',
  storage_path text,
  upload_status text NOT NULL DEFAULT 'pending',
  processing_status text NOT NULL DEFAULT 'pending',
  chunk_count integer,
  embedding_model text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  indexed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uq_clinic_storage_path UNIQUE (clinic_id, storage_path)
);

-- Add any missing columns to existing table
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS filename text;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS original_filename text;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS file_type text;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS mime_type text;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS checksum text;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS language char(2) DEFAULT 'ar';
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS storage_path text;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS upload_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS chunk_count integer;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS embedding_model text;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS uploaded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS indexed_at timestamptz;
ALTER TABLE public.clinic_knowledge_documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Ensure document_id FK on clinic_ai_knowledge
ALTER TABLE public.clinic_ai_knowledge
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.clinic_knowledge_documents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_knowledge_document_id ON public.clinic_ai_knowledge(document_id);

-- Indexes for clinic_knowledge_documents
CREATE INDEX IF NOT EXISTS idx_docs_clinic_id ON public.clinic_knowledge_documents(clinic_id);
CREATE INDEX IF NOT EXISTS idx_docs_upload_status ON public.clinic_knowledge_documents(upload_status);
CREATE INDEX IF NOT EXISTS idx_docs_processing_status ON public.clinic_knowledge_documents(processing_status);

-- RLS for clinic_knowledge_documents
ALTER TABLE public.clinic_knowledge_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Docs can be managed by active clinic members" ON public.clinic_knowledge_documents;
CREATE POLICY "Docs can be managed by active clinic members"
ON public.clinic_knowledge_documents FOR ALL
USING (public.app_user_is_active_clinic_member(clinic_id))
WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

-- Trigger for clinic_knowledge_documents updated_at
DROP TRIGGER IF EXISTS set_updated_at_clinic_knowledge_documents ON public.clinic_knowledge_documents;
CREATE TRIGGER set_updated_at_clinic_knowledge_documents
  BEFORE UPDATE ON public.clinic_knowledge_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- 12. Ensure triggers exist for new/updated tables
-- =====================================================

-- Ensure set_updated_at function exists
CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================
-- End of migration
-- =====================================================
