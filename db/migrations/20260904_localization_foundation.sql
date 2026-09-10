-- ============================================================================
-- 20260904_localization_foundation.sql — Localization Foundation
-- country_profiles + clinic_settings (timezone/currency/locale/date/number/
-- fiscal_year) + clinic_invoices.currency snapshot (D-L1) + validated
-- timezone (D-L2) + clinic-local business dates (D-L3) + formatting config
-- (D-L4) + fiscal_year config (D-L5).
--
-- ADDITIVE / BACKWARD-COMPATIBLE / IDEMPOTENT (safe to re-run).
-- Historical migrations are NOT modified: this file only creates new tables,
-- adds new columns/constraints, and re-creates two derived/reporting objects
-- (daily_cash_positions view + check_and_increment_entitlement function)
-- with the SAME signatures/columns — reporting-boundary changes only, no
-- ledger history change, no financial amount change.
--
-- Encoded owner decisions:
--   * D-L1 — clinic_invoices.currency: additive nullable snapshot column set
--     at issuance from clinic_settings.currency (issue_invoice writes it and
--     returns it; existing invoices keep NULL — no data rewrite).
--   * D-L2 — clinic_settings.timezone is the validated source of truth
--     (DB CHECK guarantees IANA validity via pg_timezone_names). Legacy
--     clinics.settings.timezone remains a compatibility mirror; readers
--     prefer clinic_settings and fall back to the legacy key when the new
--     table lacks a row (transition phase, nothing breaks).
--   * D-L3 — ledger timestamps stay UTC (timestamptz). Only DERIVED
--     business-date grouping becomes clinic-local:
--       - daily_cash_positions.business_date = occurred_at at time zone
--         clinic timezone (fallback UTC)
--       - entitlement_usage.period_start = first day of the clinic-local
--         month (fallback UTC)
--   * D-L4 — locale/date/number/currency formats are CONFIGURATION here;
--     formatting is centralized in the app layer (lib/clinic/formatting.ts).
--     No full i18n framework (D7).
--   * D-L5 — clinic_settings.fiscal_year = 'calendar' default; start
--     month/day columns make the structure ready; no custom-year logic is
--     enabled — current behavior (calendar year invoice numbering) is
--     preserved until a future owner decision.
--   * Platform Billing (billing_plans/subscriptions/Stripe) is NEVER mixed
--     with clinic settings — platform currency stays separate.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) IANA timezone validator (DB-level guarantee for clinic_settings).
-- ---------------------------------------------------------------------------
create or replace function public.is_valid_iana_timezone(p_tz text)
returns boolean
language plpgsql
stable
set search_path = public
as $$
begin
  if p_tz is null then return true; end if;
  perform 1 from pg_timezone_names where name = p_tz limit 1;
  return found;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) country_profiles — catalog of supported markets (D3). Currency stays
