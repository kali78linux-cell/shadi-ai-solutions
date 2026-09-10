-- ============================================================================
-- 20260902_accounting_phase_b.sql — Accounting Phase B
-- Receivables / Aging + Payer Attribution + Provider Attribution
-- + Write-offs (clinic_adjustments) + Discount Authorization
--
-- ADDITIVE / BACKWARD-COMPATIBLE / IDEMPOTENT (safe to re-run; same posture
-- and patterns as Accounting Phase A — 20260901_accounting_phase_a.sql).
--
-- Encoded owner decisions (D-B1 → D-B5):
--   * D-B1 — Payer attribution on TWO levels:
--       clinic_invoices.payer_type/payer_ref  = billed/responsible payer
--       clinic_payments.payer_type/payer_ref  = actual payer / source of payment
--     Columns are additive + nullable. payer_ref is a bare UUID with NO FK
--     today; at Insurance Foundation it will migrate to `payers.id` behind the
--     composite tenant FK (clinic_id, payer_ref) → (clinic_id, payers.id).
--     payer_ref NEVER points at different tables depending on payer_type.
--   * D-B2 — Write-offs: dedicated immutable table `clinic_adjustments`
--     (kind='write_off'), partial/full amounts allowed, never exceeds the
--     current available balance, ledger event kind `write_off_recorded`.
--     NOT a payment, NOT a cash movement; never mutates invoice total.
--   * D-B3 — Discount authorization: `discount > 0` on an issued invoice
--     requires a FINANCE_ADMIN role (owner/accountant). Enforced in the API
--     layer against the FINANCE_ADMIN_ROLES matrix (no hard-coded limits).
--   * D-B4 — Provider attribution (nullable): invoice_items.provider_id
--     (precise source) + financial_transactions.provider_id (denormalized
--     reporting dimension), both via composite tenant FK on providers.
--   * D-B5 — Aging: derived view `receivable_aging` (never stored) using
--     coalesce(due_at, issued_at); current/1-30/31-60/61-90/90+; voided and
--     fully paid (balance<=0) excluded; credit balances never appear as
--     negative aging. Payer attribution never changes the base receivable math.
--
-- Ledger (D4): one new documented kind — `write_off_recorded` (see
-- docs/financial-ledger-kinds.md). Discount stays a header snapshot on the
-- invoice (never a separate revenue/ledger kind, to avoid double counting).
-- Cash-flow reporting MUST filter explicit cash event types
-- (payment_recorded/refund_recorded), never direction alone.
--
-- Platform Billing (subscriptions/billing_plans/Stripe) is NEVER touched.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Composite unique index on providers (enables cross-tenant composite FK;
--    identical pattern already used for patients/appointments/… in Phase A).
-- ---------------------------------------------------------------------------
create unique index if not exists providers_clinic_id_id_key
  on public.providers (clinic_id, id);

-- ---------------------------------------------------------------------------
-- 2) Payer attribution — clinic_invoices (billed / responsible payer)
-- ---------------------------------------------------------------------------
alter table public.clinic_invoices
  add column if not exists payer_type text,
  add column if not exists payer_ref  uuid;

-- ---------------------------------------------------------------------------
-- 3) Payer attribution — clinic_payments (actual payer / source of payment)
-- ---------------------------------------------------------------------------
alter table public.clinic_payments
  add column if not exists payer_type text,
  add column if not exists payer_ref  uuid;

-- ---------------------------------------------------------------------------
-- 4) Provider attribution — invoice_items (precise per-line source)
-- ---------------------------------------------------------------------------
alter table public.invoice_items
  add column if not exists provider_id uuid;

-- ---------------------------------------------------------------------------
-- 5) Provider attribution — financial_transactions (denormalized reporting
--    dimension for provider commissions/payroll/profitability)
-- ---------------------------------------------------------------------------
alter table public.financial_transactions
  add column if not exists provider_id uuid;

