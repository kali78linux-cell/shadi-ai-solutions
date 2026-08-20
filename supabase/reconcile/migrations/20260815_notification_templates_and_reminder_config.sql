-- Phase: Production-grade Patient Lifecycle & Communications
-- Purpose: Add configurable reminder timing and notification templates to clinic_communication_settings
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. Add reminder timing columns
-- =====================================================
ALTER TABLE public.clinic_communication_settings
  ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reminder_offset_minutes_1 integer NOT NULL DEFAULT 1440,  -- 24 hours
  ADD COLUMN IF NOT EXISTS reminder_offset_minutes_2 integer,                         -- optional 2nd reminder
  ADD COLUMN IF NOT EXISTS confirmation_notifications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancellation_notifications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS rescheduling_notifications boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS notification_language text NOT NULL DEFAULT 'ar';

-- =====================================================
-- 2. Notification templates table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.clinic_notification_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  template_type text NOT NULL CHECK (template_type IN (
    'appointment_confirmation',
    'appointment_reminder',
    'appointment_cancellation',
    'appointment_rescheduling'
  )),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'whatsapp', 'telegram')),
  language text NOT NULL DEFAULT 'ar',
  subject text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, template_type, channel, language)
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_clinic
  ON public.clinic_notification_templates(clinic_id);

-- =====================================================
-- 3. Default templates (Arabic)
-- =====================================================
INSERT INTO public.clinic_notification_templates (clinic_id, template_type, channel, language, subject, body)
SELECT c.id, 'appointment_confirmation', 'email', 'ar', 'تأكيد الموعد - {{clinic_name}}',
  'عزيزي/عزيزتي {{patient_name}}،\n\nتم تأكيد موعدك في عيادة {{clinic_name}}.\n\nالخدمة: {{service_name}}\nالطبيب: {{provider_name}}\nالتاريخ: {{appointment_date}}\nالوقت: {{appointment_time}}\n\nللتأكيد أو الإلغاء: {{booking_link}}\n\nشكراً لثقتكم.'
FROM public.clinics c
WHERE NOT EXISTS (
  SELECT 1 FROM public.clinic_notification_templates t
  WHERE t.clinic_id = c.id AND t.template_type = 'appointment_confirmation'
    AND t.channel = 'email' AND t.language = 'ar'
);

INSERT INTO public.clinic_notification_templates (clinic_id, template_type, channel, language, subject, body)
SELECT c.id, 'appointment_reminder', 'email', 'ar', 'تذكير بالموعد - {{clinic_name}}',
  'عزيزي/عزيزتي {{patient_name}}،\n\nهذا تذكير بموعدك في عيادة {{clinic_name}}.\n\nالخدمة: {{service_name}}\nالطبيب: {{provider_name}}\nالتاريخ: {{appointment_date}}\nالوقت: {{appointment_time}}\n\nللتأكيد أو الإلغاء: {{booking_link}}\n\nننتظركم.'
FROM public.clinics c
WHERE NOT EXISTS (
  SELECT 1 FROM public.clinic_notification_templates t
  WHERE t.clinic_id = c.id AND t.template_type = 'appointment_reminder'
    AND t.channel = 'email' AND t.language = 'ar'
);

INSERT INTO public.clinic_notification_templates (clinic_id, template_type, channel, language, subject, body)
SELECT c.id, 'appointment_cancellation', 'email', 'ar', 'إلغاء الموعد - {{clinic_name}}',
  'عزيزي/عزيزتي {{patient_name}}،\n\nتم إلغاء موعدك في عيادة {{clinic_name}}.\n\nالخدمة: {{service_name}}\nالتاريخ: {{appointment_date}}\nالوقت: {{appointment_time}}\n\nإذا كنت ترغب في حجز موعد جديد، يرجى زيارتنا.\n\nشكراً.'
FROM public.clinics c
WHERE NOT EXISTS (
  SELECT 1 FROM public.clinic_notification_templates t
  WHERE t.clinic_id = c.id AND t.template_type = 'appointment_cancellation'
    AND t.channel = 'email' AND t.language = 'ar'
);

INSERT INTO public.clinic_notification_templates (clinic_id, template_type, channel, language, subject, body)
SELECT c.id, 'appointment_rescheduling', 'email', 'ar', 'تعديل الموعد - {{clinic_name}}',
  'عزيزي/عزيزتي {{patient_name}}،\n\nتم تعديل موعدك في عيادة {{clinic_name}}.\n\nالخدمة: {{service_name}}\nالطبيب: {{provider_name}}\nالتاريخ: {{appointment_date}}\nالوقت: {{appointment_time}}\n\nللتأكيد أو الإلغاء: {{booking_link}}\n\nشكراً.'
FROM public.clinics c
WHERE NOT EXISTS (
  SELECT 1 FROM public.clinic_notification_templates t
  WHERE t.clinic_id = c.id AND t.template_type = 'appointment_rescheduling'
    AND t.channel = 'email' AND t.language = 'ar'
);

-- =====================================================
-- 4. RLS for notification templates
-- =====================================================
ALTER TABLE public.clinic_notification_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Notification templates can be read by clinic members" ON public.clinic_notification_templates;
CREATE POLICY "Notification templates can be read by clinic members"
  ON public.clinic_notification_templates FOR SELECT
  USING (public.app_user_is_active_clinic_member(clinic_id));

DROP POLICY IF EXISTS "Notification templates can be managed by clinic members" ON public.clinic_notification_templates;
CREATE POLICY "Notification templates can be managed by clinic members"
  ON public.clinic_notification_templates FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

-- =====================================================
-- End of migration
-- =====================================================