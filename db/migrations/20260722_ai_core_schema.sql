-- Migration: AI Core System schema
-- Adds clinic AI knowledge, settings, conversations, messages, leads, events, and usage tracking

-- Ensure required extensions
DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  -- pgvector is optional; create if available
  PERFORM 1 FROM pg_extension WHERE extname = 'vector';
EXCEPTION WHEN undefined_function THEN
  -- ignore
  NULL;
END $$;

-- Enums
DO $$ BEGIN
  CREATE TYPE ai_message_role AS ENUM ('patient','assistant','staff','system');
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE != '42710' THEN RAISE; END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE conversation_status AS ENUM ('open','awaiting_human','closed');
EXCEPTION WHEN OTHERS THEN
  IF SQLSTATE != '42710' THEN RAISE; END IF;
END $$;

-- Clinic AI Knowledge
CREATE TABLE IF NOT EXISTS clinic_ai_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  type text NOT NULL, -- 'structured' | 'unstructured'
  subtype text NULL,
  title text NULL,
  content text NULL,
  structured_data jsonb NULL,
  metadata jsonb NULL,
  embedding vector(1536) NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS clinic_ai_knowledge_clinic_idx ON clinic_ai_knowledge (clinic_id);
CREATE INDEX IF NOT EXISTS clinic_ai_knowledge_subtype_idx ON clinic_ai_knowledge (clinic_id, subtype);

-- Clinic AI Settings
CREATE TABLE IF NOT EXISTS clinic_ai_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL UNIQUE,
  assistant_name text NULL,
  tone text NULL,
  language text NULL,
  greeting text NULL,
  safety_controls jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS clinic_ai_settings_clinic_idx ON clinic_ai_settings (clinic_id);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  patient_id uuid NULL,
  session_id text NOT NULL,
  status conversation_status NOT NULL DEFAULT 'open',
  assigned_staff_id uuid NULL,
  metadata jsonb NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS conversations_clinic_idx ON conversations (clinic_id);
CREATE INDEX IF NOT EXISTS conversations_session_idx ON conversations (session_id);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  clinic_id uuid NOT NULL,
  role ai_message_role NOT NULL,
  sender_id uuid NULL,
  content text NULL,
  content_json jsonb NULL,
  tokens integer NULL,
  model text NULL,
  response_time_ms integer NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS messages_conversation_idx ON messages (conversation_id);
CREATE INDEX IF NOT EXISTS messages_clinic_idx ON messages (clinic_id);

-- Leads
CREATE TABLE IF NOT EXISTS ai_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  conversation_id uuid NULL REFERENCES conversations(id) ON DELETE SET NULL,
  patient_contact jsonb NULL,
  score numeric NULL,
  metadata jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_leads_clinic_idx ON ai_leads (clinic_id);

-- Events / Analytics
CREATE TABLE IF NOT EXISTS ai_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  conversation_id uuid NULL,
  event_type text NOT NULL,
  payload jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_events_clinic_idx ON ai_events (clinic_id);

-- Usage / Cost Tracking
CREATE TABLE IF NOT EXISTS ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL,
  model text NULL,
  tokens_consumed bigint NOT NULL DEFAULT 0,
  estimated_cost numeric NULL,
  period_start date NULL,
  period_end date NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_clinic_idx ON ai_usage (clinic_id);

-- Triggers to maintain updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Attach trigger to tables
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_clinic_ai') THEN
    CREATE TRIGGER set_updated_at_clinic_ai
    BEFORE UPDATE ON clinic_ai_knowledge FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_conversations') THEN
    CREATE TRIGGER set_updated_at_conversations
    BEFORE UPDATE ON conversations FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_messages') THEN
    CREATE TRIGGER set_updated_at_messages
    BEFORE UPDATE ON messages FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- RLS policies: use helper function app_user_is_active_clinic_member(clinic_id)
-- Allow only clinic members to access/modify rows; service role bypasses RLS

ALTER TABLE clinic_ai_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinic_ai_knowledge_rls ON clinic_ai_knowledge
  FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

ALTER TABLE clinic_ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinic_ai_settings_rls ON clinic_ai_settings
  FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY conversations_rls ON conversations
  FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY messages_rls ON messages
  FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

ALTER TABLE ai_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_leads_rls ON ai_leads
  FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

ALTER TABLE ai_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_events_rls ON ai_events
  FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

ALTER TABLE ai_usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_usage_rls ON ai_usage
  FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));
