-- Migration: AI Core System schema
-- Dental AI Receptionist SaaS - This version is corrected to be an incremental migration.
-- It evolves the schema from 'initial_schema' instead of redefining it.


-- =====================================================
-- Extensions
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;



-- =====================================================
-- Enums
-- =====================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ai_message_role') THEN
    CREATE TYPE ai_message_role AS ENUM (
      'patient',
      'assistant',
      'staff',
      'system'
    );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'conversation_status') THEN
    CREATE TYPE conversation_status AS ENUM (
      'open',
      'awaiting_human',
      'closed'
    );
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;



-- =====================================================
-- Clinic AI Knowledge
-- =====================================================

CREATE TABLE IF NOT EXISTS clinic_ai_knowledge (

  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),

  clinic_id uuid NOT NULL,

  type text NOT NULL,

  subtype text,

  title text,

  content text,

  structured_data jsonb,

  metadata jsonb,

  embedding extensions.vector(1536),

  created_at timestamptz DEFAULT now(),

  updated_at timestamptz DEFAULT now(),

  deleted_at timestamptz

);


CREATE INDEX IF NOT EXISTS clinic_ai_knowledge_clinic_idx
ON clinic_ai_knowledge(clinic_id);



-- =====================================================
-- AI Settings
-- =====================================================

CREATE TABLE IF NOT EXISTS clinic_ai_settings (

 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),

 clinic_id uuid UNIQUE NOT NULL,

 assistant_name text,

 tone text,

 language text,

 greeting text,

 safety_controls jsonb,

 created_at timestamptz DEFAULT now(),

 updated_at timestamptz DEFAULT now(),

 deleted_at timestamptz

);



-- =====================================================
-- Conversations
-- =====================================================

-- Evolve the existing 'conversations' table from the initial schema
-- instead of attempting to recreate it.
-- The following changes are in separate statements for clarity and to ensure
-- sequential execution of column modifications.

-- 1. Drop the old text-based default (safe DO block for idempotency on re-runs).
DO $$ BEGIN
  IF (SELECT column_default IS NOT NULL FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'conversations' AND column_name = 'status') THEN
    ALTER TABLE public.conversations ALTER COLUMN status DROP DEFAULT;
  END IF;
END $$;

-- 2. Change the column type to the new enum, mapping old 'active' values to 'open'.
--    Both branches of the CASE must return conversation_status to avoid
--    "default for column cannot be cast automatically" errors.
ALTER TABLE public.conversations
  ALTER COLUMN status TYPE conversation_status
  USING (CASE status WHEN 'active' THEN 'open'::conversation_status ELSE status::text::conversation_status END);

-- 3. Set the new default value for the enum type.
ALTER TABLE public.conversations
  ALTER COLUMN status SET DEFAULT 'open';

-- 4. Add new columns to the conversations table (single statement, IF NOT EXISTS for idempotency).
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_staff_id uuid,
  ADD COLUMN IF NOT EXISTS metadata jsonb,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at timestamptz;

CREATE INDEX IF NOT EXISTS conversations_clinic_idx
ON conversations(clinic_id);



CREATE INDEX IF NOT EXISTS conversations_session_idx
ON conversations(session_id);



-- =====================================================
-- Messages
-- =====================================================

-- Evolve the existing 'messages' table from the initial schema.

-- 1. Drop the old text-based check constraint to prepare for enum type change.
ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_role_check;

-- 2. Alter the role column to use the new, more specific enum type.
ALTER TABLE public.messages
  ALTER COLUMN role TYPE ai_message_role USING role::text::ai_message_role;

-- 3. Add new columns that are part of the AI core schema.
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS clinic_id uuid, -- Add as nullable first to allow back-filling
  ADD COLUMN IF NOT EXISTS sender_id uuid,
  ADD COLUMN IF NOT EXISTS content_json jsonb,
  ADD COLUMN IF NOT EXISTS tokens integer,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS response_time_ms integer,
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- 4. Back-fill the clinic_id from the parent conversation to ensure data integrity.
-- This is crucial for the RLS policy to work on existing data.
UPDATE public.messages m
SET clinic_id = c.clinic_id
FROM public.conversations c
WHERE m.conversation_id = c.id AND m.clinic_id IS NULL;

