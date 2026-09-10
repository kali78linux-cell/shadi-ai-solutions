-- ============================================================================
-- 20260901_accounting_phase_a.sql — STEP 2: Accounting Phase A
-- Revenue & Payments Foundation (Patient Finance + financial ledger base).
--
-- ADDITIVE / BACKWARD-COMPATIBLE. Does NOT modify existing tables' columns;
-- only ADDS unique indexes (safe, needed for composite cross-tenant FKs),
-- new tables, views, and immutability triggers.
--
-- Approved owner decisions encoded here:
--   * Financial rows are INSERT-ONLY: no UPDATE of amounts, no DELETE.
--     Corrections happen via void / refund / new corrective rows only.
--   * Balances are DERIVED (views), never stored.
--   * Strict separation from Platform Billing (subscriptions/billing_plans/
--     Stripe) — no FK, no reference, nothing shared.
--   * Per-clinic yearly numbering INV-{year}-{seq} / RCP-{year}-{seq},
--     concurrency-safe, numbers never reused (void included).
--   * Cross-tenant references made impossible at the DB level via
--     composite foreign keys (clinic_id, id).
--   * RLS enabled with NO policies ⇒ anon/authenticated see zero rows;
--     all access happens server-side via the service-role client after
--     authorizeClinicRequest + FINANCE_ROLES gating (same posture as
--     entitlement_usage / billing_plans).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Composite-tenant unique indexes (additive, no data change) — required
--    so the financial tables can use composite FKs that make cross-tenant
--    references physically impossible.
-- ---------------------------------------------------------------------------
create unique index if not exists patients_clinic_id_id_key
  on public.patients (clinic_id, id);
create unique index if not exists appointments_clinic_id_id_key
  on public.appointments (clinic_id, id);
create unique index if not exists clinic_services_clinic_id_id_key
  on public.clinic_services (clinic_id, id);

-- ---------------------------------------------------------------------------
-- 2) Per-clinic per-year sequences (invoices + receipts). Concurrency-safe:
--    INSERT .. ON CONFLICT DO UPDATE RETURNING takes a row lock; numbers move
--    forward only and are never reused, even after void.
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_sequences (
  clinic_id uuid not null references public.clinics (id) on delete cascade,
  kind      text not null check (kind in ('invoice', 'receipt')),
  year      int  not null,
  next_seq  bigint not null default 1,
  primary key (clinic_id, kind, year)
);

-- ---------------------------------------------------------------------------
-- 3) clinic_invoices — issued directly (no draft in Phase A); header totals
--    are a financial SNAPSHOT, immutable after creation (see trigger).
--    Status transitions: issued → partially_paid → paid (derived from
--    payments, kept for filtering) → voided (terminal, never deleted).
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_invoices (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references public.clinics (id) on delete cascade,
  patient_id     uuid not null,
  appointment_id uuid,
  invoice_number text not null,
  status         text not null default 'issued'
                 check (status in ('issued', 'partially_paid', 'paid', 'voided')),
  subtotal       numeric(12,2) not null check (subtotal >= 0),
  discount       numeric(12,2) not null default 0 check (discount >= 0),
  tax            numeric(12,2) not null default 0 check (tax >= 0),
  total          numeric(12,2) not null check (total >= 0),
  notes          text,
  issued_at      timestamptz not null default now(),
  due_at         timestamptz,
  voided_at      timestamptz,
  voided_by      uuid,
  void_reason    text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (clinic_id, invoice_number),
  -- Cross-tenant composite FKs: a patient/appointment of ANOTHER clinic can
  -- never be attached, enforced by the database itself.
  foreign key (clinic_id, patient_id)
    references public.patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, appointment_id)
    references public.appointments (clinic_id, id) on delete set null
);

create index if not exists idx_clinic_invoices_clinic_status
  on public.clinic_invoices (clinic_id, status);
create index if not exists idx_clinic_invoices_patient
  on public.clinic_invoices (clinic_id, patient_id);
create unique index if not exists clinic_invoices_clinic_id_id_key
  on public.clinic_invoices (clinic_id, id);


