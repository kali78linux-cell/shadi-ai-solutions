-- ============================================================================
-- 20260903_accounting_phase_c.sql — Accounting Phase C
-- Expenses / Expense Categories / Cash Register / Daily Cash Closing
--
-- ADDITIVE / BACKWARD-COMPATIBLE / IDEMPOTENT (safe to re-run; same posture
-- and patterns as Accounting Phase A — 20260901 and Phase B — 20260902).
--
-- Encoded owner decisions (Phase C mandate):
--   * Expenses are IMMUTABLE financial movements: insert-only rows, a wrong
--     entry is VOIDED (status), never edited or deleted (void-not-delete).
--   * Ledger kinds (D4 dictionary): `expense_recorded` (direction 'out',
--     ref_table clinic_expenses) + `expense_voided` (bookkeeping reversal,
--     direction 'in'). Added via additive CHECK extension + documentation in
--     docs/financial-ledger-kinds.md. No ad-hoc columns, no JSONB semantics.
--   * Expense Categories are per-clinic CONFIG (not financial movements):
--     renamable / deactivatable (is_active), NEVER deleted; expenses keep a
--     composite tenant FK (clinic_id, category_id) so a category of another
--     clinic can never be attached.
--   * Payment method on expenses is NEVER assumed Cash-only (principle #11):
--     method in ('cash','card','bank_transfer','other') — payer types such as
--     insurance/employer are NOT expense payment methods.
--   * Cash Register foundation: `clinic_cash_sessions` — one OPEN session per
--     clinic (partial unique index), opening_amount >= 0, close computes the
--     expected cash from the ledger and stores counted/variance as a snapshot.
--   * Daily Cash Closing is DERIVED (view `daily_cash_positions`, never
--     stored). Its cash-flow source is EXPLICITLY the documented ledger kinds
--     (payment_recorded / refund_recorded / expense_recorded) filtered by
--     method='cash' — NEVER `direction` alone (D4 cash-flow protection).
--   * Cash VARIANCE is displayed as a snapshot on the closed session only —
--     it is NOT booked as any ledger kind. Variance handling (gain/loss
--     posting) is a documented PENDING DESIGN DECISION requiring a new D4
--     kind + owner approval before implementation.
--   * Business dates in the derived view use UTC for now; timezone-aware
--     business dates arrive with Localization Foundation (D3 country/clinic
--     profile) and will not require any schema change to this view's inputs.
--   * Per-clinic yearly numbering EXP-{year}-{seq} via clinic_sequences
--     (kind 'expense' appended to the kind CHECK — additive).
--
-- Platform Billing (subscriptions/billing_plans/Stripe) is NEVER touched.
-- No historical migration is modified.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) clinic_sequences — append 'expense' kind (additive CHECK re-create;
--    numbers move forward only and are never reused, same as INV/RCP).
-- ---------------------------------------------------------------------------
alter table public.clinic_sequences
  drop constraint if exists clinic_sequences_kind_check;
alter table public.clinic_sequences
  add constraint clinic_sequences_kind_check
  check (kind in ('invoice', 'receipt', 'expense'));

-- ---------------------------------------------------------------------------
-- 2) clinic_expense_categories — per-clinic configurable expense categories.
--    CONFIG rows (not financial movements): rename/deactivate allowed,
--    DELETE is forbidden forever (history safety).
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_expense_categories (
  id         uuid primary key default gen_random_uuid(),
  clinic_id  uuid not null references public.clinics (id) on delete cascade,
  name       text not null check (length(btrim(name)) > 0),
  is_active  boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (clinic_id, name)
);
create index if not exists idx_clinic_expense_categories_clinic
  on public.clinic_expense_categories (clinic_id, is_active);
create unique index if not exists clinic_expense_categories_clinic_id_id_key
  on public.clinic_expense_categories (clinic_id, id);

create or replace function public.clinic_expense_categories_guard_update()
returns trigger language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id
     or new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'clinic_expense_categories identity columns are immutable';
  end if;
  new.name = btrim(new.name);
  if length(new.name) = 0 then raise exception 'CATEGORY_NAME_REQUIRED'; end if;
  return new;
end;
$$;
drop trigger if exists clinic_expense_categories_guard on public.clinic_expense_categories;
create trigger clinic_expense_categories_guard
  before update on public.clinic_expense_categories
  for each row execute function public.clinic_expense_categories_guard_update();