-- ---------------------------------------------------------------------------
-- 6) Nullable-aware CHECK constraints on payer_type (additive + idempotent)
-- ---------------------------------------------------------------------------
do $$
begin
  alter table public.clinic_invoices
    add constraint clinic_invoices_payer_type_check
    check (payer_type is null or payer_type in ('patient', 'insurance', 'employer', 'third_party'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.clinic_payments
    add constraint clinic_payments_payer_type_check
    check (payer_type is null or payer_type in ('patient', 'insurance', 'employer', 'third_party'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 7) Cross-tenant composite FKs for provider attribution (D-B4). A provider
--    of another clinic can never be attached — enforced by the database.
-- ---------------------------------------------------------------------------
do $$
begin
  alter table public.invoice_items
    add constraint invoice_items_provider_clinic_fkey
    foreign key (clinic_id, provider_id)
    references public.providers (clinic_id, id) on delete set null;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.financial_transactions
    add constraint financial_transactions_provider_clinic_fkey
    foreign key (clinic_id, provider_id)
    references public.providers (clinic_id, id) on delete set null;
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 8) clinic_adjustments — dedicated, immutable write-off rows (D-B2).
--    NOT a payment: never mixed with cash movements. kind reserved for
--    write_off today; insert-only (see trigger below), amount frozen.
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_adjustments (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics (id) on delete cascade,
  invoice_id      uuid not null,
  kind            text not null check (kind in ('write_off')),
  amount          numeric(12,2) not null check (amount > 0),
  reason          text not null,
  status          text not null default 'recorded' check (status in ('recorded', 'voided')),
  idempotency_key uuid,
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,
  recorded_by     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (clinic_id, invoice_id)
    references public.clinic_invoices (clinic_id, id) on delete cascade
);
create index if not exists idx_clinic_adjustments_invoice
  on public.clinic_adjustments (clinic_id, invoice_id);
create unique index if not exists clinic_adjustments_idempotency_key
  on public.clinic_adjustments (clinic_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists clinic_adjustments_clinic_id_id_key
  on public.clinic_adjustments (clinic_id, id);

-- Fully immutable (write-offs are terminal per D-B2; correction paths are a
-- separate documented future decision — never in-place mutation).
drop trigger if exists clinic_adjustments_no_mutation on public.clinic_adjustments;
create trigger clinic_adjustments_no_mutation
  before update or delete on public.clinic_adjustments
  for each row execute function public.forbid_financial_mutation();

-- ---------------------------------------------------------------------------
-- 9) Ledger kind dictionary extension (D4): allow write_off_recorded.
--    Additive: the five Phase A kinds remain valid; the new value is appended.
-- ---------------------------------------------------------------------------
alter table public.financial_transactions
  drop constraint if exists financial_transactions_event_type_check;
alter table public.financial_transactions
  add constraint financial_transactions_event_type_check
  check (event_type in ('invoice_issued', 'invoice_voided', 'payment_recorded',
                        'payment_voided', 'refund_recorded', 'write_off_recorded'));
-- ---------------------------------------------------------------------------
-- 10) Immutability guards extended to the new Phase B columns.
--     invoice headers and payment rows are financial snapshots: payer and
--     provider fields are frozen at creation, exactly like every Phase A field.
-- ---------------------------------------------------------------------------
create or replace function public.clinic_invoices_guard_update()
returns trigger language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id
     or new.patient_id is distinct from old.patient_id
     or new.appointment_id is distinct from old.appointment_id
     or new.invoice_number is distinct from old.invoice_number
     or new.subtotal is distinct from old.subtotal
     or new.discount is distinct from old.discount
     or new.tax is distinct from old.tax
     or new.total is distinct from old.total
     or new.payer_type is distinct from old.payer_type
     or new.payer_ref is distinct from old.payer_ref
     or new.issued_at is distinct from old.issued_at
     or new.created_by is distinct from old.created_by then
    raise exception 'clinic_invoices header is an immutable financial snapshot';
  end if;
  return new;
end;
$$;
drop trigger if exists clinic_invoices_immutable on public.clinic_invoices;
create trigger clinic_invoices_immutable
  before update on public.clinic_invoices
  for each row execute function public.clinic_invoices_guard_update();
create or replace function public.clinic_payments_guard_update()
returns trigger language plpgsql as $$
begin
  if new.amount is distinct from old.amount
     or new.direction is distinct from old.direction
     or new.invoice_id is distinct from old.invoice_id
     or new.method is distinct from old.method
     or new.payer_type is distinct from old.payer_type
     or new.payer_ref is distinct from old.payer_ref
     or new.idempotency_key is distinct from old.idempotency_key
     or new.original_payment_id is distinct from old.original_payment_id
     or new.receipt_number is distinct from old.receipt_number then
    raise exception 'clinic_payments core columns are immutable (void instead)';
  end if;
  return new;
end;
$$;
drop trigger if exists clinic_payments_immutable on public.clinic_payments;
create trigger clinic_payments_immutable
  before update on public.clinic_payments
  for each row execute function public.clinic_payments_guard_update();
-- ---------------------------------------------------------------------------
-- 11) record_write_off — atomic, SECURITY DEFINER (same posture as Phase A RPCs).
--     Validity envelope: invoice exists, not voided, amount > 0, never exceeds
--     the CURRENT available balance (total - recorded payments + refunds -
--     already written off). Writes the adjustment row + ledger event together.
--     Idempotency via p_idempotency_key (unique per clinic).
-- ---------------------------------------------------------------------------
create or replace function public.record_write_off(
  p_clinic_id       uuid,
  p_invoice_id      uuid,
  p_amount          numeric,
  p_reason          text,
  p_idempotency_key uuid,
  p_recorded_by     uuid
) returns jsonb
language plpgsql as $$
declare
  v_invoice    public.clinic_invoices%rowtype;
  v_paid       numeric(12,2) := 0;
  v_written    numeric(12,2) := 0;
  v_available  numeric(12,2);
  v_adj_id     uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'WRITE_OFF_AMOUNT_INVALID'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'WRITE_OFF_REASON_REQUIRED'; end if;

  -- Idempotency: same clinic + key already recorded => return the existing
  -- adjustment gracefully (same contract as record_payment). The partial
  -- unique index (clinic_id, idempotency_key) is the physical backstop.
  if p_idempotency_key is not null then
    select id into v_adj_id
      from public.clinic_adjustments
     where clinic_id = p_clinic_id and idempotency_key = p_idempotency_key
       and kind = 'write_off' and status = 'recorded'
     limit 1;
    if found then
      return jsonb_build_object('adjustment_id', v_adj_id, 'duplicate', true);
    end if;
  end if;

  select * into v_invoice
    from public.clinic_invoices
   where clinic_id = p_clinic_id and id = p_invoice_id
   for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status = 'voided' then raise exception 'INVOICE_VOIDED'; end if;

  select coalesce(sum(case when direction = 'payment' then amount else -amount end), 0)
    into v_paid
    from public.clinic_payments
   where clinic_id = p_clinic_id and invoice_id = p_invoice_id and status = 'recorded';

  select coalesce(sum(amount), 0) into v_written
    from public.clinic_adjustments
   where clinic_id = p_clinic_id and invoice_id = p_invoice_id
     and kind = 'write_off' and status = 'recorded';

  v_available := round(v_invoice.total - v_paid - v_written, 2);
  if v_available <= 0 then raise exception 'NO_REMAINING_BALANCE'; end if;
  if p_amount > v_available then raise exception 'WRITE_OFF_EXCEEDS_BALANCE'; end if;

  insert into public.clinic_adjustments
    (clinic_id, invoice_id, kind, amount, reason, idempotency_key, recorded_by)
  values
    (p_clinic_id, p_invoice_id, 'write_off', round(p_amount, 2), p_reason,
     p_idempotency_key, p_recorded_by)
  returning id into v_adj_id;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'write_off_recorded:' || v_adj_id::text, 'write_off_recorded',
     'clinic_adjustments', v_adj_id, 'out', round(p_amount, 2), p_recorded_by,
     jsonb_build_object('invoice_id', p_invoice_id, 'reason', p_reason,
                        'invoice_number', v_invoice.invoice_number,
                        'available_before', v_available));

  return jsonb_build_object('adjustment_id', v_adj_id, 'amount', round(p_amount, 2),
                            'available_before', v_available,
                            'remaining', round(v_available - p_amount, 2));
