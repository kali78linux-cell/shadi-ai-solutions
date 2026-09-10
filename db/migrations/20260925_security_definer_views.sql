-- ============================================================================
-- 20260925_security_definer_views.sql
-- SECURITY FIX — Supabase Advisor Critical: SECURITY DEFINER VIEWS
--   public.daily_cash_positions
--   public.provider_revenue
--
-- Root cause: these two views had NO `security_invoker=true` reloption, so in
-- PostgreSQL they executed with the privileges of their OWNER (postgres) —
-- i.e. they bypassed RLS → any caller with SELECT on the view could see ALL
-- tenants' cash positions / provider revenue. The rest of the platform's
-- public financial views already use `WITH (security_invoker=true)`.
--
-- Fix (correct PostgreSQL 17 mechanism, minimal & non-destructive):
--   * do NOT drop/recreate the views (business logic preserved verbatim).
--   * ALTER ... SET (security_invoker=true) — PostgreSQL ≥15 supports this
--     on existing views; the underlying RLS (RLS=ON on all underlying tables)
--     then applies per-caller. The ONLY internal callers are service-role
--     (lib/services/accounting.ts · financialIntelligence.ts · payroll.ts),
--     which bypass RLS anyway → financial semantics unchanged for authorized
--     service users, while cross-tenant exposure via the view is closed.
--
-- SAFE / IDEMPOTENT / TRANSACTIONAL. No data changes of any kind.
-- ============================================================================

begin;

alter view public.daily_cash_positions set (security_invoker = true);
alter view public.provider_revenue set (security_invoker = true);

-- Verify + fail loudly if the option is not applied (so apply-migration
-- tooling surfaces any surprise instead of silently passing).
do $$
declare
  v record;
begin
  for v in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'v'
       and c.relname in ('daily_cash_positions', 'provider_revenue')
  loop
    if not exists (
      select 1
        from pg_class c2
        join pg_namespace n2 on n2.oid = c2.relnamespace
       where n2.nspname = 'public'
         and c2.relname = v.relname
         and coalesce(c2.reloptions, '{}'::text[])::text like '%security_invoker=true%'
    ) then
      raise exception 'security_invoker not applied to %', v.relname;
    end if;
  end loop;
end $$;

commit;

-- REVERSIBILITY (documented; NOT executed):
--   alter view public.daily_cash_positions reset (security_invoker);
--   alter view public.provider_revenue reset (security_invoker);
-- ----------------------------------------------------------------------------