--    single-currency per clinic; this is CONFIG, not a payments table.
-- ---------------------------------------------------------------------------
create table if not exists public.country_profiles (
  code            text primary key check (code ~ '^[A-Z]{2}$'),
  name            text not null,
  name_ar         text not null,
  currency        text not null check (currency ~ '^[A-Z]{3}$'),
  locale          text not null default 'ar-PS',
  default_timezone text not null check (public.is_valid_iana_timezone(default_timezone)),
  date_format     text not null default 'YYYY-MM-DD',
  number_format   text not null default 'en' check (number_format in ('en', 'ar')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Truncate first to ensure clean state (handles partial prior runs with lowercase currency).
truncate public.country_profiles;
insert into public.country_profiles
  (code, name, name_ar, currency, locale, default_timezone, date_format, number_format)
values
  ('PS', 'Palestine', 'فلسطين', 'ILS', 'ar-PS', 'Asia/Jerusalem', 'YYYY-MM-DD', 'en'),
  ('JO', 'Jordan', 'الأردن', 'JOD', 'ar-JO', 'Asia/Amman', 'YYYY-MM-DD', 'en'),
  ('SA', 'Saudi Arabia', 'السعودية', 'SAR', 'ar-SA', 'Asia/Riyadh', 'YYYY-MM-DD', 'en'),
  ('KW', 'Kuwait', 'الكويت', 'KWD', 'ar-KW', 'Asia/Kuwait', 'YYYY-MM-DD', 'en'),
  ('AE', 'United Arab Emirates', 'الإمارات', 'AED', 'ar-AE', 'Asia/Dubai', 'YYYY-MM-DD', 'en');
-- ---------------------------------------------------------------------------
-- 3) clinic_settings — validated per-clinic localization source of truth.
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_settings (
  clinic_id                uuid primary key references public.clinics (id) on delete cascade,
  currency                 text not null default 'ILS' check (currency ~ '^[A-Z]{3}$'),
  timezone                 text not null default 'UTC' check (public.is_valid_iana_timezone(timezone)),
  locale                   text not null default 'ar' check (locale in ('ar', 'en')),
  date_format              text not null default 'YYYY-MM-DD',
  number_format            text not null default 'en' check (number_format in ('en', 'ar')),
  fiscal_year              text not null default 'calendar' check (fiscal_year in ('calendar', 'custom')),
  -- Structure readiness for custom fiscal years (D-L5); not yet used.
  fiscal_year_start_month  int check (fiscal_year_start_month is null or (fiscal_year_start_month between 1 and 12)),
  fiscal_year_start_day    int check (fiscal_year_start_day is null or (fiscal_year_start_day between 1 and 31)),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4) clinic_invoices.currency — D-L1 additive snapshot (nullable; existing
--    rows keep NULL; new invoices are stamped at issuance in issue_invoice).
-- ---------------------------------------------------------------------------
alter table public.clinic_invoices
  add column if not exists currency text;

do $$
begin
  alter table public.clinic_invoices
    add constraint clinic_invoices_currency_check
    check (currency is null or currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 5) Backfill clinic_settings for EXISTING clinics from the legacy
--    clinics.settings JSONB (D-L2 transition: never break existing data).
--    timezone is validated via the IANA helper; invalid/missing → 'UTC'.
--    currency is derived from country (name→known market mapping, then
--    country_profiles join); unknown/missing country → platform launch
--    currency 'ils'.
-- ---------------------------------------------------------------------------
insert into public.clinic_settings (clinic_id, currency, timezone, locale, date_format, number_format, fiscal_year)
select
  c.id,
  coalesce(
    cp.currency,
    case
      when c.settings->>'country' in ('Palestine', 'فلسطين', 'PS')   then 'ILS'
      when c.settings->>'country' in ('Jordan', 'الأردن', 'JO')      then 'JOD'
      when c.settings->>'country' in ('Saudi Arabia', 'السعودية', 'SA') then 'SAR'
      when c.settings->>'country' in ('Kuwait', 'الكويت', 'KW')       then 'KWD'
      when c.settings->>'country' in ('UAE', 'United Arab Emirates', 'الإمارات', 'AE') then 'AED'
      else 'ILS'
    end
  ) as currency,
  coalesce(
    case
      when public.is_valid_iana_timezone(c.settings->>'timezone') then c.settings->>'timezone'
      else null
    end,
    'UTC'
  ) as timezone,
  'ar' as locale,
  'YYYY-MM-DD' as date_format,
  'en' as number_format,
  'calendar' as fiscal_year
from public.clinics c
left join public.country_profiles cp
  on cp.code = case
    when c.settings->>'country' in ('Palestine', 'فلسطين', 'PS')   then 'PS'
    when c.settings->>'country' in ('Jordan', 'الأردن', 'JO')      then 'JO'
    when c.settings->>'country' in ('Saudi Arabia', 'السعودية', 'SA') then 'SA'
    when c.settings->>'country' in ('Kuwait', 'الكويت', 'KW')       then 'KW'
    when c.settings->>'country' in ('UAE', 'United Arab Emirates', 'الإمارات', 'AE') then 'AE'
    else null
  end
where c.deleted_at is null
on conflict (clinic_id) do nothing;
-- ---------------------------------------------------------------------------
-- 6) RLS — service-role only (same posture as billing_plans/entitlement_usage;
--    the anon/authenticated REST surface sees zero rows safely).
-- ---------------------------------------------------------------------------
alter table public.country_profiles enable row level security;
alter table public.clinic_settings   enable row level security;

