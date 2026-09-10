/**
 * Financial Reporting — derived read-only reporting (D-R1/D-R2/D-R3).
 *
 * - All figures are DERIVED from the ledger / source transactions at read
 *   time. Nothing is stored; no derived balances as source of truth.
 * - D-R1 (P&L): Revenue = invoice_issued net of invoice_voided; Refunds =
 *   refund_recorded; Expenses = expense_recorded net of expense_voided;
 *   Bad Debt = write_off_recorded (standalone line). claim_* kinds are
 *   structurally excluded from the view (never cash, never P&L).
 * - D-R2 (Cash Flow): ALL actual money movements with METHOD breakdown
 *   from source rows — `direction` is never used as a method or cash signal.
 * - Period boundaries are clinic-local (D-L3) computed in the views; the API
 *   layer only filters months.
 * - D-R3: APIs only — no dashboard UI in this phase.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export interface PeriodRange {
  fromMonth?: string; // inclusive YYYY-MM-01
  toMonth?: string;   // inclusive YYYY-MM-01
}

/** Validates an optional YYYY-MM-01 month parameter (safe date-range handling). */
function assertMonth(value?: string | null, label = 'month'): void {
  if (!value) return;
  if (!/^\d{4}-\d{2}-01$/.test(value)) throw new Error(`INVALID_${label.toUpperCase()}`);
}

export async function getProfitAndLoss(clinicId: string, range: PeriodRange = {}) {
  assertMonth(range.fromMonth, 'from_month');
  assertMonth(range.toMonth, 'to_month');
  let query = supabaseAdmin
    .from('financial_period_summary')
    .select('clinic_id, period_month, revenue, refunds, expenses, bad_debt, net_result')
    .eq('clinic_id', clinicId)
    .order('period_month', { ascending: false });
  if (range.fromMonth) query = query.gte('period_month', range.fromMonth);
  if (range.toMonth) query = query.lte('period_month', range.toMonth);
  const { data, error } = await query;
  if (error) {
    logEvent('reporting_pnl_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getCashFlow(
  clinicId: string,
  range: PeriodRange & { method?: 'cash' | 'card' | 'bank_transfer' | 'other' } = {}
) {
  assertMonth(range.fromMonth, 'from_month');
  assertMonth(range.toMonth, 'to_month');
  const VALID_METHODS = ['cash', 'card', 'bank_transfer', 'other'] as const;
  if (range.method && !VALID_METHODS.includes(range.method)) {
    throw new Error('INVALID_METHOD');
  }
  let query = supabaseAdmin
    .from('cash_flow_summary')
    .select('clinic_id, flow_month, method, inflows, outflows, net')
    .eq('clinic_id', clinicId)
    .order('flow_month', { ascending: false });
  if (range.fromMonth) query = query.gte('flow_month', range.fromMonth);
  if (range.toMonth) query = query.lte('flow_month', range.toMonth);
  if (range.method) query = query.eq('method', range.method);
  const { data, error } = await query;
  if (error) {
    logEvent('reporting_cash_flow_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function getAgingPayer(
  clinicId: string,
  filters: { payerType?: 'patient' | 'insurance' | 'employer' | 'third_party'; bucket?: string } = {}
) {
  let query = supabaseAdmin
    .from('receivable_aging_payer')
    .select('clinic_id, invoice_id, patient_id, invoice_number, bucket, age_days, total, paid_amount, written_off_amount, balance_amount, payer_type, payer_ref, payer_name')
    .eq('clinic_id', clinicId)
    .order('age_days', { ascending: false });
  if (filters.payerType) query = query.eq('payer_type', filters.payerType);
  if (filters.bucket) query = query.eq('bucket', filters.bucket);
  const { data, error } = await query;
  if (error) {
    logEvent('reporting_aging_payer_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}
