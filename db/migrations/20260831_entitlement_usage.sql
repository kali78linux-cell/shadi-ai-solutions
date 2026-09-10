-- ============================================================================
-- 20260831_entitlement_usage.sql  (STEP 15C — Entitlements Foundation)
--
-- ADDITIVE / BACKWARD-COMPATIBLE / REVERSIBLE. Does NOT touch or modify:
--   * billing_plans (source of truth, 15B) — read-only for the app
--   * subscriptions rows — untouched
--   * patients / appointments / any clinic-scoped data — untouched
--
-- Adds:
--   1) public.entitlement_usage — per-clinic, per-resource, per-calendar-month
--      (UTC) usage counters. Rows are created LAZILY on first real usage; no
--      production rows are pre-created.
--   2) public.check_and_increment_entitlement() — atomic SECURITY DEFINER
--      check-and-increment (race-safe). A negative increment is a compensating
--      "release" used when the guarded write ultimately fails (failed writes
--      are never counted), clamped at zero.
--
-- RLS: service-role only (same posture as billing_plans) — the anon/
-- authenticated REST surface sees zero rows. All reads/writes happen
-- server-side via the service client.
-- ============================================================================

create table if not exists public.entitlement_usage (
  id           uuid not null default gen_random_uuid() primary key,
  clinic_id    uuid not null references public.clinics (id) on delete cascade,
  resource     text not null, -- ai_messages | bookings | patients | providers | users | knowledge_docs | conversations
  period_start date not null, -- first day of the calendar month (UTC)
  used_count   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (clinic_id, resource, period_start)
);

create index if not exists idx_entitlement_usage_clinic_resource_period
  on public.entitlement_usage (clinic_id, resource, period_start);

-- Atomic check-and-increment (or release when p_increment < 0).
create or replace function public.check_and_increment_entitlement(
  p_clinic_id uuid,
  p_resource  text,
  p_limit     integer,
  p_increment integer default 1
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', now())::date;
  v_used   integer;
begin
  -- Compensating release path (failed write): never counted, never below zero.
  if p_increment < 0 then
    update public.entitlement_usage
       set used_count = greatest(0, used_count + p_increment),
           updated_at = now()
     where clinic_id = p_clinic_id
       and resource  = p_resource
       and period_start = v_period;
    if not found then
      insert into public.entitlement_usage (clinic_id, resource, period_start, used_count)
      values (p_clinic_id, p_resource, v_period, 0)
      on conflict (clinic_id, resource, period_start) do nothing;
    end if;
    return json_build_object('allowed', true, 'released', true);
  end if;

  -- Lazy counter creation on first real usage of the period.
  insert into public.entitlement_usage (clinic_id, resource, period_start, used_count)
  values (p_clinic_id, p_resource, v_period, 0)
  on conflict (clinic_id, resource, period_start) do nothing;

  -- Row lock: concurrent requests for the same clinic/resource serialize here.
  select used_count into v_used
    from public.entitlement_usage
   where clinic_id = p_clinic_id
     and resource  = p_resource
     and period_start = v_period
   for update;

  if p_limit is null or v_used + p_increment <= p_limit then
    update public.entitlement_usage
       set used_count = used_count + p_increment,
           updated_at = now()
     where clinic_id = p_clinic_id
       and resource  = p_resource
       and period_start = v_period;
    return json_build_object(
      'allowed', true,
      'used', v_used + p_increment,
      'limit', p_limit,
      'remaining', case when p_limit is null then null else p_limit - (v_used + p_increment) end
    );
  end if;

  return json_build_object('allowed', false, 'used', v_used, 'limit', p_limit, 'remaining', 0);
end;
$$;

-- RLS: usage counters are internal; readable ONLY via the service role.
alter table public.entitlement_usage enable row level security;

drop policy if exists "entitlement_usage service-role only" on public.entitlement_usage;
create policy "entitlement_usage service-role only"
  on public.entitlement_usage
  for all
  using (app_is_super_admin())
  with check (app_is_super_admin());

-- Updated-at trigger (consistent with every other table).
drop trigger if exists set_updated_at_entitlement_usage on public.entitlement_usage;
create trigger set_updated_at_entitlement_usage
  before update on public.entitlement_usage
  for each row execute function public.set_updated_at();