drop policy if exists "country_profiles service-role only" on public.country_profiles;
create policy "country_profiles service-role only"
  on public.country_profiles
  for all
  using (app_is_super_admin())
  with check (app_is_super_admin());

drop policy if exists "clinic_settings service-role only" on public.clinic_settings;
create policy "clinic_settings service-role only"
  on public.clinic_settings
  for all
  using (app_is_super_admin())
  with check (app_is_super_admin());

-- ---------------------------------------------------------------------------
-- 7) issue_invoice — D-L1: stamp the clinical currency snapshot at issuance.
--    Same signature (phase B, backward compatible), no new overload; the
--    currency is read from clinic_settings at creation time (fallback 'ils').
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(
  p_clinic_id      uuid,
  p_patient_id     uuid,
  p_appointment_id uuid,
  p_items          jsonb,
  p_discount       numeric,
  p_tax            numeric,
  p_notes          text,
  p_due_at         timestamptz,
  p_created_by     uuid,
  p_payer_type     text default null,
  p_payer_ref      uuid default null
) returns jsonb
language plpgsql as $$
declare
  v_invoice_id uuid;
  v_number     text;
  v_year       int := extract(year from now())::int;
  v_seq        bigint;
  v_subtotal   numeric(12,2) := 0;
  v_total      numeric(12,2);
  v_item       jsonb;
  v_qty        numeric;
  v_price      numeric;
  v_line       numeric(12,2);
  v_svc        uuid;
  v_provider   uuid;
  v_desc       text;
  v_currency   text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'INVOICE_ITEMS_REQUIRED';
  end if;
  if p_payer_type is not null
     and p_payer_type not in ('patient', 'insurance', 'employer', 'third_party') then
    raise exception 'INVALID_PAYER_TYPE';
  end if;

  -- D-L1: currency snapshot from clinic_settings at issuance; safe fallback.
  select coalesce(cs.currency, 'ils') into v_currency
    from public.clinic_settings cs
   where cs.clinic_id = p_clinic_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty   := coalesce((v_item->>'quantity')::numeric, 1);
    v_price := (v_item->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
    if v_price is null or v_price < 0 then raise exception 'INVALID_UNIT_PRICE'; end if;
    v_line := round(v_qty * v_price, 2);
    if v_line is null then raise exception 'ITEM_LINE_INVALID'; end if;
    v_subtotal := v_subtotal + v_line;
  end loop;
  v_subtotal := round(v_subtotal, 2);
  v_total := round(v_subtotal - coalesce(p_discount, 0) + coalesce(p_tax, 0), 2);
  if v_total < 0 then raise exception 'INVOICE_TOTAL_NEGATIVE'; end if;

  v_seq := public.next_clinic_sequence(p_clinic_id, 'invoice', v_year);
  v_number := format('INV-%s-%s', v_year, lpad(v_seq::text, 6, '0'));

  insert into public.clinic_invoices
    (clinic_id, patient_id, appointment_id, invoice_number, status,
     subtotal, discount, tax, total, notes, due_at, currency, payer_type, payer_ref, created_by)
  values
    (p_clinic_id, p_patient_id, p_appointment_id, v_number, 'issued',
     v_subtotal, coalesce(p_discount, 0), coalesce(p_tax, 0), v_total,
     p_notes, p_due_at, v_currency, p_payer_type, p_payer_ref, p_created_by)
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty      := coalesce((v_item->>'quantity')::numeric, 1);
    v_price    := (v_item->>'unit_price')::numeric;
    v_svc      := nullif(v_item->>'service_id', '')::uuid;
    v_provider := nullif(v_item->>'provider_id', '')::uuid;
    if v_provider is not null then
      if not exists (
        select 1 from public.providers
        where clinic_id = p_clinic_id and id = v_provider) then
        raise exception 'PROVIDER_NOT_FOUND';
      end if;
    end if;
    v_desc := coalesce(nullif(v_item->>'description', ''), nullif(v_item->>'service', ''));
    if v_desc is null then raise exception 'ITEM_DESCRIPTION_REQUIRED'; end if;
    v_line := round(v_qty * v_price, 2);
    insert into public.invoice_items
      (clinic_id, invoice_id, service_id, provider_id, description, quantity, unit_price, line_total)
    values
      (p_clinic_id, v_invoice_id, v_svc, v_provider, v_desc, v_qty, v_price, v_line);
  end loop;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'invoice_issued:' || v_invoice_id::text, 'invoice_issued',
     'clinic_invoices', v_invoice_id, 'in', v_total, p_created_by,
     jsonb_build_object('invoice_number', v_number, 'subtotal', v_subtotal,
                        'total', v_total, 'currency', v_currency,
                        'payer_type', p_payer_type, 'payer_ref', p_payer_ref));

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_number,
                            'subtotal', v_subtotal, 'total', v_total, 'currency', v_currency);
