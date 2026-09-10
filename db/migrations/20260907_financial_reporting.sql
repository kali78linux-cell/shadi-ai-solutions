-- ============================================================================
-- 20260907_financial_reporting.sql — Financial Reporting (D8: P&L / Cash Flow
-- / Aging) — per approved decisions D-R1 / D-R2 / D-R3.
--
-- Three DERIVED read-only views. Nothing stored; no ledger change; no new
-- kinds; no historical records touched.
--
-- Encoded owner decisions:
--   * D-R1 — P&L: Revenue = invoice_issued (net of invoice_voided);
--     Refunds = refund_recorded; Expenses = expense_recorded (net of
--     expense_voided); Bad Debt = write_off_recorded (STANDALONE line, never
--     deducted from revenue). Net = Revenue − Refunds − Expenses − Bad Debt.
--     claim_recorded / claim_settled are NOT in P&L (never cash, never P&L).
--   * D-R2 — Cash Flow: ALL actual money movements with METHOD breakdown
--     (cash/card/bank_transfer/other) — inflows payment_recorded, outflows
--     refund_recorded + expense_recorded. daily_cash_positions remains
--     cash-register/cash-method only (untouched).
--   * D-R3 — Delivery: DB views + APIs only. No dashboard UI in this phase.
--   * Aging: receivable_aging reused AS-IS; payer enrichment is an ADDITIVE
--     view (payer_type/payer_ref/payer_name) — aging logic not rebuilt.
--
-- Period boundaries: clinic-local months (D-L3, timezone from clinic_settings,
-- fallback UTC) over ledger `occurred_at` (stays UTC internally).
-- Method is taken from the SOURCE rows (clinic_payments.method /
-- clinic_expenses.method) — `direction` is never a method or cash signal.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) financial_period_summary — P&L source (D-R1), per clinic-local month.
--    Ledger-native: voids net out via their own documented kinds
--    (invoice_voided / expense_voided) — no source-status joins needed.
--    claim_* kinds are structurally excluded (never cash, never P&L).
-- ---------------------------------------------------------------------------
drop view if exists public.financial_period_summary;

create view public.financial_period_summary as
with tz as (
  select c.id as clinic_id,
         coalesce(cs.timezone, 'UTC') as tz
    from public.clinics c
    left join public.clinic_settings cs on cs.clinic_id = c.id
),
monthly as (
  select
    ft.clinic_id,
    date_trunc('month', (ft.occurred_at at time zone t.tz))::date as period_month,
    ft.event_type,
    sum(ft.amount) as total
  from public.financial_transactions ft
  join tz t on t.clinic_id = ft.clinic_id
  where ft.event_type in ('invoice_issued', 'invoice_voided', 'refund_recorded',
                          'expense_recorded', 'expense_voided', 'write_off_recorded')
  group by ft.clinic_id, t.tz, date_trunc('month', (ft.occurred_at at time zone t.tz)), ft.event_type
)
select
  clinic_id,
  period_month,
  coalesce(sum(total) filter (where event_type = 'invoice_issued'), 0)
    - coalesce(sum(total) filter (where event_type = 'invoice_voided'), 0) as revenue,
  coalesce(sum(total) filter (where event_type = 'refund_recorded'), 0)    as refunds,
  coalesce(sum(total) filter (where event_type = 'expense_recorded'), 0)
    - coalesce(sum(total) filter (where event_type = 'expense_voided'), 0) as expenses,
  coalesce(sum(total) filter (where event_type = 'write_off_recorded'), 0) as bad_debt,
  coalesce(sum(total) filter (where event_type = 'invoice_issued'), 0)
    - coalesce(sum(total) filter (where event_type = 'invoice_voided'), 0)
    - coalesce(sum(total) filter (where event_type = 'refund_recorded'), 0)
    - (coalesce(sum(total) filter (where event_type = 'expense_recorded'), 0)
       - coalesce(sum(total) filter (where event_type = 'expense_voided'), 0))
    - coalesce(sum(total) filter (where event_type = 'write_off_recorded'), 0) as net_result
from monthly
group by clinic_id, period_month;

-- ---------------------------------------------------------------------------
-- 2) cash_flow_summary — Cash Flow source (D-R2): ALL actual money movements
--    with METHOD breakdown, per clinic-local month. Inflows =
--    payment_recorded; Outflows = refund_recorded + expense_recorded.
--    Method comes from the SOURCE rows — direction is never used.
-- ---------------------------------------------------------------------------
drop view if exists public.cash_flow_summary;

