-- 20260834_subscription_write_service_only.sql
-- STEP 15E/G3 — Prevent paid-plan self-grant through the REST/anon surface.
--
-- The existing member-write policies (INSERT/UPDATE/DELETE) allow any active
-- clinic member to create/modify/delete a subscription row directly. Subscriptions
-- must only be written server-side (checkout/webhook) via the service role, which
-- bypasses RLS. SELECT for clinic members is preserved (read stays allowed);
-- writes are service/super-admin only.
--
-- ADDITIVE, rollback-safe: ROLLBACK = re-create the dropped member-write policies
-- (DROP POLICY subscriptions_write_service_only; then the original 3 policies).
-- Does not touch a single subscription row.

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Clinic subscriptions can be managed by active clinic members" ON public.subscriptions;
DROP POLICY IF EXISTS "Clinic subscriptions can be updated by active clinic members" ON public.subscriptions;
DROP POLICY IF EXISTS "Clinic subscriptions can be deleted by active clinic members" ON public.subscriptions;

DROP POLICY IF EXISTS "subscriptions_write_service_only" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_write_service_only_update" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_write_service_only_delete" ON public.subscriptions;

-- Service/super-admin only for ALL writes (INSERT/UPDATE/DELETE). SELECT for
-- members remains via the existing "Clinic subscriptions can be accessed by
-- clinic members" policy (not dropped).
CREATE POLICY "subscriptions_write_service_only" ON public.subscriptions
  FOR INSERT TO anon, authenticated
  WITH CHECK (app_is_super_admin());

CREATE POLICY "subscriptions_write_service_only_update" ON public.subscriptions
  FOR UPDATE TO anon, authenticated
  USING (app_is_super_admin())
  WITH CHECK (app_is_super_admin());

CREATE POLICY "subscriptions_write_service_only_delete" ON public.subscriptions
  FOR DELETE TO anon, authenticated
  USING (app_is_super_admin());