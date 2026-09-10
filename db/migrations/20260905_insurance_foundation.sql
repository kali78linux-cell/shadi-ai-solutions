-- ============================================================================
-- 20260905_insurance_foundation.sql — Insurance Foundation (D8: skeleton)
--
-- clinic_payers / clinic_patient_coverages / clinic_claims (SKELETON ONLY)
-- + D-I1 composite payer FK wiring + D4 ledger kinds claim_recorded /
-- claim_settled + 'claim' sequence kind.
--
-- Encoded owner decisions:
--   * D-I1 — clinic_invoices.payer_ref / clinic_payments.payer_ref gain
--     composite tenant FKs → clinic_payers (cross-tenant payer refs are
--     impossible). All existing payer_ref values are NULL → no data change.
--   * D-I2 — Claims skeleton: draft → submitted → settled | rejected.
--     claim_settled is NOT a cash movement and NEVER creates a payment;
--     money is recorded ONLY via the existing record_payment RPC
--     (payment_recorded). clinic_payments.claim_id is an additive nullable
--     reference for traceability (no behavior change).
--   * D-I3 — Coverage = configuration/data foundation ONLY: policy/member
--     reference, coverage percent, effective dates, status. NO auto split,
--     NO adjudication, NO deductible/co-pay engines.
--   * D-I4 — RBAC: FINANCE gates only (FINANCE_ADMIN_ROLES /
--     FINANCE_READ_ROLES). DATA_ROLES untouched.
--   * D-I5 — legacy clinic_payments.method='insurance' stays untouched as a
--     legacy signal; no new path uses it; claims are the insurance entity,
--     payments remain the financial movement.
--
-- No historical migration touched. Additive only. Ledger semantics: cash
-- events remain ONLY payment_recorded/refund_recorded (explicit kinds —
-- direction is never a cash signal).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) clinic_payers — per-clinic payer directory (insurance/employer/3rd-party).
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_payers (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references public.clinics (id) on delete cascade,
  name          text not null,
  payer_type    text not null check (payer_type in ('insurance', 'employer', 'third_party')),
  contact_name  text,
  contact_phone text,
  notes         text default '',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (clinic_id, id)
);

-- ---------------------------------------------------------------------------
-- 2) clinic_patient_coverages — configuration/data foundation ONLY (D-I3).
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_patient_coverages (
  id               uuid primary key default gen_random_uuid(),
  clinic_id        uuid not null references public.clinics (id) on delete cascade,
  patient_id       uuid not null,
  payer_id         uuid not null,
  policy_number    text not null,
  member_ref       text,
  coverage_percent numeric(5,2)
                   check (coverage_percent is null or (coverage_percent >= 0 and coverage_percent <= 100)),
  effective_from   date not null,
  effective_to     date check (effective_to is null or effective_to >= effective_from),
  status           text not null default 'active' check (status in ('active', 'suspended', 'ended')),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  foreign key (clinic_id, patient_id) references public.patients (clinic_id, id) on delete cascade,
  foreign key (clinic_id, payer_id)   references public.clinic_payers (clinic_id, id) on delete restrict,
  unique (clinic_id, id)
);
create index if not exists clinic_patient_coverages_clinic_patient_idx
  on public.clinic_patient_coverages (clinic_id, patient_id);

-- ---------------------------------------------------------------------------
-- 3) clinic_claims — SKELETON lifecycle: draft → submitted → settled|rejected.
--    The claim is the INSURANCE entity; the payment remains the financial
--    movement (D-I2/D-I5). Immutable core: no delete, no clinic_id change.
-- ---------------------------------------------------------------------------
create table if not exists public.clinic_claims (
  id              uuid primary key default gen_random_uuid(),
  clinic_id       uuid not null references public.clinics (id) on delete cascade,
  claim_number    text not null unique,
  patient_id      uuid not null,
  payer_id        uuid not null,
  invoice_id      uuid not null,
  coverage_id     uuid,
  status          text not null default 'draft'
                  check (status in ('draft', 'submitted', 'settled', 'rejected')),
  claimed_amount  numeric(12,2) not null check (claimed_amount > 0),
  settled_amount  numeric(12,2) check (settled_amount is null or settled_amount >= 0),
  submitted_at    timestamptz,
  settled_at      timestamptz,
  rejection_reason text,
  external_ref    text,
  idempotency_key uuid unique,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (clinic_id, patient_id)  references public.patients (clinic_id, id) on delete restrict,
  foreign key (clinic_id, payer_id)    references public.clinic_payers (clinic_id, id) on delete restrict,
  foreign key (clinic_id, invoice_id)  references public.clinic_invoices (clinic_id, id) on delete restrict,
  foreign key (clinic_id, coverage_id) references public.clinic_patient_coverages (clinic_id, id) on delete set null,
  unique (clinic_id, id)
);
create index if not exists clinic_claims_clinic_invoice_idx
  on public.clinic_claims (clinic_id, invoice_id);
