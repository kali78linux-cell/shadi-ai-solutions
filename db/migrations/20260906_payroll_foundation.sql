-- ============================================================================
-- 20260906_payroll_foundation.sql — Payroll Foundation (D8: provider
-- attribution) — per approved decisions D-P1 / D-P2 / D-P3.
--
-- clinic_provider_compensations (CONFIGURATION ONLY, effective-dated) +
-- provider_revenue (derived read-only view over the Phase B attribution
-- columns). This is the FOUNDATION, not a payroll engine.
--
-- Encoded owner decisions:
--   * D-P1 — compensation models: 'commission_percentage' | 'fixed_monthly'
--     | 'hybrid'. Configuration only — NO salary/commission calculation,
--     NO payroll runs, NO payslips in this phase.
--   * D-P2 — provider revenue attribution base: 'issued' is the ONLY value
--     in this phase (issued non-voided invoice revenue). The
--     attribution_base column is future-proofed additively (new values may
--     be added later via a CHECK migration) — no calculation engine now.
--   * D-P3 — visibility: FINANCE gates only (FINANCE_ADMIN_ROLES /
--     FINANCE_READ_ROLES). No DATA_ROLES change; no doctor self-visibility.
--
-- Out of scope (owner-mandated): salary/commission calculation, payroll
-- runs, payslips, deductions, taxes, social security, advances, attendance,
-- HR, country-specific rules, integrations, financial reporting, AI, and
-- the `payroll_run`/`payslip_recorded` ledger kinds (they stay FUTURE in the
-- D4 dictionary).
--
-- No historical migration touched. Additive only. No ledger change.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) clinic_provider_compensations — per-provider compensation CONFIGURATION
--    (effective-dated; exactly one ACTIVE config per provider; deactivate →
--    status='ended', never deleted).
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_provider_compensations (
  id                  uuid primary key default gen_random_uuid(),
  clinic_id           uuid not null references public.clinics (id) on delete cascade,
  provider_id         uuid not null,
  model               text not null
                      check (model in ('commission_percentage', 'fixed_monthly', 'hybrid')),
  commission_percent  numeric(5,2),
  fixed_monthly_amount numeric(12,2),
  attribution_base    text not null default 'issued' check (attribution_base in ('issued')),
  effective_from      date not null,
  effective_to        date check (effective_to is null or effective_to >= effective_from),
  status              text not null default 'active' check (status in ('active', 'ended')),
  notes               text default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- D-P1: fields must match the chosen model (configuration consistency).
  check (
       (model = 'commission_percentage' and commission_percent is not null and fixed_monthly_amount is null)
    or (model = 'fixed_monthly'        and fixed_monthly_amount is not null and commission_percent is null)
    or (model = 'hybrid'               and commission_percent is not null and fixed_monthly_amount is not null)
  ),
  check (commission_percent is null or (commission_percent >= 0 and commission_percent <= 100)),
  check (fixed_monthly_amount is null or fixed_monthly_amount >= 0),
  foreign key (clinic_id, provider_id) references public.providers (clinic_id, id) on delete restrict,
  unique (clinic_id, id)
);

-- Exactly ONE active compensation config per provider (config sanity).
create unique index if not exists clinic_provider_compensations_one_active
  on public.clinic_provider_compensations (clinic_id, provider_id)
  where status = 'active';

create index if not exists clinic_provider_compensations_clinic_provider_idx
  on public.clinic_provider_compensations (clinic_id, provider_id);

-- ---------------------------------------------------------------------------
-- 2) Guards — append-only posture: DELETE blocked, clinic_id immutable
--    (same pattern as payers/coverages/claims guards).
-- ---------------------------------------------------------------------------
create or replace function public.payroll_compensations_guard_del() returns trigger
language plpgsql as $$
begin
  raise exception 'PAYROLL_CONFIG_IMMUTABLE';
end;
$$;

create or replace function public.payroll_compensations_guard_upd() returns trigger
language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'PAYROLL_CONFIG_TENANT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_provider_compensations_guard_delete on public.clinic_provider_compensations;
create trigger clinic_provider_compensations_guard_delete
  before delete on public.clinic_provider_compensations
  for each row execute function public.payroll_compensations_guard_del();

drop trigger if exists clinic_provider_compensations_guard_update on public.clinic_provider_compensations;
create trigger clinic_provider_compensations_guard_update
  before update on public.clinic_provider_compensations
  for each row execute function public.payroll_compensations_guard_upd();

-- ---------------------------------------------------------------------------
-- 3) provider_revenue — DERIVED, read-only view over the Phase B attribution
--    columns. Never stores balances; never touches ledger history.
--    Base (D-P2): 'issued' — non-voided invoice revenue attributed via
--    invoice_items.provider_id, grouped per provider per clinic-local month
--    (D-L3 timezone from clinic_settings, fallback UTC).
-- ---------------------------------------------------------------------------
create view public.provider_revenue as
with cfg as (
  select c.id as clinic_id,
         coalesce(cs.timezone, 'UTC') as tz
    from public.clinics c
    left join public.clinic_settings cs on cs.clinic_id = c.id
)
select
  ii.clinic_id,
  ii.provider_id,
  date_trunc('month', (i.issued_at at time zone cfg.tz))::date as revenue_month,
  sum(ii.line_total)                                           as issued_revenue,
  count(distinct i.id)                                         as invoice_count
from public.invoice_items ii
join public.clinic_invoices i on i.id = ii.invoice_id and i.clinic_id = ii.clinic_id
join cfg on cfg.clinic_id = ii.clinic_id
where ii.provider_id is not null
  and i.status <> 'voided'
group by ii.clinic_id, ii.provider_id, cfg.tz,
         date_trunc('month', (i.issued_at at time zone cfg.tz));

-- ---------------------------------------------------------------------------
-- 4) RLS — mandatory deny-all posture (service role bypasses; same as the
--    whole accounting/localization/insurance surface).
-- ---------------------------------------------------------------------------
alter table public.clinic_provider_compensations enable row level security;

-- ============================================================================
-- END — Payroll Foundation. No historical migration touched; no ledger kind
-- added (payroll_run/payslip_recorded stay FUTURE); no calculation engine;
-- configuration + derived attribution reporting only (D-P1/D-P2/D-P3).
-- ============================================================================