drop trigger if exists clinic_expense_categories_no_delete on public.clinic_expense_categories;
create trigger clinic_expense_categories_no_delete
  before delete on public.clinic_expense_categories
  for each row execute function public.forbid_financial_mutation();

-- ---------------------------------------------------------------------------
-- 3) clinic_expenses — immutable expense movements (insert-only + void).
--    method is NOT cash-only (principle #11). Idempotency via nullable key.
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_expenses (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics (id) on delete cascade,
  category_id     uuid,
  expense_number  text not null,
  amount          numeric(12,2) not null check (amount > 0),
  method          text not null default 'cash'
                  check (method in ('cash', 'card', 'bank_transfer', 'other')),
  vendor          text,
  reference       text,
  notes           text,
  spent_at        timestamptz not null default now(),
  status          text not null default 'recorded'
                  check (status in ('recorded', 'voided')),
  idempotency_key uuid,
  voided_at       timestamptz,
  voided_by       uuid,
  void_reason     text,
  recorded_by     uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (clinic_id, expense_number),
  -- Cross-tenant composite FK: another clinic's category can never be attached.
  foreign key (clinic_id, category_id)
    references public.clinic_expense_categories (clinic_id, id) on delete set null
);
create index if not exists idx_clinic_expenses_clinic_spent
  on public.clinic_expenses (clinic_id, spent_at);
create index if not exists idx_clinic_expenses_category
  on public.clinic_expenses (clinic_id, category_id);
create index if not exists idx_clinic_expenses_status
  on public.clinic_expenses (clinic_id, status);
create unique index if not exists clinic_expenses_idempotency_key
  on public.clinic_expenses (clinic_id, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists clinic_expenses_clinic_id_id_key
  on public.clinic_expenses (clinic_id, id);

-- Immutability: core columns frozen forever; only void bookkeeping may change.
create or replace function public.clinic_expenses_guard_update()
returns trigger language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id
     or new.category_id is distinct from old.category_id
     or new.expense_number is distinct from old.expense_number
     or new.amount is distinct from old.amount
     or new.method is distinct from old.method
     or new.vendor is distinct from old.vendor
     or new.reference is distinct from old.reference
     or new.notes is distinct from old.notes
     or new.spent_at is distinct from old.spent_at
     or new.idempotency_key is distinct from old.idempotency_key
     or new.recorded_by is distinct from old.recorded_by
     or new.created_at is distinct from old.created_at then
    raise exception 'clinic_expenses core columns are immutable (void instead)';
  end if;
  if old.status = 'voided' and new.status <> 'voided' then
    raise exception 'EXPENSE_VOIDED_IS_TERMINAL';
  end if;
  if new.status = 'voided' and old.status <> 'voided'
     and (new.voided_at is null
          or new.void_reason is null or length(btrim(new.void_reason)) = 0) then
    raise exception 'VOID_REASON_REQUIRED';
  end if;
  return new;
end;
$$;
drop trigger if exists clinic_expenses_immutable on public.clinic_expenses;
create trigger clinic_expenses_immutable
  before update on public.clinic_expenses
  for each row execute function public.clinic_expenses_guard_update();

drop trigger if exists clinic_expenses_no_delete on public.clinic_expenses;
create trigger clinic_expenses_no_delete
  before delete on public.clinic_expenses
  for each row execute function public.forbid_financial_mutation();



-- ---------------------------------------------------------------------------
-- 4) Ledger kind dictionary extension (D4): allow expense_recorded +
--    expense_voided. Additive: all Phase A/B kinds remain valid.
-- ---------------------------------------------------------------------------
alter table public.financial_transactions
  drop constraint if exists financial_transactions_event_type_check;
alter table public.financial_transactions
  add constraint financial_transactions_event_type_check
  check (event_type in ('invoice_issued', 'invoice_voided', 'payment_recorded',
                        'payment_voided', 'refund_recorded', 'write_off_recorded',
                        'expense_recorded', 'expense_voided'));

-- ---------------------------------------------------------------------------
-- 5) clinic_cash_sessions — Cash Register foundation. One OPEN session per
--    clinic (partial unique index). Closing stores counted_amount and the
--    derived variance as a SNAPSHOT (bookkeeping, not a ledger movement).
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_cash_sessions (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics (id) on delete cascade,
  opening_amount   numeric(12,2) not null default 0 check (opening_amount >= 0),
  status           text not null default 'open' check (status in ('open', 'closed')),
  opened_by        uuid,
  opened_at        timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        uuid,
  expected_closing numeric(12,2),
  counted_amount   numeric(12,2),
  variance         numeric(12,2),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists clinic_cash_sessions_one_open_per_clinic
  on public.clinic_cash_sessions (clinic_id)
  where status = 'open';
create index if not exists idx_clinic_cash_sessions_clinic_opened
  on public.clinic_cash_sessions (clinic_id, opened_at);

create or replace function public.clinic_cash_sessions_guard_update()
returns trigger language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id
     or new.opened_at is distinct from old.opened_at
     or new.opened_by is distinct from old.opened_by
     or new.opening_amount is distinct from old.opening_amount
     or new.created_at is distinct from old.created_at then
    raise exception 'clinic_cash_sessions opening snapshot is immutable';
  end if;
  if old.status = 'closed' and new.status <> 'closed' then
    raise exception 'CASH_SESSION_CLOSED_IS_TERMINAL';
  end if;
  if new.status = 'closed' and old.status = 'open'
     and (new.closed_at is null
          or new.expected_closing is null or new.counted_amount is null
          or new.variance is null) then
    raise exception 'CASH_SESSION_CLOSE_SNAPSHOT_INCOMPLETE';
  end if;
  return new;
end;
$$;
drop trigger if exists clinic_cash_sessions_guard on public.clinic_cash_sessions;
create trigger clinic_cash_sessions_guard
  before update on public.clinic_cash_sessions
  for each row execute function public.clinic_cash_sessions_guard_update();

drop trigger if exists clinic_cash_sessions_no_delete on public.clinic_cash_sessions;
create trigger clinic_cash_sessions_no_delete
  before delete on public.clinic_cash_sessions
  for each row execute function public.forbid_financial_mutation();

-- ---------------------------------------------------------------------------
-- 6) RLS — enabled with NO policies (deny-all for anon/authenticated),
--    identical posture to every Phase A/B financial table. All access is
--    server-side via the service-role client after authorizeClinicRequest
--    + the Phase C FINANCE role gates.
-- ---------------------------------------------------------------------------
alter table public.clinic_expense_categories enable row level security;
alter table public.clinic_expenses           enable row level security;
alter table public.clinic_cash_sessions      enable row level security;