create index if not exists clinic_claims_clinic_status_idx
  on public.clinic_claims (clinic_id, status);

-- ---------------------------------------------------------------------------
-- 4) Guards — append-only posture: DELETE blocked, clinic_id immutable
--    (same pattern as clinic_expenses / clinic_cash_sessions guards).
-- ---------------------------------------------------------------------------
create or replace function public.clinic_payers_guard_del() returns trigger
language plpgsql as $$
begin
  raise exception 'PAYERS_IMMUTABLE';
end;
$$;

create or replace function public.clinic_payers_guard_upd() returns trigger
language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'PAYER_TENANT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_payers_guard_delete on public.clinic_payers;
create trigger clinic_payers_guard_delete
  before delete on public.clinic_payers
  for each row execute function public.clinic_payers_guard_del();

drop trigger if exists clinic_payers_guard_update on public.clinic_payers;
create trigger clinic_payers_guard_update
  before update on public.clinic_payers
  for each row execute function public.clinic_payers_guard_upd();

create or replace function public.clinic_coverages_guard_del() returns trigger
language plpgsql as $$
begin
  raise exception 'COVERAGES_IMMUTABLE';
end;
$$;

create or replace function public.clinic_coverages_guard_upd() returns trigger
language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'COVERAGE_TENANT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_patient_coverages_guard_delete on public.clinic_patient_coverages;
create trigger clinic_patient_coverages_guard_delete
  before delete on public.clinic_patient_coverages
  for each row execute function public.clinic_coverages_guard_del();

drop trigger if exists clinic_patient_coverages_guard_update on public.clinic_patient_coverages;
create trigger clinic_patient_coverages_guard_update
  before update on public.clinic_patient_coverages
  for each row execute function public.clinic_coverages_guard_upd();

create or replace function public.clinic_claims_guard_del() returns trigger
language plpgsql as $$
begin
  raise exception 'CLAIMS_IMMUTABLE';
end;
$$;

create or replace function public.clinic_claims_guard_upd() returns trigger
language plpgsql as $$
begin
  if new.clinic_id is distinct from old.clinic_id then
    raise exception 'CLAIM_TENANT_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists clinic_claims_guard_delete on public.clinic_claims;
create trigger clinic_claims_guard_delete
  before delete on public.clinic_claims
  for each row execute function public.clinic_claims_guard_del();

drop trigger if exists clinic_claims_guard_update on public.clinic_claims;
create trigger clinic_claims_guard_update
  before update on public.clinic_claims
  for each row execute function public.clinic_claims_guard_upd();

-- ---------------------------------------------------------------------------
-- 5) D-I1 — composite payer FK wiring (additive; all existing payer_ref are
--    NULL → no data change; cross-tenant payer references become impossible).
-- ---------------------------------------------------------------------------
do $$
begin
  alter table public.clinic_invoices
    add constraint clinic_invoices_payer_ref_tenant_fkey
    foreign key (clinic_id, payer_ref) references public.clinic_payers (clinic_id, id);
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.clinic_payments
    add constraint clinic_payments_payer_ref_tenant_fkey
    foreign key (clinic_id, payer_ref) references public.clinic_payers (clinic_id, id);
exception when duplicate_object then null;
end $$;

-- D-I2: additive nullable claim reference on payments (traceability ONLY —
-- no behavior change; settlement never creates a payment automatically).
alter table public.clinic_payments
  add column if not exists claim_id uuid;

do $$
begin
  alter table public.clinic_payments
    add constraint clinic_payments_claim_tenant_fkey
    foreign key (clinic_id, claim_id) references public.clinic_claims (clinic_id, id);
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 6) D4 dictionary — additive ledger kinds + 'claim' sequence kind.
-- ---------------------------------------------------------------------------
alter table public.financial_transactions
  drop constraint if exists financial_transactions_event_type_check;
alter table public.financial_transactions
  add constraint financial_transactions_event_type_check
  check (event_type in ('invoice_issued', 'invoice_voided', 'payment_recorded',
                        'payment_voided', 'refund_recorded', 'write_off_recorded',
                        'expense_recorded', 'expense_voided',
                        'claim_recorded', 'claim_settled'));

alter table public.clinic_sequences
  drop constraint if exists clinic_sequences_kind_check;
alter table public.clinic_sequences
  add constraint clinic_sequences_kind_check
  check (kind in ('invoice', 'receipt', 'expense', 'claim'));

