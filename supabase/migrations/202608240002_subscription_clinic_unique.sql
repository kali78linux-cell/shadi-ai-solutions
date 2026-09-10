-- Production readiness / subscription: enforce one active subscription row per clinic.
-- Additive, non-destructive; supports the subscription API upsert on clinic_id.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_clinic_id_active
  ON public.subscriptions (clinic_id)
  WHERE deleted_at IS NULL;