-- ---------------------------------------------------------------------------
-- 7) Atomic RPCs (SECURITY DEFINER, same posture as Phase A/B RPCs). All
--    invariants are enforced HERE so they hold regardless of caller. Each
--    function runs in a single implicit transaction: movement + ledger row
--    are atomic.
-- ---------------------------------------------------------------------------

-- record_expense — atomic: category guard + sequence + expense + ledger row.
-- Idempotent on (clinic_id, idempotency_key): a retry returns the existing
-- expense gracefully (same contract as record_payment / record_write_off).
create or replace function public.record_expense(
  p_clinic_id       uuid,
  p_category_id     uuid,
  p_amount          numeric,
  p_method          text,
  p_spent_at        timestamptz,
  p_vendor          text,
  p_reference       text,
  p_notes           text,
  p_idempotency_key uuid,
  p_recorded_by     uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_number     text;
  v_year       int := extract(year from now())::int;
  v_seq        bigint;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'EXPENSE_AMOUNT_INVALID'; end if;
  if p_method is null or p_method not in ('cash', 'card', 'bank_transfer', 'other') then
    raise exception 'EXPENSE_METHOD_INVALID';
  end if;
  if p_spent_at is not null and p_spent_at > now() + interval '1 day' then
    raise exception 'EXPENSE_SPENT_AT_INVALID';
  end if;

  -- Idempotency: same clinic + key already recorded => return it gracefully.
  if p_idempotency_key is not null then
    select id into v_expense_id
      from public.clinic_expenses
     where clinic_id = p_clinic_id and idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return jsonb_build_object('expense_id', v_expense_id, 'duplicate', true);
    end if;
  end if;

  -- Category must exist in THIS clinic and be active (cross-tenant is
  -- impossible via the composite FK; activity is enforced here).
  if p_category_id is not null then
    perform 1 from public.clinic_expense_categories
     where clinic_id = p_clinic_id and id = p_category_id and is_active;
    if not found then raise exception 'EXPENSE_CATEGORY_INVALID'; end if;
  end if;

  select public.next_clinic_sequence(p_clinic_id, 'expense', v_year) into v_seq;
  v_number := 'EXP-' || v_year || '-' || lpad(v_seq::text, 6, '0');

  insert into public.clinic_expenses
    (clinic_id, category_id, expense_number, amount, method, vendor, reference,
     notes, spent_at, idempotency_key, recorded_by)
  values
    (p_clinic_id, p_category_id, v_number, round(p_amount, 2), p_method,
     p_vendor, p_reference, p_notes,
     coalesce(p_spent_at, now()), p_idempotency_key, p_recorded_by)
  returning id into v_expense_id;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'expense_recorded:' || v_expense_id::text, 'expense_recorded',
     'clinic_expenses', v_expense_id, 'out', round(p_amount, 2), p_recorded_by,
     jsonb_build_object('expense_number', v_number, 'method', p_method,
                        'category_id', p_category_id, 'vendor', p_vendor));

  return jsonb_build_object('expense_id', v_expense_id, 'expense_number', v_number,
                            'duplicate', false);
