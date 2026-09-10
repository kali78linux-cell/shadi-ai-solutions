-- 20260833_clinic_ads_fix.sql
-- STEP 15E/G1 — Clinic Ads corrected migration (ADDITIVE, idempotent).
--
-- The original 20260820_clinic_ads_table.sql used `CREATE TRIGGER IF NOT EXISTS`,
-- which PostgreSQL does not support (42601). This file is the safe, applyable
-- version. It does NOT modify the historical migration.
--
-- Adds the same table/index/trigger/RLS policies using valid PostgreSQL:
--   DROP TRIGGER IF EXISTS ...; CREATE TRIGGER ...
-- Policies use the standard app_user_is_active_clinic_member_safe helper so
-- there is no risk of RLS recursion.
--
-- ROLLBACK (manual, safe):
--   DROP TABLE IF EXISTS public.clinic_ads;  -- only touches what this file creates

CREATE TABLE IF NOT EXISTS clinic_ads (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       UUID         NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  title           TEXT         NOT NULL,
  description     TEXT,
  image_url       TEXT,
  cta_text        TEXT NOT NULL DEFAULT 'إقرأ المزيد',
  cta_link        TEXT,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  display_order   INTEGER      NOT NULL DEFAULT 0,
  start_date      DATE,
  end_date        DATE,
  created_by      UUID REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index for fast active-ads lookup per clinic
CREATE INDEX IF NOT EXISTS idx_clinic_ads_clinic_active
  ON clinic_ads (clinic_id, is_active, display_order, start_date, end_date)
  WHERE is_active = true;

-- Valid PostgreSQL trigger. NOTE: the original 20260820 migration referenced a
-- non-existent function `update_updated_at()`; the actual trigger function used
-- by every other table in this schema is `set_updated_at()` (verified live).
DROP TRIGGER IF EXISTS clinic_ads_updated_at ON clinic_ads;
CREATE TRIGGER clinic_ads_updated_at
  BEFORE UPDATE ON clinic_ads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: only active members of the owning clinic can access ads
ALTER TABLE clinic_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_ads_select_own" ON clinic_ads;
DROP POLICY IF EXISTS "clinic_ads_insert_own" ON clinic_ads;
DROP POLICY IF EXISTS "clinic_ads_update_own" ON clinic_ads;
DROP POLICY IF EXISTS "clinic_ads_delete_own" ON clinic_ads;

CREATE POLICY "clinic_ads_select_own" ON clinic_ads
  FOR SELECT USING (
    app_is_super_admin() OR app_user_is_active_clinic_member_safe(clinic_id)
  );

CREATE POLICY "clinic_ads_insert_own" ON clinic_ads
  FOR INSERT WITH CHECK (
    app_is_super_admin() OR app_user_is_active_clinic_member_safe(clinic_id)
  );

CREATE POLICY "clinic_ads_update_own" ON clinic_ads
  FOR UPDATE USING (
    app_is_super_admin() OR app_user_is_active_clinic_member_safe(clinic_id)
  ) WITH CHECK (
    app_is_super_admin() OR app_user_is_active_clinic_member_safe(clinic_id)
  );

CREATE POLICY "clinic_ads_delete_own" ON clinic_ads
  FOR DELETE USING (
    app_is_super_admin() OR app_user_is_active_clinic_member_safe(clinic_id)
  );