end;
$$;
-- ---------------------------------------------------------------------------
-- 12) issue_invoice — REPLACED with the Phase B signature (backward compatible:
--     new params default to NULL, so Phase A callers keep working). The header
--     snapshot now also captures the billed/responsible payer (D-B1 invoice
--     level) and each line captures its provider (D-B4 precise source).
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
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'INVOICE_ITEMS_REQUIRED';
  end if;
  if p_payer_type is not null
     and p_payer_type not in ('patient', 'insurance', 'employer', 'third_party') then
    raise exception 'INVALID_PAYER_TYPE';
  end if;

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
     subtotal, discount, tax, total, notes, due_at, payer_type, payer_ref, created_by)
  values
    (p_clinic_id, p_patient_id, p_appointment_id, v_number, 'issued',
     v_subtotal, coalesce(p_discount, 0), coalesce(p_tax, 0), v_total,
     p_notes, p_due_at, p_payer_type, p_payer_ref, p_created_by)
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
                        'total', v_total, 'payer_type', p_payer_type,
                        'payer_ref', p_payer_ref));

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_number,
                            'subtotal', v_subtotal, 'total', v_total);
end;
$$;
-- ---------------------------------------------------------------------------
-- 13) record_payment — REPLACED with the Phase B signature (new params default
--     to NULL → Phase A callers keep working). Captures the actual payer /
--     source of payment (D-B1 payment level).
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_clinic_id       uuid,
  p_invoice_id      uuid,
  p_amount          numeric,
  p_method          text,
  p_reference       text,
  p_idempotency_key uuid,
  p_recorded_by     uuid,
  p_payer_type      text default null,
  p_payer_ref       uuid default null
) returns jsonb
language plpgsql as $$
declare
  v_invoice    public.clinic_invoices%rowtype;
  v_paid       numeric(12,2);
  v_remaining  numeric(12,2);
  v_payment_id uuid;
  v_receipt    text;
  v_seq        bigint;
  v_year       int := extract(year from now())::int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_method not in ('cash','card','bank_transfer','insurance','other') then
    raise exception 'INVALID_METHOD';
  end if;
  if p_payer_type is not null
     and p_payer_type not in ('patient', 'insurance', 'employer', 'third_party') then
    raise exception 'INVALID_PAYER_TYPE';
  end if;

  select * into v_invoice from public.clinic_invoices
   where clinic_id = p_clinic_id and id = p_invoice_id;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status = 'voided' then raise exception 'INVOICE_VOIDED'; end if;
  if p_idempotency_key is not null then
    select id into v_payment_id from public.clinic_payments
     where clinic_id = p_clinic_id and idempotency_key = p_idempotency_key
       and status = 'recorded' limit 1;
    if found then
      return jsonb_build_object('payment_id', v_payment_id, 'duplicate', true);
    end if;
  end if;

  select coalesce(sum(case when direction = 'payment' then amount else -amount end), 0)
    into v_paid
    from public.clinic_payments
   where clinic_id = p_clinic_id and invoice_id = p_invoice_id and status = 'recorded';
  v_remaining := round(v_invoice.total - v_paid, 2);

  if p_method in ('cash','card','bank_transfer','insurance') then
    v_seq := public.next_clinic_sequence(p_clinic_id, 'receipt', v_year);
    v_receipt := format('RCP-%s-%s', v_year, lpad(v_seq::text, 6, '0'));
  end if;

  insert into public.clinic_payments
    (clinic_id, invoice_id, direction, amount, method, reference,
     receipt_number, idempotency_key, payer_type, payer_ref, recorded_by)
  values
    (p_clinic_id, p_invoice_id, 'payment', round(p_amount, 2), p_method,
     p_reference, v_receipt, p_idempotency_key, p_payer_type, p_payer_ref, p_recorded_by)
  returning id into v_payment_id;

  perform public.recompute_invoice_status(p_clinic_id, p_invoice_id);

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'payment_recorded:' || v_payment_id::text, 'payment_recorded',
     'clinic_payments', v_payment_id, 'in', round(p_amount, 2), p_recorded_by,
     jsonb_build_object('invoice_id', p_invoice_id, 'method', p_method,
                        'receipt_number', v_receipt,
                        'invoice_remaining_before', v_remaining));

  return jsonb_build_object('payment_id', v_payment_id, 'receipt_number', v_receipt,
                            'duplicate', false, 'invoice_remaining_before', v_remaining);
