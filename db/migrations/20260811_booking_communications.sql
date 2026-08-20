-- Phase: Patient Booking Portal — Communications & Reminders
-- Purpose: Allow pending reminders to be cancelled when an appointment is cancelled.
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. Add 'cancelled' to notification_queue status CHECK
-- =====================================================
ALTER TABLE public.notification_queue
  DROP CONSTRAINT IF EXISTS notification_queue_status_check;

ALTER TABLE public.notification_queue
  ADD CONSTRAINT notification_queue_status_check
  CHECK (status IN ('pending', 'sent', 'failed', 'retried', 'cancelled'));

-- =====================================================
-- End of migration
-- =====================================================