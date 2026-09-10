-- ============================================================================
-- LAB SERVICES — pricing + delivery domain model (2026-09-10).
-- Mirrors the imaging_services extension from 20260907_imaging_domain_booking.sql.
-- The public digital healthcare space (lib/services/activityPublicSpace.ts)
-- reads the SAME domain columns from both imaging_services and lab_services.
-- lab_services was created (20260914) with only the base columns, so any
-- dental-lab public page / Booking selection would fail with
-- "column lab_services.pricing_mode does not exist".
-- Non-destructive: only ADD COLUMN + unique index. Safe to run repeatedly.
-- ============================================================================

ALTER TABLE public.lab_services
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS modality text,
  ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'unspecified',
  ADD COLUMN IF NOT EXISTS price_min numeric,
  ADD COLUMN IF NOT EXISTS price_max numeric,
  ADD COLUMN IF NOT EXISTS price_note text,
  ADD COLUMN IF NOT EXISTS requires_provider boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preparation_instructions text,
  ADD COLUMN IF NOT EXISTS report_policy text,
  ADD COLUMN IF NOT EXISTS delivery_methods jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

-- One row per (clinic, lab service) — prevents duplicate catalog rows.
CREATE UNIQUE INDEX IF NOT EXISTS lab_services_clinic_id_name_key
  ON public.lab_services (clinic_id, name);