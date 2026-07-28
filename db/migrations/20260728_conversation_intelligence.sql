-- Phase 5: production conversation intelligence fields and lifecycle states.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS conversation_state text NOT NULL DEFAULT 'ai',
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS intent_confidence numeric,
  ADD COLUMN IF NOT EXISTS urgency text NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS appointment_data jsonb;

ALTER TABLE ai_leads
  ADD COLUMN IF NOT EXISTS lead_temperature text,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS intent text,
  ADD COLUMN IF NOT EXISTS urgency text,
  ADD COLUMN IF NOT EXISTS estimated_value numeric;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_state_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_state_check CHECK (conversation_state IN ('ai', 'awaiting_staff', 'assigned_staff', 'resolved', 'closed'));

CREATE INDEX IF NOT EXISTS conversations_state_idx ON conversations (clinic_id, conversation_state);
CREATE INDEX IF NOT EXISTS ai_leads_temperature_idx ON ai_leads (clinic_id, lead_temperature);
CREATE INDEX IF NOT EXISTS ai_events_type_idx ON ai_events (clinic_id, event_type);