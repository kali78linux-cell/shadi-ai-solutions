-- Phase: Patient Booking Portal — Appointment Lifecycle
-- Purpose: Add a secure, non-guessable booking token so a public patient
-- can confirm/cancel their own appointment without staff authentication.
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. Add booking_token column to appointments
-- =====================================================
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS booking_token text;

-- Index for token lookup (clinic-scoped)
CREATE INDEX IF NOT EXISTS idx_appointments_booking_token
  ON public.appointments(clinic_id, id, booking_token)
  WHERE booking_token IS NOT NULL;

-- =====================================================
-- End of migration
-- =====================================================