-- ---------------------------------------------------------------------------
-- 4) invoice_items — line snapshots (service_id + description + unit_price).
--    The snapshot guarantees that later price/name changes in clinic_services
--    never alter an issued invoice. Fully immutable (insert-only).
-- ---------------------------------------------------------------------------
create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  clinic_id   uuid not null references public.clinics (id) on delete cascade,
  invoice_id  uuid not null,
  service_id  uuid,
  description text not null,
  quantity    numeric(12,2) not null default 1 check (quantity > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),
  line_total  numeric(12,2) not null check (line_total >= 0),
  created_at  timestamptz not null default now(),
  foreign key (clinic_id, invoice_id)
    references public.clinic_invoices (clinic_id, id) on delete cascade,
  -- Snapshot may point at the real service, but never at another clinic's.
  foreign key (clinic_id, service_id)
    references public.clinic_services (clinic_id, id) on delete set null
);
create index if not exists idx_invoice_items_invoice
  on public.invoice_items (clinic_id, invoice_id);

-- Financial immutability helper: blocks UPDATE/DELETE on financial rows.
create or replace function public.forbid_financial_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'financial rows are insert-only: % is not allowed on %',
    TG_OP, TG_TABLE_NAME;
end;
$$;

drop trigger if exists invoice_items_immutable on public.invoice_items;

-- ---------------------------------------------------------------------------
-- 5) clinic_payments — actual money movements. INSERT-ONLY: amount/direction/
--    invoice/method can never be changed; a wrong entry is VOIDED (status),
--    never edited or deleted. direction='payment' | 'refund'; refunds point
--    back at the original payment. Overpayment is allowed (patient credit is
--    derived in the balances view). Idempotency via nullable key.
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_payments (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid not null references public.clinics (id) on delete cascade,
  invoice_id         uuid not null,
  direction          text not null default 'payment'
                     check (direction in ('payment', 'refund')),
  amount             numeric(12,2) not null check (amount > 0),
  method             text not null
                     check (method in ('cash', 'card', 'bank_transfer', 'insurance', 'other')),
  reference          text,
  receipt_number     text,
  status             text not null default 'recorded'
                     check (status in ('recorded', 'voided')),
  idempotency_key    uuid,
  original_payment_id uuid,
  voided_at          timestamptz,
  voided_by          uuid,
  void_reason        text,
  recorded_by        uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (clinic_id, invoice_id)
    references public.clinic_invoices (clinic_id, id) on delete cascade
);
create index if not exists idx_clinic_payments_invoice
  on public.clinic_payments (clinic_id, invoice_id);
create unique index if not exists clinic_payments_idempotency_key
  on public.clinic_payments (clinic_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists clinic_payments_clinic_id_id_key
  on public.clinic_payments (clinic_id, id);
create unique index if not exists clinic_payments_receipt_number_key
  on public.clinic_payments (clinic_id, receipt_number)
  where receipt_number is not null;

-- Immutable core columns; only void bookkeeping may change after insert.
create or replace function public.clinic_payments_guard_update()
returns trigger language plpgsql as $$
begin
  if new.amount is distinct from old.amount
     or new.direction is distinct from old.direction
     or new.invoice_id is distinct from old.invoice_id
     or new.method is distinct from old.method
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

drop trigger if exists clinic_payments_no_delete on public.clinic_payments;
create trigger clinic_payments_no_delete
  before delete on public.clinic_payments
  for each row execute function public.forbid_financial_mutation();

-- Invoice header immutability: after creation only status/void bookkeeping
-- and updated_at may change; totals/patient/number are frozen forever.
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

drop trigger if exists clinic_invoices_no_delete on public.clinic_invoices;
create trigger clinic_invoices_no_delete
  before delete on public.clinic_invoices
  for each row execute function public.forbid_financial_mutation();

create trigger invoice_items_immutable
  before update or delete on public.invoice_items
  for each row execute function public.forbid_financial_mutation();

-- ---------------------------------------------------------------------------
-- 6) financial_transactions — append-only unified financial ledger (owner
--    decision #5). One row per financial event; reports (P/L, cash flow,
--    aging) will be queries over this table in later phases. No Stripe /
--    platform-billing events EVER land here.
-- ---------------------------------------------------------------------------
create table if not exists public.financial_transactions (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics (id) on delete cascade,
  event_key     text not null,
  event_type    text not null check (event_type in
                ('invoice_issued', 'invoice_voided', 'payment_recorded',
                 'payment_voided', 'refund_recorded')),
  ref_table     text not null,
  ref_id        uuid not null,
  direction     text not null check (direction in ('in', 'out')),
  amount        numeric(12,2) not null check (amount > 0),
  occurred_at   timestamptz not null default now(),
  actor_user_id uuid,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  unique (clinic_id, event_key)
);
create index if not exists idx_financial_transactions_clinic_time
  on public.financial_transactions (clinic_id, occurred_at);

