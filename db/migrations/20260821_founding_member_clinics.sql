-- =============================================================
-- 20260821_founding_member_clinics.sql
-- Landing page founding-members offer.
--
-- Adds to clinics:
--   * is_founding_member        boolean  not null default false
--   * founding_price_locked_at  timestamptz
--
-- Makes leads.clinic_id nullable so "book your place / request a quote"
-- leads captured from the landing page BEFORE a clinic is registered
-- can be stored with clinic_id = NULL (doctor is interested but has not
-- yet created their clinic).
--
-- Idempotent: safe to re-run. This is the ONLY backend change required
-- for the landing page founding-member offer.
-- =============================================================

-- -------------------------------------------------------------
-- 1. clinics: founding-member columns
-- -------------------------------------------------------------
ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS is_founding_member boolean NOT NULL DEFAULT false;

ALTER TABLE public.clinics
  ADD COLUMN IF NOT EXISTS founding_price_locked_at timestamptz;

-- Index for fast "remaining founding slots" count
-- (100 - COUNT(*) WHERE is_founding_member = true AND deleted_at IS NULL)
CREATE INDEX IF NOT EXISTS idx_clinics_founding_member
  ON public.clinics (is_founding_member)
  WHERE is_founding_member = true AND deleted_at IS NULL;

-- -------------------------------------------------------------
-- 2. leads: allow clinic_id NULL (pre-registration landing leads)
-- -------------------------------------------------------------
ALTER TABLE public.leads
  ALTER COLUMN clinic_id DROP NOT NULL;

-- -------------------------------------------------------------
-- Apply migrations log
-- This migration should be added to scripts/apply-migrations.mjs
-- migration list after 20260820_clinic_ads_table.sql (if present).
-- -------------------------------------------------------------