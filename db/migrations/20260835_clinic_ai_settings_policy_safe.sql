-- 20260835_clinic_ai_settings_policy_safe.sql
-- STEP 15E/G3 — Unify clinic_ai_settings RLS on the *_safe helper.
--
-- The policy previously used app_user_is_active_clinic_member(clinic_id) (the
-- legacy non-safe variant). Every other tenant-scoped table uses the *_safe
-- helper (20260816_fix_recursive_rls) to avoid RLS recursion. This recreates
-- the policy with the safe helper + super-admin, matching the rest of the schema.
--
-- ADDITIVE, rollback-safe. Does not touch clinic_ai_settings rows.

ALTER TABLE public.clinic_ai_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "clinic_ai_settings_policy" ON public.clinic_ai_settings;

CREATE POLICY "clinic_ai_settings_policy" ON public.clinic_ai_settings
  FOR ALL TO anon, authenticated
  USING (app_is_super_admin() OR app_user_is_active_clinic_member_safe(clinic_id))
  WITH CHECK (app_is_super_admin() OR app_user_is_active_clinic_member_safe(clinic_id));