end;
$$;
-- ---------------------------------------------------------------------------
-- 8) daily_cash_positions — re-created with CLINIC-local business dates
--    (D-L3). Output columns unchanged (clinic_id, business_date, cash_in,
--    cash_out, net_cash). Source stays the EXPLICIT ledger kinds filtered by
--    method='cash' — direction is never a cash signal (D4). The timezone is
--    the clinic_settings value (fallback UTC) — legacy clinics.settings is
--    backfilled into clinic_settings above, so the lookups are authoritative.
-- ---------------------------------------------------------------------------
drop view if exists public.daily_cash_positions;

create view public.daily_cash_positions as
with ev as (
  select ft.clinic_id, ft.event_type, ft.ref_id, ft.amount, ft.occurred_at
  from public.financial_transactions ft
  where ft.event_type in ('payment_recorded', 'refund_recorded', 'expense_recorded')
),
cash_pay as (
  select ev.clinic_id,
         (ev.occurred_at at time zone coalesce(cs.timezone, 'UTC'))::date as business_date,
         ev.event_type,
         ev.amount
  from ev
  join public.clinic_payments p
    on p.id = ev.ref_id and p.clinic_id = ev.clinic_id
  left join public.clinic_settings cs
    on cs.clinic_id = ev.clinic_id
  where p.status = 'recorded' and p.method = 'cash'
),
cash_exp as (
  select ev.clinic_id,
         (ev.occurred_at at time zone coalesce(cs.timezone, 'UTC'))::date as business_date,
         ev.amount
  from ev
  join public.clinic_expenses e
    on e.id = ev.ref_id and e.clinic_id = ev.clinic_id
  left join public.clinic_settings cs
    on cs.clinic_id = ev.clinic_id
  where e.status = 'recorded' and e.method = 'cash'
),
pay_days as (
  select clinic_id, business_date,
         sum(case when event_type = 'payment_recorded' then amount else 0 end) as cash_in,
         sum(case when event_type = 'refund_recorded' then amount else 0 end) as cash_out_refunds
  from cash_pay
  group by 1, 2
),
exp_days as (
  select clinic_id, business_date, sum(amount) as cash_out_expenses
  from cash_exp
  group by 1, 2
)
select
  coalesce(p.clinic_id, x.clinic_id)         as clinic_id,
  coalesce(p.business_date, x.business_date) as business_date,
  coalesce(p.cash_in, 0)                     as cash_in,
  coalesce(p.cash_out_refunds, 0) + coalesce(x.cash_out_expenses, 0) as cash_out,
  coalesce(p.cash_in, 0) - coalesce(p.cash_out_refunds, 0)
    - coalesce(x.cash_out_expenses, 0)       as net_cash
from pay_days p
full outer join exp_days x
  on x.clinic_id = p.clinic_id and x.business_date = p.business_date;

-- ---------------------------------------------------------------------------
-- 9) check_and_increment_entitlement — re-created (same signature) to compute
--    period_start in the CLINIC-local month (D-L3). Lazy rows are created per
--    clinic-local month; existing usage rows are untouched (reporting-boundary
--    change only). UTC is the documented fallback when no clinic_settings row.
-- ---------------------------------------------------------------------------
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
  v_period date := date_trunc(
    'month',
    (now() at time zone coalesce(
      (select cs.timezone from public.clinic_settings cs where cs.clinic_id = p_clinic_id),
      'UTC'
    ))::timestamp
  )::date;
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

-- ============================================================================
-- END — Localization Foundation. No historical migration touched; no platform
-- billing change; ledger history/amounts untouched (reporting boundaries only).
-- ============================================================================