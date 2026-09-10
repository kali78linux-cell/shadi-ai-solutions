-- Production readiness: align clinic AI settings storage with the existing
-- Dashboard controls and orchestrator settings reads. Additive only.

ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS lead_detection_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS appointment_booking_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS knowledge_retrieval_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_service_prices_to_patients boolean NOT NULL DEFAULT false;