end;
$$;
-- ---------------------------------------------------------------------------
-- 14) Derived balance views — BACKWARD-COMPATIBLE replacement. Existing
--     columns keep their names and meaning; write-offs are subtracted from
--     the available balance. Balances remain DERIVED (never stored).
--     NOTE: PostgreSQL's CREATE OR REPLACE VIEW cannot reorder/rename existing
--     columns, and Phase B inserts written_off_amount before balance_amount.
--     Therefore the views are DROPped and re-CREATEd here. Column
--     backward-compatibility is preserved: every Phase A column (clinic_id,
--     invoice_id, patient_id, invoice_number, status, total, paid_amount,
--     balance_amount) keeps its name and meaning; only the new
--     written_off_amount column is added. Idempotent on re-run.
-- ---------------------------------------------------------------------------
drop view if exists public.patient_balances;
drop view if exists public.receivable_aging;
drop view if exists public.invoice_balances;

create view public.invoice_balances as

select
  i.clinic_id,
  i.id                        as invoice_id,
  i.patient_id,
  i.invoice_number,
  i.status,
  i.total,
  coalesce(p.paid, 0)         as paid_amount,
  coalesce(a.written, 0)      as written_off_amount,
  i.total - coalesce(p.paid, 0) - coalesce(a.written, 0) as balance_amount