-- ---------------------------------------------------------------------------
-- 7) RLS — mandatory deny-all posture (service role bypasses; same as the
--    whole accounting + localization surface).
-- ---------------------------------------------------------------------------
alter table public.clinic_payers             enable row level security;
alter table public.clinic_patient_coverages  enable row level security;
alter table public.clinic_claims             enable row level security;

-- ---------------------------------------------------------------------------
-- 8) Atomic claim RPCs (SECURITY DEFINER, same posture as accounting RPCs).
--    The claim is the INSURANCE entity (D-I2): claim_settled is NOT cash and
--    NEVER creates a payment — money enters ONLY via record_payment
--    (payment_recorded). Direction is an accounting-sign convention; cash
--    filtering stays explicit-kind based (D4).
-- ---------------------------------------------------------------------------

create or replace function public.create_insurance_claim(
  p_clinic_id       uuid,
  p_patient_id      uuid,
  p_payer_id        uuid,
  p_invoice_id      uuid,
  p_claimed_amount  numeric,
  p_coverage_id     uuid default null,
  p_external_ref    text default null,
  p_created_by      uuid default null,
  p_idempotency_key uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim_id   uuid;
  v_number     text;
  v_year       int := extract(year from now())::int;
  v_seq        bigint;
  v_invoice    public.clinic_invoices%rowtype;
  v_payer_type text;
  v_payer_act  boolean;
  v_existing   public.clinic_claims%rowtype;
  v_claimed    numeric(12,2);
begin
  if p_claimed_amount is null or p_claimed_amount <= 0 then
    raise exception 'INVALID_CLAIM_AMOUNT';
  end if;

  -- Idempotency: same key → return the original claim (no second write).
  if p_idempotency_key is not null then
    select * into v_existing from public.clinic_claims
     where clinic_id = p_clinic_id and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('claim_id', v_existing.id,
                                'claim_number', v_existing.claim_number,
                                'status', v_existing.status,
                                'duplicate', true);
    end if;
  end if;

  -- Invoice: tenant-scoped, not voided, belongs to the claimed patient.
  select * into v_invoice from public.clinic_invoices
   where id = p_invoice_id and clinic_id = p_clinic_id;
  if not found then
    raise exception 'INVOICE_NOT_FOUND';
  end if;
  if v_invoice.status = 'voided' then
    raise exception 'INVOICE_VOIDED';
  end if;
  if v_invoice.patient_id is distinct from p_patient_id then
    raise exception 'CLAIM_PATIENT_MISMATCH';
  end if;

  -- Payer: tenant-scoped (composite FK), active, INSURANCE type (D-I5: the
  -- legacy payment method is unrelated — the payer entity is the real one).
  select payer_type, is_active into v_payer_type, v_payer_act
    from public.clinic_payers
   where id = p_payer_id and clinic_id = p_clinic_id;
  if not found then
    raise exception 'PAYER_NOT_FOUND';
  end if;
  if v_payer_act is not true then
    raise exception 'PAYER_INACTIVE';
  end if;
  if v_payer_type <> 'insurance' then
    raise exception 'PAYER_NOT_INSURANCE';
  end if;

  -- Optional coverage: tenant + patient scoped (D-I3 configuration only).
  if p_coverage_id is not null then
    if not exists (select 1 from public.clinic_patient_coverages
                    where id = p_coverage_id and clinic_id = p_clinic_id
                      and patient_id = p_patient_id) then
      raise exception 'COVERAGE_INVALID';
    end if;
  end if;

  -- Skeleton guard: total non-rejected claims on the invoice stay within its
  -- total (configuration-level rule — NOT adjudication).
  select coalesce(sum(claimed_amount), 0) into v_claimed
    from public.clinic_claims
   where clinic_id = p_clinic_id and invoice_id = p_invoice_id
     and status <> 'rejected';
  if v_claimed + round(p_claimed_amount, 2) > v_invoice.total then
    raise exception 'CLAIM_EXCEEDS_INVOICE';
  end if;

  v_seq := public.next_clinic_sequence(p_clinic_id, 'claim', v_year);
  v_number := 'CLM-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  insert into public.clinic_claims
    (clinic_id, claim_number, patient_id, payer_id, invoice_id, coverage_id,
     status, claimed_amount, external_ref, idempotency_key, created_by)
  values
    (p_clinic_id, v_number, p_patient_id, p_payer_id, p_invoice_id, p_coverage_id,
     'draft', round(p_claimed_amount, 2), p_external_ref, p_idempotency_key, p_created_by)
  returning id into v_claim_id;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'claim_recorded:' || v_claim_id::text, 'claim_recorded',
     'clinic_claims', v_claim_id, 'in', round(p_claimed_amount, 2), p_created_by,
     jsonb_build_object('claim_number', v_number, 'invoice_id', p_invoice_id,
                        'invoice_number', v_invoice.invoice_number,
                        'payer_id', p_payer_id, 'coverage_id', p_coverage_id,
                        'external_ref', p_external_ref));

  return jsonb_build_object('claim_id', v_claim_id, 'claim_number', v_number,
                            'status', 'draft', 'claimed_amount', round(p_claimed_amount, 2),
                            'duplicate', false);
