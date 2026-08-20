-- Phase: Provider Schedule + Provider/Service Assignment
-- Purpose: Add provider_services link table (referenced by booking service)
-- and ensure provider_schedules has the needed index.
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. provider_services link table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.provider_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES public.clinic_services(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, provider_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_services_clinic_id ON public.provider_services(clinic_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_provider_id ON public.provider_services(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_services_service_id ON public.provider_services(service_id);

-- =====================================================
-- 2. RLS for provider_services
-- =====================================================
ALTER TABLE public.provider_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Provider services can be read by clinic members" ON public.provider_services;
CREATE POLICY "Provider services can be read by clinic members"
  ON public.provider_services FOR SELECT
  USING (public.app_user_is_active_clinic_member(clinic_id));

DROP POLICY IF EXISTS "Provider services can be managed by clinic members" ON public.provider_services;
CREATE POLICY "Provider services can be managed by clinic members"
  ON public.provider_services FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

-- =====================================================
-- 3. provider_schedules index (if not present)
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_provider_schedules_clinic_provider
  ON public.provider_schedules(clinic_id, provider_id);

-- =====================================================
-- End of migration
-- =====================================================