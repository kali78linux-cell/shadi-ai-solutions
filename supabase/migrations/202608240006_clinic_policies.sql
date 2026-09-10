-- Additive, safe: adds a policies JSONB column to clinic_ai_settings so the
-- clinic owner can manage booking/cancellation/rescheduling/emergency/payment
-- policies from the dashboard. NULL = policy not set (system uses safe fallback).
ALTER TABLE public.clinic_ai_settings
  ADD COLUMN IF NOT EXISTS policies jsonb NULL;