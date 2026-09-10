-- ============================================================================
-- STEP 15G-FIX — BILLING PLANS LIMITS CANONICALIZATION
-- APPROVED owner matrix (2026-08-31): canonical entitlement keys only:
--   ai_messages, bookings, patients, providers, users, knowledge_docs, conversations
--
-- Why: the 15B seed (20260830) stored legacy keys (max_patients /
-- ai_messages_per_day / max_documents / max_team / max_clinics) that
-- lib/subscription/entitlements.ts ignores (canonical keys only), so every plan
-- silently resolved to Starter fallback limits. This fixes the source of truth.
--
-- ADDITIVE + IDEMPOTENT. Does NOT modify historical migrations, does NOT touch
-- subscriptions / RLS / Stripe prices / webhook / tenant data. Legacy values are
-- PRESERVED into metadata.legacy_limits (nothing deleted, a single time only).
-- A DB-level CHECK constraint rejects any future legacy / unknown key so the
-- bug cannot return.
-- ============================================================================

-- 0) Immutable helper backing the CHECK constraint. Postgres CHECK constraints
--    may not contain subqueries, so classification lives in a pure SQL function.
create or replace function public.billing_plans_limits_keys_valid(p_limits jsonb)
returns boolean
language sql
immutable
as $$
  select not exists (
    select 1
    from jsonb_object_keys(p_limits) as k
    where k not in (
      'ai_messages', 'bookings', 'patients', 'providers', 'users',
      'knowledge_docs', 'conversations'
    )
  )
$$;

-- 1) Preserve the existing (legacy) limits for audit/safety before overwriting.
--    Only once (idempotent): never clobbers a previously preserved value.
do $$
begin
  update public.billing_plans
     set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('legacy_limits', limits)
   where plan_id in ('free_trial', 'starter', 'founding', 'growth', 'pro')
     and limits is not null
     and limits <> '{}'::jsonb
     and not coalesce(metadata, '{}'::jsonb) ? 'legacy_limits';
end $$;

-- 2) Set the canonical limits per the approved owner matrix.
-- free_trial: 5 AI msgs / 50 bookings / 5 patients / 2 providers / 2 users / 5 docs / unlimited conversations
update public.billing_plans set limits =
  '{"ai_messages":5,"bookings":50,"patients":5,"providers":2,"users":2,"knowledge_docs":5,"conversations":null}'::jsonb
  where plan_id = 'free_trial';

-- starter: 100 AI msgs / 50 bookings / unlimited patients / 2 providers / 2 users / 3 docs / unlimited conversations
update public.billing_plans set limits =
  '{"ai_messages":100,"bookings":50,"patients":null,"providers":2,"users":2,"knowledge_docs":3,"conversations":null}'::jsonb
  where plan_id = 'starter';

-- growth AND founding (founding officially inherits growth limits entirely):
-- unlimited everywhere except users = 10
update public.billing_plans set limits =
  '{"ai_messages":null,"bookings":null,"patients":null,"providers":null,"users":10,"knowledge_docs":null,"conversations":null}'::jsonb
  where plan_id in ('growth', 'founding');

-- pro: all resources unlimited (null)
update public.billing_plans set limits =
  '{"ai_messages":null,"bookings":null,"patients":null,"providers":null,"users":null,"knowledge_docs":null,"conversations":null}'::jsonb
  where plan_id = 'pro';

-- 3) DB-level regression guard: only canonical keys may ever live in limits.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'billing_plans_limits_only_canonical_keys'
  ) then
    alter table public.billing_plans
      add constraint billing_plans_limits_only_canonical_keys
      check (limits is null or public.billing_plans_limits_keys_valid(limits));
  end if;
end $$;