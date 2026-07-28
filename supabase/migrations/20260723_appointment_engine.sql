-- Phase 6: provider schedules, holidays, reminders, and retryable notifications.
CREATE TABLE IF NOT EXISTS public.provider_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  enabled boolean NOT NULL DEFAULT true,
  start_time time NOT NULL,
  end_time time NOT NULL,
  breaks jsonb NOT NULL DEFAULT '[]'::jsonb,
  appointment_duration_minutes integer NOT NULL DEFAULT 30 CHECK (appointment_duration_minutes > 0),
  max_appointments_per_day integer,
  UNIQUE(provider_id, weekday)
);
CREATE TABLE IF NOT EXISTS public.provider_vacations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  vacation_date date NOT NULL,
  UNIQUE(provider_id, vacation_date)
);
CREATE TABLE IF NOT EXISTS public.clinic_holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  holiday_date date NOT NULL,
  name text,
  UNIQUE(clinic_id, holiday_date)
);

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS public.notification_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  appointment_id uuid REFERENCES public.appointments(id) ON DELETE CASCADE,
  patient_id uuid REFERENCES public.patients(id) ON DELETE SET NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'sms', 'email')),
  type text NOT NULL DEFAULT 'appointment_reminder',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retried')),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  failed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notification_queue_due_idx ON public.notification_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS provider_schedules_clinic_idx ON public.provider_schedules(clinic_id, provider_id);

ALTER TABLE public.provider_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_vacations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clinic_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_schedules_member_policy ON public.provider_schedules FOR ALL USING (public.app_user_is_active_clinic_member(clinic_id)) WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));
CREATE POLICY provider_vacations_member_policy ON public.provider_vacations FOR ALL USING (public.app_user_is_active_clinic_member(clinic_id)) WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));
CREATE POLICY clinic_holidays_member_policy ON public.clinic_holidays FOR ALL USING (public.app_user_is_active_clinic_member(clinic_id)) WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));
CREATE POLICY notification_queue_member_policy ON public.notification_queue FOR ALL USING (public.app_user_is_active_clinic_member(clinic_id)) WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));