end;
$$;

create or replace function public.submit_insurance_claim(
  p_clinic_id    uuid,
  p_claim_id     uuid,
  p_external_ref text default null,
  p_actor        uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.clinic_claims%rowtype;
begin
  select * into v_claim from public.clinic_claims
   where id = p_claim_id and clinic_id = p_clinic_id;
  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;
  if v_claim.status <> 'draft' then
    raise exception 'INVALID_CLAIM_STATUS';
  end if;

  update public.clinic_claims
     set status = 'submitted',
         submitted_at = now(),
         external_ref = coalesce(p_external_ref, external_ref),
         updated_at = now()
   where id = p_claim_id and clinic_id = p_clinic_id;

  return jsonb_build_object('claim_id', p_claim_id, 'status', 'submitted',
                            'claim_number', v_claim.claim_number);
end;
$$;

create or replace function public.settle_insurance_claim(
  p_clinic_id      uuid,
  p_claim_id       uuid,
  p_settled_amount numeric,
  p_actor          uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.clinic_claims%rowtype;
begin
  if p_settled_amount is null or p_settled_amount < 0 then
    raise exception 'INVALID_SETTLED_AMOUNT';
  end if;

  select * into v_claim from public.clinic_claims
   where id = p_claim_id and clinic_id = p_clinic_id;
  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;

  -- Idempotent settle: already settled → duplicate (no second ledger row).
  if v_claim.status = 'settled'
     and exists (select 1 from public.financial_transactions
                  where event_key = 'claim_settled:' || p_claim_id::text) then
    return jsonb_build_object('claim_id', p_claim_id, 'status', 'settled',
                              'claim_number', v_claim.claim_number,
                              'settled_amount', v_claim.settled_amount,
                              'duplicate', true);
  end if;

  if v_claim.status <> 'submitted' then
    raise exception 'INVALID_CLAIM_STATUS';
  end if;
  if round(p_settled_amount, 2) > v_claim.claimed_amount then
    raise exception 'SETTLED_EXCEEDS_CLAIM';
  end if;

  -- D-I2: settle the CLAIM only — never writes to clinic_payments, never a
  -- cash movement. Actual money arrives via record_payment (payment_recorded).
  update public.clinic_claims
     set status = 'settled',
         settled_amount = round(p_settled_amount, 2),
         settled_at = now(),
         updated_at = now()
   where id = p_claim_id and clinic_id = p_clinic_id;

  insert into public.financial_transactions
    (clinic_id, event_key, event_type, ref_table, ref_id, direction, amount, actor_user_id, metadata)
  values
    (p_clinic_id, 'claim_settled:' || p_claim_id::text, 'claim_settled',
     'clinic_claims', p_claim_id, 'in', round(p_settled_amount, 2), p_actor,
     jsonb_build_object('claim_number', v_claim.claim_number,
                        'invoice_id', v_claim.invoice_id,
                        'payer_id', v_claim.payer_id,
                        'note', 'settlement of payer obligation — not a cash movement'));

  return jsonb_build_object('claim_id', p_claim_id, 'status', 'settled',
                            'claim_number', v_claim.claim_number,
                            'settled_amount', round(p_settled_amount, 2),
                            'duplicate', false);
end;
$$;

create or replace function public.reject_insurance_claim(
  p_clinic_id uuid,
  p_claim_id  uuid,
  p_reason    text,
  p_actor     uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim public.clinic_claims%rowtype;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'REJECTION_REASON_REQUIRED';
  end if;

  select * into v_claim from public.clinic_claims
   where id = p_claim_id and clinic_id = p_clinic_id;
  if not found then
    raise exception 'CLAIM_NOT_FOUND';
  end if;
  if v_claim.status not in ('draft', 'submitted') then
    raise exception 'INVALID_CLAIM_STATUS';
  end if;

  update public.clinic_claims
     set status = 'rejected',
         rejection_reason = trim(p_reason),
         updated_at = now()
   where id = p_claim_id and clinic_id = p_clinic_id;

  return jsonb_build_object('claim_id', p_claim_id, 'status', 'rejected',
                            'claim_number', v_claim.claim_number);
end;
$$;

-- ============================================================================
-- END — Insurance Foundation skeleton. No historical migration touched; no
-- ledger semantics change; claim_settled is never a cash movement; legacy
-- method='insurance' untouched (D-I5).
-- ============================================================================