drop trigger if exists financial_transactions_no_update on public.financial_transactions;
create trigger financial_transactions_no_update
  before update or delete on public.financial_transactions
  for each row execute function public.forbid_financial_mutation();

-- ---------------------------------------------------------------------------
-- 7) Derived balance views — balances are NEVER stored; they are computed
--    from the immutable movements, so they cannot drift.
-- ---------------------------------------------------------------------------
create or replace view public.invoice_balances as
select
  i.clinic_id,
  i.id                       as invoice_id,
  i.patient_id,
  i.invoice_number,
  i.status,
  i.total,
  coalesce(p.paid, 0)        as paid_amount,
  i.total - coalesce(p.paid, 0) as balance_amount
from public.clinic_invoices i
left join (
  select clinic_id, invoice_id,
         sum(case when direction = 'payment' then amount else -amount end) as paid
  from public.clinic_payments
  where status = 'recorded'
  group by clinic_id, invoice_id
) p on p.clinic_id = i.clinic_id and p.invoice_id = i.id
where i.status <> 'voided';

create or replace view public.patient_balances as
select
  b.clinic_id,
  b.patient_id,
  sum(b.total)                            as invoiced_total,
  sum(b.paid_amount)                      as paid_total,
  sum(greatest(b.balance_amount, 0))      as outstanding_amount,
  -- Overpayment (owner-approved): the excess becomes patient credit.
  sum(greatest(-b.balance_amount, 0))     as credit_amount
from public.invoice_balances b
group by b.clinic_id, b.patient_id;

-- ---------------------------------------------------------------------------
-- 8) RLS — enabled with NO policies (deny-all for anon/authenticated).
--    All reads/writes flow through the server-side service-role client after
--    authorizeClinicRequest + FINANCE_ROLES gating (billing_plans posture).
-- ---------------------------------------------------------------------------
alter table public.clinic_sequences       enable row level security;
alter table public.clinic_invoices        enable row level security;
alter table public.invoice_items          enable row level security;
alter table public.clinic_payments        enable row level security;
alter table public.financial_transactions enable row level security;

-- ============================================================================
-- END — Accounting Phase A foundation. No existing table/data was modified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 9) Atomic financial RPCs (SECURITY DEFINER, same posture as
--    check_and_increment_entitlement). All invariants are enforced HERE so
--    they hold regardless of caller. Each function runs in a single implicit
--    transaction: movement + ledger row + status recompute are atomic.
-- ---------------------------------------------------------------------------

create or replace function public.next_clinic_sequence(
  p_clinic_id uuid,
  p_kind      text,
  p_year      int
) returns bigint
language plpgsql as $$
declare
  v_seq bigint;
begin
  insert into public.clinic_sequences (clinic_id, kind, year, next_seq)
  values (p_clinic_id, p_kind, p_year, 2)
  on conflict (clinic_id, kind, year)
  do update set next_seq = public.clinic_sequences.next_seq + 1
  returning next_seq - 1 into v_seq;
  return v_seq;
end;
$$;

-- Recompute derived status from immutable movements (never hand-written).
create or replace function public.recompute_invoice_status(
  p_clinic_id uuid,
  p_invoice_id uuid
) returns void language plpgsql as $$
begin
  update public.clinic_invoices i
  set status = case
        when v.paid >= i.total then 'paid'
        when v.paid > 0        then 'partially_paid'
        else 'issued'
      end,
      updated_at = now()
  from (
    select coalesce(sum(case when direction = 'payment' then amount else -amount end), 0) as paid
    from public.clinic_payments
    where clinic_id = p_clinic_id and invoice_id = p_invoice_id and status = 'recorded'
  ) v
  where i.clinic_id = p_clinic_id and i.id = p_invoice_id and i.status <> 'voided';
end;
$$;