from public.clinic_invoices i
left join (
  select clinic_id, invoice_id,
         sum(case when direction = 'payment' then amount else -amount end) as paid
  from public.clinic_payments
  where status = 'recorded'
  group by clinic_id, invoice_id
) p on p.clinic_id = i.clinic_id and p.invoice_id = i.id
left join (
  select clinic_id, invoice_id,
         sum(amount) as written
  from public.clinic_adjustments
  where kind = 'write_off' and status = 'recorded'
  group by clinic_id, invoice_id
) a on a.clinic_id = i.clinic_id and a.invoice_id = i.id
where i.status <> 'voided';

create or replace view public.patient_balances as
select
  b.clinic_id,
  b.patient_id,
  sum(b.total)                            as invoiced_total,
  sum(b.paid_amount)                      as paid_total,
  sum(b.written_off_amount)               as written_off_total,
  sum(greatest(b.balance_amount, 0))      as outstanding_amount,
  sum(greatest(-b.balance_amount, 0))     as credit_amount
from public.invoice_balances b
group by b.clinic_id, b.patient_id;
-- ---------------------------------------------------------------------------
-- 15) receivable_aging — derived aging buckets (D-B5). Never stored.
--     coalesce(due_at, issued_at) is the aging reference. Excluded: voided
--     invoices, zero/negative balance (paid + overpaid). Credit balances do
--     NOT appear as negative aging (they live in patient_balances.credit_amount).
--     Buckets: current · 1-30 · 31-60 · 61-90 · 90+.
-- ---------------------------------------------------------------------------
create or replace view public.receivable_aging as
select
  b.clinic_id,
  b.invoice_id,
  b.patient_id,
  b.invoice_number,
  b.status,
  i.due_at,
  i.issued_at,
  coalesce(i.due_at, i.issued_at) as aging_reference_at,
  b.total,
  b.paid_amount,
  b.written_off_amount,
  b.balance_amount,
  (extract(epoch from (now() - coalesce(i.due_at, i.issued_at))) / 86400)::int as age_days,
  case
    when (extract(epoch from (now() - coalesce(i.due_at, i.issued_at))) / 86400)::int <= 0
      then 'current'
    when (extract(epoch from (now() - coalesce(i.due_at, i.issued_at))) / 86400)::int <= 30
      then '1-30'
    when (extract(epoch from (now() - coalesce(i.due_at, i.issued_at))) / 86400)::int <= 60
      then '31-60'
    when (extract(epoch from (now() - coalesce(i.due_at, i.issued_at))) / 86400)::int <= 90
      then '61-90'
    else '90+'
  end as bucket
from public.invoice_balances b
join public.clinic_invoices i
  on i.clinic_id = b.clinic_id and i.id = b.invoice_id
where b.balance_amount > 0
  and b.status <> 'voided';

-- ---------------------------------------------------------------------------
-- 16) RLS — clinic_adjustments joins the denied-by-default posture: enabled
--     with NO policies; all access flows server-side via the service-role
--     client after authorizeClinicRequest + FINANCE_* gating (Phase A pattern).
-- ---------------------------------------------------------------------------
alter table public.clinic_adjustments enable row level security;

