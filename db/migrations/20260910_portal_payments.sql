-- ============================================================================
-- PP-3 — PATIENT PORTAL ONLINE PAYMENTS (owner-approved; D-PP3-a/b/c + 6 amendments)
-- Additive only. No changes to Phase A/B/C, Localization, Insurance, Payroll,
-- Financial Reporting, Growth, PP-1, PP-2. No new ledger kinds.
--
-- Provider-agnostic (owner amendment #1): these tables are provider-neutral —
-- `stripe_payment_intent_id` is named for the ACTIVE adapter (Stripe) but the
-- lifecycle/logic lives behind lib/payments/provider.ts, so a regional gateway
-- adapter can be added later without re-architecting.
--
-- Tables:
--   * clinic_stripe_connect_accounts — one row per clinic (clinic_id unique),
--     readiness mirror of the provider connected account (updated ONLY from
--     webhook account.updated + sync-on-read; never from clients). RLS deny-all.
--   * clinic_payment_intents — provider PaymentIntent lifecycle per invoice.
--     Status 'requires_review' is written ONLY by reconciliation failures
--     (e.g. invoice voided before webhook arrived / metadata mismatch).
--     No ledger writes originate from this table.
-- ============================================================================

-- 1) clinic_stripe_connect_accounts — Connect readiness mirror (D-PP3-a)
create table if not exists public.clinic_stripe_connect_accounts (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null unique references public.clinics (id) on delete cascade,
  stripe_account_id  text not null unique,
  charges_enabled    boolean not null default false,
  payouts_enabled    boolean not null default false,
  onboarding_status  text not null default 'pending'
                     check (onboarding_status in ('pending', 'onboarding', 'complete', 'restricted')),
  country            text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- 2) clinic_payment_intents — portal PaymentIntent lifecycle (D-PP3-c, REQUIRED)
create table if not exists public.clinic_payment_intents (
  id                       uuid primary key default gen_random_uuid(),
  clinic_id                uuid not null references public.clinics (id) on delete cascade,
  patient_id               uuid not null,
  invoice_id               uuid not null,
  stripe_payment_intent_id text not null unique,
  amount                   numeric(12,2) not null check (amount > 0),
  currency                 text not null check (currency ~ '^[a-z]{3}$'),
  status                   text not null default 'initiated'
                           check (status in (
                             'initiated', 'requires_payment_method', 'processing',
                             'succeeded', 'failed', 'canceled', 'requires_review'
                           )),
  failure_message          text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  -- Tenant-safe references (house pattern: composite FKs make cross-tenant
  -- linkage physically impossible at the DB level).
  constraint fk_cpi_patient
    foreign key (clinic_id, patient_id)
    references public.patients (clinic_id, id) on delete cascade,
  constraint fk_cpi_invoice
    foreign key (clinic_id, invoice_id)
    references public.clinic_invoices (clinic_id, id) on delete cascade
);

create index if not exists idx_cpi_clinic_invoice
  on public.clinic_payment_intents (clinic_id, invoice_id);
create index if not exists idx_cpi_clinic_status
  on public.clinic_payment_intents (clinic_id, status);
-- One ACTIVE intent per invoice at a time (reuse semantics, D-PP3-c):
create unique index if not exists uq_cpi_one_active_per_invoice
  on public.clinic_payment_intents (clinic_id, invoice_id)
  where status in ('initiated', 'requires_payment_method', 'processing');

-- 3) RLS — default-deny (consistent with financial phases); all access is
--    server-side via supabaseAdmin. No policies → authenticated sees/writes 0 rows.
alter table public.clinic_stripe_connect_accounts enable row level security;
alter table public.clinic_payment_intents enable row level security;