-- 5. Now that the column is populated, enforce the NOT NULL constraint for future inserts.
-- This makes the schema robust for all new messages.
ALTER TABLE public.messages
  ALTER COLUMN clinic_id SET NOT NULL;


CREATE INDEX IF NOT EXISTS messages_conversation_idx
ON messages(conversation_id);



-- =====================================================
-- Leads
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_leads (

 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),

 clinic_id uuid NOT NULL,

 conversation_id uuid
 REFERENCES conversations(id)
 ON DELETE SET NULL,

 patient_contact jsonb,

 score numeric,

 metadata jsonb,

 created_at timestamptz DEFAULT now(),

 updated_at timestamptz DEFAULT now()

);



-- =====================================================
-- Events
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_events (

 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),

 clinic_id uuid NOT NULL,

 conversation_id uuid,

 event_type text NOT NULL,

 payload jsonb,

 created_at timestamptz DEFAULT now()

);



-- =====================================================
-- Usage
-- =====================================================

CREATE TABLE IF NOT EXISTS ai_usage (

 id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),

 clinic_id uuid NOT NULL,

 model text,

 tokens_consumed bigint DEFAULT 0,

 estimated_cost numeric,

 period_start date,

 period_end date,

 created_at timestamptz DEFAULT now()

);



-- =====================================================
-- Updated trigger
-- =====================================================

DROP TRIGGER IF EXISTS trigger_ai_knowledge_updated
ON clinic_ai_knowledge;

CREATE TRIGGER trigger_ai_knowledge_updated
BEFORE UPDATE ON clinic_ai_knowledge
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();



DROP TRIGGER IF EXISTS trigger_ai_settings_updated
ON clinic_ai_settings;

CREATE TRIGGER trigger_ai_settings_updated
BEFORE UPDATE ON clinic_ai_settings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trigger_leads_updated
ON ai_leads;

CREATE TRIGGER trigger_leads_updated
BEFORE UPDATE ON ai_leads
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
-- =====================================================
-- RLS
-- =====================================================

ALTER TABLE clinic_ai_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinic_ai_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;



DROP POLICY IF EXISTS clinic_ai_knowledge_policy ON clinic_ai_knowledge;

CREATE POLICY clinic_ai_knowledge_policy
ON clinic_ai_knowledge
FOR ALL
USING (
 public.app_user_is_active_clinic_member(clinic_id)
);



DROP POLICY IF EXISTS clinic_ai_settings_policy ON clinic_ai_settings;

CREATE POLICY clinic_ai_settings_policy
ON clinic_ai_settings
FOR ALL
USING (
 public.app_user_is_active_clinic_member(clinic_id)
);



DROP POLICY IF EXISTS conversations_policy ON conversations;

CREATE POLICY conversations_policy
ON conversations
FOR ALL
USING (
 public.app_user_is_active_clinic_member(clinic_id)
);



DROP POLICY IF EXISTS messages_policy ON messages;

CREATE POLICY messages_policy
ON messages
FOR ALL
USING (
 public.app_user_is_active_clinic_member(clinic_id)
);



DROP POLICY IF EXISTS ai_leads_policy ON ai_leads;

CREATE POLICY ai_leads_policy
ON ai_leads
FOR ALL
USING (
 public.app_user_is_active_clinic_member(clinic_id)
);



DROP POLICY IF EXISTS ai_events_policy ON ai_events;

CREATE POLICY ai_events_policy
ON ai_events
FOR ALL
USING (
 public.app_user_is_active_clinic_member(clinic_id)
);



DROP POLICY IF EXISTS ai_usage_policy ON ai_usage;

CREATE POLICY ai_usage_policy
ON ai_usage
FOR ALL
USING (
 public.app_user_is_active_clinic_member(clinic_id)
);