create view public.cash_flow_summary as
with tz as (
  select c.id as clinic_id,
         coalesce(cs.timezone, 'UTC') as tz
    from public.clinics c
    left join public.clinic_settings cs on cs.clinic_id = c.id
),
pay as (
  select
    ft.clinic_id,
    date_trunc('month', (ft.occurred_at at time zone t.tz))::date as flow_month,
    p.method,
    coalesce(sum(ft.amount) filter (where ft.event_type = 'payment_recorded'), 0) as inflows,
    coalesce(sum(ft.amount) filter (where ft.event_type = 'refund_recorded'), 0)  as outflows
  from public.financial_transactions ft
  join public.clinic_payments p on p.clinic_id = ft.clinic_id and p.id = ft.ref_id
  join tz t on t.clinic_id = ft.clinic_id
  where ft.event_type in ('payment_recorded', 'refund_recorded')
    and ft.ref_table = 'clinic_payments'
  group by ft.clinic_id, t.tz, date_trunc('month', (ft.occurred_at at time zone t.tz)), p.method
),
exp as (
  select
    ft.clinic_id,
    date_trunc('month', (ft.occurred_at at time zone t.tz))::date as flow_month,
    e.method,
    0::numeric as inflows,
    coalesce(sum(ft.amount) filter (where ft.event_type = 'expense_recorded'), 0)
      - coalesce(sum(ft.amount) filter (where ft.event_type = 'expense_voided'), 0) as outflows
  from public.financial_transactions ft
  join public.clinic_expenses e on e.clinic_id = ft.clinic_id and e.id = ft.ref_id
  join tz t on t.clinic_id = ft.clinic_id
  where ft.event_type in ('expense_recorded', 'expense_voided')
    and ft.ref_table = 'clinic_expenses'
  group by ft.clinic_id, t.tz, date_trunc('month', (ft.occurred_at at time zone t.tz)), e.method
),
combined as (
  select * from pay
  union all
  select * from exp
)
select
  clinic_id,
  flow_month,
  method,
  sum(inflows) as inflows,
  sum(outflows) as outflows,
  sum(inflows) - sum(outflows) as net
from combined
group by clinic_id, flow_month, method;

-- ---------------------------------------------------------------------------
-- 3) receivable_aging_payer — ADDITIVE payer enrichment (D-R2 aging scope):
--    receivable_aging reused AS-IS; payer_type/payer_ref/payer_name joined.
--    Aging logic (buckets / exclusions) NOT rebuilt.
-- ---------------------------------------------------------------------------
drop view if exists public.receivable_aging_payer;

create view public.receivable_aging_payer as
select
  ra.*,
  i.payer_type,
  i.payer_ref,
  cp.name as payer_name
from public.receivable_aging ra
join public.clinic_invoices i
  on i.clinic_id = ra.clinic_id and i.id = ra.invoice_id
left join public.clinic_payers cp
  on cp.clinic_id = i.clinic_id and cp.id = i.payer_ref;

-- ---------------------------------------------------------------------------
-- 4) security_invoker — views MUST respect base-table RLS (Postgres views run
--    with owner privileges by default, bypassing RLS). Applied to the new
--    reporting views AND, as an additive fix-forward, to the Phase B balance
--    views in the aging chain (receivable_aging / invoice_balances /
--    patient_balances) which predate this posture. Service-role callers are
--    unaffected (RLS bypass by design); authenticated callers now correctly
--    see zero rows (tenant isolation restored end-to-end).
-- ---------------------------------------------------------------------------
alter view public.financial_period_summary set (security_invoker = true);
alter view public.cash_flow_summary       set (security_invoker = true);
alter view public.receivable_aging_payer  set (security_invoker = true);
alter view public.receivable_aging        set (security_invoker = true);
alter view public.invoice_balances        set (security_invoker = true);
alter view public.patient_balances        set (security_invoker = true);

-- ============================================================================
-- END — Financial Reporting. No historical migration touched; no ledger kind
-- added; no derived balances stored; claim kinds excluded from P&L; direction
-- never used as method; receivable_aging logic reused as-is.
-- ============================================================================
