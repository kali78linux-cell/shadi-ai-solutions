-- 20260820_clinic_ads_table.sql
-- Clinic-specific advertisement/promotional banner system.
-- Each ad belongs to a single clinic and is clinic-isolated via clinic_id + RLS.

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

-- Updated trigger for automatic updated_at
CREATE TRIGGER IF NOT EXISTS clinic_ads_updated_at
  BEFORE UPDATE ON clinic_ads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: only members of the owning clinic can manage ads
-- (Assuming the RLS helper app_user_is_active_clinic_member is already available
--  from the 20260816_fix_recursive_rls migration)
ALTER TABLE clinic_ads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_ads_select_own" ON clinic_ads;
DROP POLICY IF EXISTS "clinic_ads_insert_own" ON clinic_ads;
DROP POLICY IF EXISTS "clinic_ads_update_own" ON clinic_ads;
DROP POLICY IF EXISTS "clinic_ads_delete_own" ON clinic_ads;

CREATE POLICY "clinic_ads_select_own" ON clinic_ads
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.clinic_id = clinic_ads.clinic_id
        AND cu.user_id = auth.uid()
        AND cu.deleted_at IS NULL
    )
  );

CREATE POLICY "clinic_ads_insert_own" ON clinic_ads
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.clinic_id = clinic_ads.clinic_id
        AND cu.user_id = auth.uid()
        AND cu.deleted_at IS NULL
    )
  );

CREATE POLICY "clinic_ads_update_own" ON clinic_ads
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.clinic_id = clinic_ads.clinic_id
        AND cu.user_id = auth.uid()
        AND cu.deleted_at IS NULL
    )
  );

CREATE POLICY "clinic_ads_delete_own" ON clinic_ads
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM clinic_users cu
      WHERE cu.clinic_id = clinic_ads.clinic_id
        AND cu.user_id = auth.uid()
        AND cu.deleted_at IS NULL
    )
  );

-- Add to apply-migrations.mjs list (documented for ops)
-- This migration should be added to scripts/apply-migrations.mjs migration list
-- after the 20260816_fix_recursive_rls.sql migration.
