-- ============================================================================
-- 20260827_dashboard_location_roles_shifts.sql
-- Dashboard completion: clinic location columns + wider provider roles +
-- multi-shift schedules. ADDITIVE ONLY — no data is dropped or rewritten
-- except the documented one-time backfill of `city` from settings JSONB.
--
-- ROLLBACK (safe, manual):
--   ALTER TABLE public.provider_schedules DROP COLUMN IF EXISTS shifts;
--   ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_provider_type_check;
--   ALTER TABLE public.providers ADD CONSTRAINT providers_provider_type_check
--     CHECK (provider_type IN ('dentist','hygienist','staff'));
--   -- legacy UI values remain stored but the old constraint rejects new ones;
--   -- rows written with new roles must be updated back before re-applying it.
--   ALTER TABLE public.clinics DROP CONSTRAINT IF EXISTS clinics_longitude_range_check;
--   ALTER TABLE public.clinics DROP CONSTRAINT IF EXISTS clinics_latitude_range_check;
--   ALTER TABLE public.clinics DROP COLUMN IF EXISTS address_detail;
--   ALTER TABLE public.clinics DROP COLUMN IF EXISTS longitude;
--   ALTER TABLE public.clinics DROP COLUMN IF EXISTS latitude;
--   ALTER TABLE public.clinics DROP COLUMN IF EXISTS area;
--   ALTER TABLE public.clinics DROP COLUMN IF EXISTS city;
-- ============================================================================

-- 1) Clinic location columns -------------------------------------------------
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS city           text;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS area           text;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS address_detail text;
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS latitude       numeric(9, 6);
ALTER TABLE public.clinics ADD COLUMN IF NOT EXISTS longitude      numeric(9, 6);

ALTER TABLE public.clinics DROP CONSTRAINT IF EXISTS clinics_latitude_range_check;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_latitude_range_check
  CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90));

ALTER TABLE public.clinics DROP CONSTRAINT IF EXISTS clinics_longitude_range_check;
ALTER TABLE public.clinics
  ADD CONSTRAINT clinics_longitude_range_check
  CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

-- One-time backfill from the settings JSONB the register flow already wrote.
UPDATE public.clinics
SET city = settings->>'city'
WHERE city IS NULL
  AND settings IS NOT NULL
  AND settings ? 'city'
  AND COALESCE(settings->>'city', '') <> '';

-- 2) Wider provider roles (receptionist/manager/specialist/assistant) --------
DO $$
DECLARE
  existing_constraint text;
BEGIN
  SELECT conname INTO existing_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.providers'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%provider_type%'
  LIMIT 1;

  IF existing_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.providers DROP CONSTRAINT %I', existing_constraint);
  END IF;
END $$;

ALTER TABLE public.providers
  ADD CONSTRAINT providers_provider_type_check
  CHECK (provider_type IN (
    'dentist', 'specialist', 'hygienist',
    'receptionist', 'assistant', 'manager', 'staff'
  ));

-- 3) Multi-shift workday support ---------------------------------------------
-- `shifts` holds extra working periods [{ "start": "15:00", "end": "20:00" }].
-- start_time/end_time stay authoritative for shift #1 so the EXISTING
-- availability engine keeps working unchanged.
ALTER TABLE public.provider_schedules
  ADD COLUMN IF NOT EXISTS shifts jsonb NOT NULL DEFAULT '[]'::jsonb;