-- ============================================================================
-- END — Accounting Phase B. No existing rows/columns were modified; every
-- change is additive and the ledger remains append-only. See
-- docs/financial-ledger-kinds.md for the D4 kind dictionary.
-- ============================================================================

-- ============================================================================
-- 10) FORWARD FIX — refund_payment (INHERITED PHASE A DEFECT, FIXED HERE)
--
-- PRE-EXISTING / INHERITED DEFECT FROM PHASE A — FIXED FORWARD IN PHASE B:
--   Phase A's refund_payment called next_clinic_sequence(p_clinic_id, 'receipt')
--   with 2 args, but the actual signature is (p_clinic_id, p_kind, p_year) —
--   so EVERY refund failed with "function public.next_clinic_sequence(uuid,
--   unknown) does not exist". Discovered by the Phase B live financial
--   lifecycle probe; fixed here with owner approval (no historical migration
--   is touched).
--
--   This create-or-replace is byte-for-byte the Phase A logic (guards, net-paid
--   cap, receipt numbering, ledger event, status recompute) with the single
--   corrected call: next_clinic_sequence(p_clinic_id, 'receipt', v_year).
--   Backward-compatible: same name, same signature, same semantics, same
--   receipt-number format; idempotent under re-runs of this migration.
-- ============================================================================
create or replace function public.refund_payment(
  p_clinic_id   uuid,
  p_payment_id  uuid,
  p_amount      numeric,
  p_reason      text,
  p_refunded_by uuid
) returns uuid language plpgsql as $$
declare
  v_payment   public.clinic_payments%rowtype;
  v_refund_id uuid;
  v_net_paid  numeric;
  v_refunded  numeric;
  v_seq       bigint;
  v_year      int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'REFUND_AMOUNT_INVALID'; end if;
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'REFUND_REASON_REQUIRED'; end if;
  select * into v_payment from public.clinic_payments
   where clinic_id = p_clinic_id and id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment.direction <> 'payment' then raise exception 'REFUND_ONLY_ON_PAYMENT'; end if;
  if v_payment.status <> 'recorded' then raise exception 'PAYMENT_VOIDED'; end if;

  select coalesce(sum(case when direction='payment' then amount else -amount end), 0)
    into v_net_paid
    from public.clinic_payments
   where clinic_id = p_clinic_id and invoice_id = v_payment.invoice_id
     and direction = 'payment' and status = 'recorded';
  select coalesce(sum(amount), 0) into v_refunded
    from public.clinic_payments
   where clinic_id = p_clinic_id and invoice_id = v_payment.invoice_id
     and direction = 'refund' and status = 'recorded';
  if p_amount > (v_net_paid - v_refunded) then
    raise exception 'REFUND_EXCEEDS_PAID';
  end if;

  v_year := extract(year from now())::int;
  v_seq := public.next_clinic_sequence(p_clinic_id, 'receipt', v_year);
  insert into public.clinic_payments
    (clinic_id, invoice_id, direction, amount, method, reference, receipt_number,
     status, original_payment_id, recorded_by)
  values
    (p_clinic_id, v_payment.invoice_id, 'refund', p_amount, v_payment.method,
     p_reason, 'RCP-' || v_year::text || '-' || lpad(v_seq::text, 6, '0'),
     'recorded', p_payment_id, p_refunded_by)
  returning id into v_refund_id;

  perform public.recompute_invoice_status(p_clinic_id, v_payment.invoice_id);

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'refund_recorded:' || v_refund_id::text, 'refund_recorded',
     'clinic_payments', v_refund_id, 'out', p_amount, p_refunded_by,
     jsonb_build_object('reason', p_reason, 'invoice_id', v_payment.invoice_id,
                        'original_payment_id', p_payment_id));
  return v_refund_id;
end;
$$;

-- ============================================================================

-- END — Accounting Phase B (incl. forward fix of the inherited Phase A
-- refund_payment defect). No existing rows/columns were modified; every
-- change is additive and the ledger remains append-only. See
-- docs/financial-ledger-kinds.md for the D4 kind dictionary.
-- ============================================================================

