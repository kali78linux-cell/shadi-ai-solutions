-- Phase: Patient Booking Portal — Service Catalog
-- Purpose: Add a tenant-scoped service catalog for public booking.
-- This migration is idempotent and can be safely re-run.

-- =====================================================
-- 1. clinic_services table
-- =====================================================
CREATE TABLE IF NOT EXISTS public.clinic_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id uuid NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  price numeric(10,2),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_clinic_services_clinic_id ON public.clinic_services(clinic_id);
CREATE INDEX IF NOT EXISTS idx_clinic_services_active ON public.clinic_services(clinic_id, active);

-- =====================================================
-- 2. RLS for clinic_services
-- =====================================================
ALTER TABLE public.clinic_services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic services can be accessed by clinic members" ON public.clinic_services;
CREATE POLICY "Clinic services can be accessed by clinic members"
  ON public.clinic_services FOR SELECT
  USING (public.app_user_is_active_clinic_member(clinic_id));

DROP POLICY IF EXISTS "Clinic services can be managed by active clinic members" ON public.clinic_services;
CREATE POLICY "Clinic services can be managed by active clinic members"
  ON public.clinic_services FOR ALL
  USING (public.app_user_is_active_clinic_member(clinic_id))
  WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

-- =====================================================
-- 3. Trigger for updated_at
-- =====================================================
DROP TRIGGER IF EXISTS set_updated_at_clinic_services ON public.clinic_services;
CREATE TRIGGER set_updated_at_clinic_services
  BEFORE UPDATE ON public.clinic_services
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================
-- End of migration
-- =====================================================