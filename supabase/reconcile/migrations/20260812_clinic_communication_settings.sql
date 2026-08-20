-- Phase: Multi-Channel Delivery — Clinic Communication Settings
-- Purpose: Per-clinic channel enablement and notification-type channel routing.
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. clinic_communication_settings table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.clinic_communication_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL UNIQUE REFERENCES public.clinics(id) ON DELETE CASCADE,

  -- Channel enablement
  email_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT false,
  whatsapp_enabled boolean NOT NULL DEFAULT false,
  telegram_enabled boolean NOT NULL DEFAULT false,

  -- Notification-type channel routing (which channels to use for each event type)
  -- Each is a JSON array of channel names, e.g. ["email","sms"]
  reminder_channels jsonb NOT NULL DEFAULT '["email"]'::jsonb,
  confirmation_channels jsonb NOT NULL DEFAULT '["email"]'::jsonb,
  cancellation_channels jsonb NOT NULL DEFAULT '["email"]'::jsonb,

  -- Default channel used when a notification type has no explicit routing
  default_channel text NOT NULL DEFAULT 'email' CHECK (default_channel IN ('email','sms','whatsapp','telegram')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinic_comm_settings_clinic_id
  ON public.clinic_communication_settings(clinic_id);

-- =====================================================
-- 2. RLS
-- =====================================================
ALTER TABLE public.clinic_communication_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic comm settings can be read by clinic members" ON public.clinic_communication_settings;
CREATE POLICY "Clinic comm settings can be read by clinic members"
  ON public.clinic_communication_settings FOR SELECT
  USING (public.app_user_is_active_clinic_member(clinic_id));

DROP POLICY IF EXISTS "Clinic comm settings can be managed by clinic members" ON public.clinic_communication_settings;
CREATE POLICY "Clinic comm settings can be managed by clinic members"
  ON public.clinic_communication_settings FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

-- =====================================================
-- 3. Trigger for updated_at
-- =====================================================
DROP TRIGGER IF EXISTS set_updated_at_clinic_comm_settings ON public.clinic_communication_settings;
CREATE TRIGGER set_updated_at_clinic_comm_settings
  BEFORE UPDATE ON public.clinic_communication_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- End of migration
-- =====================================================