end;
$$;

-- void_expense — bookkeeping void (nothing deleted); ledger reversal row.
create or replace function public.void_expense(
  p_clinic_id   uuid,
  p_expense_id  uuid,
  p_reason      text,
  p_voided_by   uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expense public.clinic_expenses%rowtype;
begin
  if p_reason is null or length(btrim(p_reason)) = 0 then raise exception 'VOID_REASON_REQUIRED'; end if;
  select * into v_expense from public.clinic_expenses
   where clinic_id = p_clinic_id and id = p_expense_id
   for update;
  if not found then raise exception 'EXPENSE_NOT_FOUND'; end if;
  if v_expense.status = 'voided' then raise exception 'EXPENSE_ALREADY_VOIDED'; end if;

  update public.clinic_expenses
     set status = 'voided', voided_at = now(), voided_by = p_voided_by,
         void_reason = btrim(p_reason), updated_at = now()
   where clinic_id = p_clinic_id and id = p_expense_id;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'expense_voided:' || p_expense_id::text, 'expense_voided',
     'clinic_expenses', p_expense_id, 'in', v_expense.amount, p_voided_by,
     jsonb_build_object('reason', btrim(p_reason), 'expense_number', v_expense.expense_number));
end;
$$;


-- open_cash_session — one open session per clinic (partial unique index is
-- the physical race backstop).
create or replace function public.open_cash_session(
  p_clinic_id      uuid,
  p_opening_amount numeric,
  p_opened_by      uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id uuid;
begin
  if p_opening_amount is null or p_opening_amount < 0 then
    raise exception 'CASH_OPENING_INVALID';
  end if;
  select id into v_session_id
    from public.clinic_cash_sessions
   where clinic_id = p_clinic_id and status = 'open'
   limit 1;
  if found then raise exception 'CASH_SESSION_ALREADY_OPEN'; end if;

  insert into public.clinic_cash_sessions (clinic_id, opening_amount, opened_by)
  values (p_clinic_id, round(p_opening_amount, 2), p_opened_by)
  returning id into v_session_id;

  return jsonb_build_object('session_id', v_session_id,
                            'opening_amount', round(p_opening_amount, 2));
end;
$$;

-- close_cash_session — computes the expected cash from the ledger using ONLY
-- explicit documented kinds (payment_recorded / refund_recorded /
-- expense_recorded) filtered by method='cash' — NEVER direction alone.
-- Variance = counted - expected is stored as a snapshot; it is NOT booked to
-- the ledger (pending documented design decision for any variance kind).
create or replace function public.close_cash_session(
  p_clinic_id      uuid,
  p_session_id     uuid,
  p_counted_amount numeric,
  p_notes          text,
  p_closed_by      uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session   public.clinic_cash_sessions%rowtype;
  v_cash_in   numeric(12,2) := 0;
  v_cash_out  numeric(12,2) := 0;
  v_expected  numeric(12,2);
  v_variance  numeric(12,2);
begin
  if p_counted_amount is null or p_counted_amount < 0 then
    raise exception 'CASH_COUNTED_INVALID';
  end if;

  select * into v_session from public.clinic_cash_sessions
   where clinic_id = p_clinic_id and id = p_session_id
   for update;
  if not found then raise exception 'CASH_SESSION_NOT_FOUND'; end if;
  if v_session.status <> 'open' then raise exception 'CASH_SESSION_ALREADY_CLOSED'; end if;

  -- Cash IN: payment_recorded on cash-method payments (recorded only).
  select coalesce(sum(ft.amount), 0) into v_cash_in
    from public.financial_transactions ft
    join public.clinic_payments p
      on p.id = ft.ref_id and p.clinic_id = ft.clinic_id
   where ft.clinic_id = p_clinic_id
     and ft.event_type = 'payment_recorded'
     and p.status = 'recorded' and p.direction = 'payment' and p.method = 'cash'
     and ft.occurred_at >= v_session.opened_at;

  -- Cash OUT: refund_recorded on cash-method refunds (refund rows inherit the
  -- original payment's method) + expense_recorded on cash-method expenses
  -- (recorded only). Explicit kinds — never direction alone.
  select coalesce(sum(ft.amount), 0) into v_cash_out
    from public.financial_transactions ft
    join public.clinic_payments p
      on p.id = ft.ref_id and p.clinic_id = ft.clinic_id
   where ft.clinic_id = p_clinic_id
     and ft.event_type = 'refund_recorded'
     and p.status = 'recorded' and p.method = 'cash'
     and ft.occurred_at >= v_session.opened_at;
  select v_cash_out + coalesce(sum(ft.amount), 0) into v_cash_out
    from public.financial_transactions ft
    join public.clinic_expenses e
      on e.id = ft.ref_id and e.clinic_id = ft.clinic_id
   where ft.clinic_id = p_clinic_id
     and ft.event_type = 'expense_recorded'
     and e.status = 'recorded' and e.method = 'cash'
     and ft.occurred_at >= v_session.opened_at;

  v_expected := v_session.opening_amount + v_cash_in - v_cash_out;
  v_variance := round(p_counted_amount, 2) - v_expected;

  update public.clinic_cash_sessions
     set status = 'closed', closed_at = now(), closed_by = p_closed_by,
         expected_closing = v_expected, counted_amount = round(p_counted_amount, 2),
         variance = v_variance, notes = p_notes, updated_at = now()
   where clinic_id = p_clinic_id and id = p_session_id;

  return jsonb_build_object('session_id', p_session_id,
                            'opening_amount', v_session.opening_amount,
                            'cash_in', v_cash_in, 'cash_out', v_cash_out,
                            'expected_closing', v_expected,
                            'counted_amount', round(p_counted_amount, 2),
                            'variance', v_variance);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) daily_cash_positions — DERIVED daily cash closing view (never stored).
--    Source of truth: the ledger's EXPLICIT kinds (payment_recorded /
--    refund_recorded / expense_recorded) joined to their source rows for
--    method='cash' + recorded status. `direction` is never used as a cash
--    signal. Voided movements drop out via the status filters. Business
--    dates are UTC for now (D3: clinic timezone arrives with Localization
--    Foundation — no schema change needed to this view's inputs).
-- ---------------------------------------------------------------------------
create or replace view public.daily_cash_positions as
with ev as (
  select ft.clinic_id, ft.event_type, ft.ref_id, ft.amount, ft.occurred_at
  from public.financial_transactions ft
  where ft.event_type in ('payment_recorded', 'refund_recorded', 'expense_recorded')
),
cash_pay as (
  select ev.clinic_id,
         (ev.occurred_at at time zone 'utc')::date as business_date,
         ev.event_type,
         ev.amount
  from ev
  join public.clinic_payments p
    on p.id = ev.ref_id and p.clinic_id = ev.clinic_id
  where p.status = 'recorded' and p.method = 'cash'
),
cash_exp as (
  select ev.clinic_id,
         (ev.occurred_at at time zone 'utc')::date as business_date,
         ev.amount
  from ev
  join public.clinic_expenses e
    on e.id = ev.ref_id and e.clinic_id = ev.clinic_id
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
  coalesce(p.clinic_id, x.clinic_id)        as clinic_id,
  coalesce(p.business_date, x.business_date) as business_date,
  coalesce(p.cash_in, 0)                     as cash_in,
  coalesce(p.cash_out_refunds, 0) + coalesce(x.cash_out_expenses, 0) as cash_out,
  coalesce(p.cash_in, 0) - coalesce(p.cash_out_refunds, 0)
    - coalesce(x.cash_out_expenses, 0)       as net_cash
from pay_days p
full outer join exp_days x
  on x.clinic_id = p.clinic_id and x.business_date = p.business_date;

-- ============================================================================
-- END — Accounting Phase C. No existing table/data was modified; no
-- historical migration touched; Platform Billing never referenced.
-- ============================================================================

