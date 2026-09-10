-- ============================================================================
-- PP-4 — PATIENT PORTAL REFUNDS (owner-approved)
-- Additive only. No changes to Accounting A/B/C, Localization, Insurance,
-- Payroll, Financial Reporting, Growth, PP-1/2/3. No new ledger kinds.
--
-- Refund model (PP-4 decision):
--   Original payment
--     → refund request (ADMIN/FINANCE role — patients can NOT self-refund)
--     → provider refund (via lib/payments/provider.ts abstraction)
--     → authoritative provider state (refund.updated webhook)
--     → accounting reversal through the EXISTING approved path:
--       public.refund_payment RPC (Phase A/B, forward-fixed in Phase B) —
--       creates direction='refund' clinic_payments row + refund_recorded
--       financial_transaction + RCP receipt. NEVER a new payment.
--
-- Idempotency (two levels):
--   * refund request → optional caller-supplied UUID (Stripe-style retry token).
--     Reused with the SAME original payment → the original refund is returned
--     (no second provider refund); enforced at the DB by the partial unique
--     index (clinic_id, idempotency_key). When the caller omits a key the
--     server issues one, so every row still carries a deterministic anchor.
--   * webhook booking → atomic claim via booked_at IS NULL (one booking per
--     provider refund id even under duplicate deliveries).
--
-- This table is lifecycle/reconciliation ONLY — the accounting reversal lives
-- in the existing refund_payment RPC. It never issues ledger writes itself.
-- ============================================================================

-- 1) clinic_payment_refunds — portal refund lifecycle (reconciliation anchor)
create table if not exists public.clinic_payment_refunds (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics (id) on delete cascade,
  patient_id         uuid not null,
  invoice_id         uuid not null,
  clinic_payment_id  uuid not null,                 -- original payment being reversed
  provider_refund_id text not null unique,          -- e.g. re_... (idempotency level 2)
  amount             numeric(12,2) not null check (amount > 0),
  currency           text not null check (currency ~ '^[a-z]{3}$'),
  status             text not null default 'pending'
                     check (status in (
                       'pending', 'processing', 'succeeded',
                       'failed', 'canceled', 'needs_review'
                     )),
  reason             text,
  idempotency_key    uuid,                          -- refund-request dedup (level 1)
  booked_at          timestamptz,                   -- set exactly once on ledger booking
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  -- Tenant-safe composite FKs (house pattern: cross-tenant impossible at DB level)
  constraint fk_cpr_patient
    foreign key (clinic_id, patient_id)
    references public.patients (clinic_id, id) on delete cascade,
  constraint fk_cpr_invoice
    foreign key (clinic_id, invoice_id)
    references public.clinic_invoices (clinic_id, id) on delete cascade,
  constraint fk_cpr_payment
    foreign key (clinic_id, clinic_payment_id)
    references public.clinic_payments (clinic_id, id) on delete cascade
);

create index if not exists idx_cpr_clinic_status
  on public.clinic_payment_refunds (clinic_id, status);
create index if not exists idx_cpr_invoice
  on public.clinic_payment_refunds (clinic_id, invoice_id);
-- Level-1 idempotency: one refund request per idempotency key (when provided).
create unique index if not exists uq_cpr_idempotency_key
  on public.clinic_payment_refunds (clinic_id, idempotency_key)
  where idempotency_key is not null;

-- 2) RLS — default-deny (consistent with financial phases + PP-3). All access
--    is server-side via supabaseAdmin. No policies → authenticated sees/writes 0 rows.
alter table public.clinic_payment_refunds enable row level security;

-- ============================================================================
-- END — PP-4 portal refunds lifecycle. No ledger kinds, no historical changes.
-- ============================================================================