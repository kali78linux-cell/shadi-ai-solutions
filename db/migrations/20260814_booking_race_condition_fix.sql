-- Phase: Real Clinic Pilot Preparation
-- Purpose: Prevent double-booking race conditions by adding a unique constraint
-- on appointments(provider_id, scheduled_at) for active statuses.
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. Partial unique index to prevent double-booking
-- =====================================================
-- Only active statuses (scheduled, tentative, confirmed) are protected.
-- Cancelled/completed appointments can be re-booked at the same slot.
DROP INDEX IF EXISTS idx_appointments_unique_active_slot;
CREATE UNIQUE INDEX idx_appointments_unique_active_slot
  ON public.appointments(provider_id, scheduled_at)
  WHERE status IN ('scheduled', 'tentative', 'confirmed')
    AND deleted_at IS NULL;

-- =====================================================
-- End of migration
-- =====================================================