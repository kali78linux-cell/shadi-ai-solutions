-- ============================================================================
-- 20260830_billing_plans.sql  (STEP 15B — Subscription Source of Truth)
--
-- ADDITIVE / BACKWARD-COMPATIBLE / REVERSIBLE. Does NOT touch or modify:
--   * subscriptions rows (clinic billing state) — untouched
--   * patients / appointments / any clinic-scoped data — untouched
--   * the `plan_id` semantics on subscriptions (still TEXT, same values)
--
-- Adds a read-only (service-role-only) CATALOG table `billing_plans` that becomes
-- the official source of truth for plan metadata (name, currency, monthly price,
-- billing interval, Stripe price id, trial days, features, limits, metadata).
-- The static list in lib/subscription/plans.ts remains as a harmless fallback so
-- nothing breaks if this migration has not been applied yet.
--
-- RLS: only the service role may read this table (no anon/authenticated REST read),
-- so internal fields (stripe_price_id, metadata, limits) are never exposed.
-- ============================================================================

create table if not exists public.billing_plans (
  plan_id          text primary key,
  name             text not null,
  name_en          text not null,
  currency         text not null default 'ils',
  price_per_month  integer not null default 0,          -- minor units of currency
  billing_interval text not null default 'month',        -- 'month' | 'year' | 'trial'
  trial_days       integer,
  stripe_price_id  text,                                 -- real Stripe Price ID (ILS); NULL for free plans
  is_active        boolean not null default true,
  is_public        boolean not null default true,
  display_order    integer not null default 0,
  features         jsonb not null default '[]'::jsonb,
  limits           jsonb not null default '{}'::jsonb,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_billing_plans_active
  on public.billing_plans (is_active)
  where is_active = true;

create index if not exists idx_billing_plans_order
  on public.billing_plans (display_order);

-- Seed the official catalog (idempotent; the canonical five plans).
insert into public.billing_plans
  (plan_id, name, name_en, currency, price_per_month, billing_interval, trial_days,
   stripe_price_id, is_active, is_public, display_order, features, limits, metadata)
values
  ('free_trial', 'تجربة مجانية', 'Free Trial', 'ils', 0, 'trial', 14, null, true, true, 0,
   '["1 عيادة","حتى 5 مرضى","5 محادثات AI/يوم","قاعدة معرفة أساسية"]'::jsonb,
   '{"max_patients":5,"ai_messages_per_day":5,"max_documents":5}'::jsonb,
   '{"trial":true}'::jsonb),
  ('starter', 'الباقة الابتدائية', 'Starter', 'ils', 0, 'month', null, null, true, true, 10,
   '["1 عيادة","مرضى غير محدود","محادثات AI غير محدودة","قاعدة معرفة + تقارير"]'::jsonb,
   '{}'::jsonb,
   '{}'::jsonb),
  ('founding', 'باقة التأسيس', 'Founding', 'ils', 5000, 'month', null,
   'price_1UA8DpPqB6gWlT7hUQLUAvrq', true, true, 20,
   '["سعر تأسيس ثابت مدى الحياة","كل مزايا باقة النمو","أولوية الدعم التأسيسي"]'::jsonb,
   '{}'::jsonb,
   '{"founding":true}'::jsonb),
  ('growth', 'النمو', 'Growth', 'ils', 12000, 'month', null,
   'price_1UA8DqPqB6gWlT7hQFspRPG4', true, true, 30,
   '["3 عيادات","مرضى غير محدود","فريق حتى 10 أعضاء","إشعارات واتساب/رسائل"]'::jsonb,
   '{"max_clinics":3,"max_team":10}'::jsonb,
   '{}'::jsonb),
  ('pro', 'الاحترافية', 'Pro', 'ils', 30000, 'month', null,
   'price_1UA8DqPqB6gWlT7hcri1xyoG', true, true, 40,
   '["عيادات غير محدودة","فريق غير محدود","تقارير متقدمة","أولوية الدعم"]'::jsonb,
   '{}'::jsonb,
   '{}'::jsonb)
on conflict (plan_id) do nothing;

-- RLS: catalog is configuration, readable/modifiable ONLY via the service role.
alter table public.billing_plans enable row level security;

drop policy if exists "billing_plans service-role only" on public.billing_plans;
create policy "billing_plans service-role only"
  on public.billing_plans
  for all
  using (app_is_super_admin())
  with check (app_is_super_admin());

-- Updated-at trigger (consistent with every other table).
drop trigger if exists set_updated_at_billing_plans on public.billing_plans;
create trigger set_updated_at_billing_plans
  before update on public.billing_plans
  for each row execute function public.set_updated_at();