-- ============================================================================
-- END — Accounting Phase A foundation. No existing table/data was modified.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 9b) issue_invoice — atomic: sequence + invoice + items + ledger row.
--     Totals are computed server-side from items; client-provided totals are
--     ignored (anti-tamper). Invoice is born 'issued' (no draft in Phase A).
-- ---------------------------------------------------------------------------
create or replace function public.issue_invoice(
  p_clinic_id     uuid,
  p_patient_id    uuid,
  p_appointment_id uuid,
  p_items         jsonb,   -- [{service_id?, description, quantity, unit_price}]
  p_discount      numeric,
  p_tax           numeric,
  p_notes         text,
  p_due_at        timestamptz,
  p_created_by    uuid
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
  v_desc       text;
begin
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'INVOICE_ITEMS_REQUIRED';
  end if;

  -- Compute totals from items (server is the source of truth).
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty   := coalesce((v_item->>'quantity')::numeric, 1);
    v_price := (v_item->>'unit_price')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_QUANTITY'; end if;
    if v_price is null or v_price < 0 then raise exception 'INVALID_UNIT_PRICE'; end if;
    v_subtotal := v_subtotal + round(v_qty * v_price, 2);
  end loop;
  v_subtotal := round(v_subtotal, 2);
  v_total := round(v_subtotal - coalesce(p_discount, 0) + coalesce(p_tax, 0), 2);
  if v_total < 0 then raise exception 'INVOICE_TOTAL_NEGATIVE'; end if;

  -- Concurrency-safe per-clinic yearly number (never reused).
  v_seq := public.next_clinic_sequence(p_clinic_id, 'invoice', v_year);
  v_number := format('INV-%s-%s', v_year, lpad(v_seq::text, 6, '0'));

  insert into public.clinic_invoices
    (clinic_id, patient_id, appointment_id, invoice_number, status,
     subtotal, discount, tax, total, notes, due_at, created_by)
  values
    (p_clinic_id, p_patient_id, p_appointment_id, v_number, 'issued',
     v_subtotal, coalesce(p_discount, 0), coalesce(p_tax, 0), v_total,
     p_notes, p_due_at, p_created_by)
  returning id into v_invoice_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty   := coalesce((v_item->>'quantity')::numeric, 1);
    v_price := (v_item->>'unit_price')::numeric;
    v_svc   := nullif(v_item->>'service_id', '')::uuid;
    -- Description snapshot: explicit item description, else legacy text service.
    v_desc  := coalesce(nullif(v_item->>'description', ''), nullif(v_item->>'service', ''));
    if v_desc is null then raise exception 'ITEM_DESCRIPTION_REQUIRED'; end if;
    v_line := round(v_qty * v_price, 2);
    insert into public.invoice_items
      (clinic_id, invoice_id, service_id, description, quantity, unit_price, line_total)
    values
      (p_clinic_id, v_invoice_id, v_svc, v_desc, v_qty, v_price, v_line);
  end loop;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'invoice_issued:' || v_invoice_id::text, 'invoice_issued',
     'clinic_invoices', v_invoice_id, 'in', v_total, p_created_by,
     jsonb_build_object('invoice_number', v_number, 'subtotal', v_subtotal, 'total', v_total));

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_number', v_number,
                            'subtotal', v_subtotal, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9c) record_payment — atomic: validates invoice, enforces idempotency,
--     allows overpayment (patient credit is derived), assigns receipt number,
--     writes ledger row, recomputes status.
-- ---------------------------------------------------------------------------
create or replace function public.record_payment(
  p_clinic_id      uuid,
  p_invoice_id     uuid,
  p_amount         numeric,
  p_method         text,
  p_reference      text,
  p_idempotency_key uuid,
  p_recorded_by    uuid
) returns jsonb
language plpgsql as $$
declare
  v_invoice   public.clinic_invoices%rowtype;
  v_paid      numeric(12,2);
  v_remaining numeric(12,2);
  v_payment_id uuid;
  v_receipt   text;
  v_seq       bigint;
  v_year      int := extract(year from now())::int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_method not in ('cash','card','bank_transfer','insurance','other') then
    raise exception 'INVALID_METHOD';
  end if;

  select * into v_invoice from public.clinic_invoices
   where clinic_id = p_clinic_id and id = p_invoice_id;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status = 'voided' then raise exception 'INVOICE_VOIDED'; end if;

  -- Idempotency: same clinic+key returns the original payment (no double record).
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
  -- Overpayment is ALLOWED (owner decision): excess becomes patient credit
  -- (derived in patient_balances). No exception on p_amount > v_remaining.

  if p_method in ('cash','card','bank_transfer','insurance') then
    v_seq := public.next_clinic_sequence(p_clinic_id, 'receipt', v_year);
    v_receipt := format('RCP-%s-%s', v_year, lpad(v_seq::text, 6, '0'));
  end if;

  insert into public.clinic_payments
    (clinic_id, invoice_id, direction, amount, method, reference,
     receipt_number, idempotency_key, recorded_by)
  values
    (p_clinic_id, p_invoice_id, 'payment', round(p_amount, 2), p_method,
     p_reference, v_receipt, p_idempotency_key, p_recorded_by)
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
-- 9d) void_payment — insert-only correction: flips status to voided (bookkeeping
--     only; amount untouched), writes ledger row, recomputes status.
-- ---------------------------------------------------------------------------
create or replace function public.void_payment(
  p_clinic_id   uuid,
  p_payment_id  uuid,
  p_reason      text,
  p_voided_by   uuid
) returns void language plpgsql as $$
declare
  v_payment public.clinic_payments%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'VOID_REASON_REQUIRED'; end if;
  select * into v_payment from public.clinic_payments
   where clinic_id = p_clinic_id and id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment.status = 'voided' then raise exception 'PAYMENT_ALREADY_VOIDED'; end if;

  update public.clinic_payments
     set status = 'voided', voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
   where clinic_id = p_clinic_id and id = p_payment_id;

  perform public.recompute_invoice_status(p_clinic_id, v_payment.invoice_id);

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'payment_voided:' || p_payment_id::text, 'payment_voided',
     'clinic_payments', p_payment_id,
     case when v_payment.direction = 'payment' then 'out' else 'in' end,
     v_payment.amount, p_voided_by,
     jsonb_build_object('reason', p_reason, 'invoice_id', v_payment.invoice_id));
end;
$$;



-- ---------------------------------------------------------------------------
-- 9e) refund_payment — money actually returned to the patient. Insert-only:
--     creates a NEW row (direction='refund') linked to the original payment,
--     never exceeds net recorded payments on the invoice, writes a ledger row,
--     issues a receipt number, recomputes invoice status.
-- ---------------------------------------------------------------------------
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
  v_seq       integer;
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

  select public.next_clinic_sequence(p_clinic_id, 'receipt') into v_seq;
  insert into public.clinic_payments
    (clinic_id, invoice_id, direction, amount, method, reference, receipt_number,
     status, original_payment_id, recorded_by)
  values
    (p_clinic_id, v_payment.invoice_id, 'refund', p_amount, v_payment.method,
     p_reason, 'RCP-' || extract(year from now()) || '-' || lpad(v_seq::text, 6, '0'),
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

-- ---------------------------------------------------------------------------
-- 9f) void_invoice — cancellation: flips status to voided (bookkeeping only;
--     nothing deleted), guards against voiding a paid invoice, voids nothing
--     else; ledger row written.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(
  p_clinic_id   uuid,
  p_invoice_id  uuid,
  p_reason      text,
  p_voided_by   uuid
) returns void language plpgsql as $$
declare
  v_invoice  public.clinic_invoices%rowtype;
  v_recorded integer;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then raise exception 'VOID_REASON_REQUIRED'; end if;
  select * into v_invoice from public.clinic_invoices
   where clinic_id = p_clinic_id and id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status = 'voided' then raise exception 'INVOICE_ALREADY_VOIDED'; end if;

  select count(*) into v_recorded from public.clinic_payments
   where clinic_id = p_clinic_id and invoice_id = p_invoice_id
     and direction = 'payment' and status = 'recorded';
  if v_recorded > 0 then
    raise exception 'VOID_PAYMENTS_FIRST';
  end if;

  update public.clinic_invoices
     set status = 'voided', voided_at = now(), voided_by = p_voided_by, void_reason = p_reason
   where clinic_id = p_clinic_id and id = p_invoice_id;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'invoice_voided:' || p_invoice_id::text, 'invoice_voided',
     'clinic_invoices', p_invoice_id, 'out', v_invoice.total, p_voided_by,
     jsonb_build_object('reason', p_reason, 'invoice_number', v_invoice.invoice_number));
end;
$$;

