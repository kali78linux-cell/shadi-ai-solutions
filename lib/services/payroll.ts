/**
 * Payroll Foundation — per-provider compensation CONFIGURATION + derived
 * provider revenue (D-P1/D-P2/D-P3).
 *
 * - Configuration ONLY: no salary/commission calculation, no payroll runs,
 *   no payslips, no advances/deductions/taxes — none of it in this phase.
 * - provider_revenue is a DERIVED read-only view over the Phase B attribution
 *   columns (invoice_items.provider_id on non-voided invoices); nothing is
 *   stored and the ledger is untouched.
 * - D-P2: attribution base 'issued' is the only value in this phase.
 * - Visibility (D-P3) is enforced at the API layer with FINANCE gates;
 *   DATA_ROLES untouched.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';

export type CompensationModel = 'commission_percentage' | 'fixed_monthly' | 'hybrid';

// ---------------------------------------------------------------------------
// Compensation configuration — effective-dated; exactly one ACTIVE config per
// provider (partial unique index); lifecycle via status='ended' (DB guard
// blocks DELETE and clinic_id change).
// ---------------------------------------------------------------------------

export async function listCompensations(clinicId: string, providerId?: string, includeEnded = false) {
  let query = supabaseAdmin
    .from('clinic_provider_compensations')
    .select('id, provider_id, model, commission_percent, fixed_monthly_amount, attribution_base, effective_from, effective_to, status, notes, created_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true });
  if (providerId) query = query.eq('provider_id', providerId);
  if (!includeEnded) query = query.eq('status', 'active');
  const { data, error } = await query;
  if (error) {
    logEvent('payroll_compensations_list_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function createCompensation(input: {
  clinicId: string;
  providerId: string;
  model: CompensationModel;
  commissionPercent?: number | null;
  fixedMonthlyAmount?: number | null;
  effectiveFrom: string;
  notes?: string | null;
  actorUserId: string | null;
}) {
  // Configuration-consistency validation mirroring the DB CHECK (fail before write).
  const hasCommission = input.commissionPercent !== null && input.commissionPercent !== undefined;
  const hasFixed = input.fixedMonthlyAmount !== null && input.fixedMonthlyAmount !== undefined;
  const consistent =
    (input.model === 'commission_percentage' && hasCommission && !hasFixed) ||
    (input.model === 'fixed_monthly' && hasFixed && !hasCommission) ||
    (input.model === 'hybrid' && hasCommission && hasFixed);
  if (!consistent) throw new Error('COMPENSATION_MODEL_FIELDS_MISMATCH');

  const { data, error } = await supabaseAdmin
    .from('clinic_provider_compensations')
    .insert({
      clinic_id: input.clinicId,
      provider_id: input.providerId,
      model: input.model,
      commission_percent: input.commissionPercent ?? null,
      fixed_monthly_amount: input.fixedMonthlyAmount ?? null,
      attribution_base: 'issued',
      effective_from: input.effectiveFrom,
      notes: input.notes ?? '',
      status: 'active',
    })
    .select('id, provider_id, model, commission_percent, fixed_monthly_amount, effective_from, status')
    .single();
  if (error) {
    logEvent('payroll_compensation_create_error', { clinic_id: input.clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'payroll.compensation.created',
    resourceType: 'clinic_provider_compensations',
    resourceId: data.id,
    metadata: { provider_id: input.providerId, model: input.model },
  });
  return data;
}

export async function updateCompensation(input: {
  clinicId: string;
  compensationId: string;
  status?: 'active' | 'ended';
  effectiveTo?: string | null;
  commissionPercent?: number | null;
  fixedMonthlyAmount?: number | null;
  notes?: string | null;
  actorUserId: string | null;
}) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.effectiveTo !== undefined) patch.effective_to = input.effectiveTo;
  if (input.commissionPercent !== undefined) patch.commission_percent = input.commissionPercent;
  if (input.fixedMonthlyAmount !== undefined) patch.fixed_monthly_amount = input.fixedMonthlyAmount;
  if (input.notes !== undefined) patch.notes = input.notes;
  const { data, error } = await supabaseAdmin
    .from('clinic_provider_compensations')
    .update(patch)
    .eq('clinic_id', input.clinicId)
    .eq('id', input.compensationId)
    .select('id, provider_id, model, status, effective_to')
    .single();
  if (error) {
    logEvent('payroll_compensation_update_error', { clinic_id: input.clinicId, compensation_id: input.compensationId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'payroll.compensation.updated',
    resourceType: 'clinic_provider_compensations',
    resourceId: input.compensationId,
    metadata: patch,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Provider revenue — DERIVED read (D-P2: issued base). The view computes
// everything; this is a pure tenant-scoped read, never a write path.
// ---------------------------------------------------------------------------

export async function listProviderRevenue(clinicId: string, filters?: { providerId?: string; fromMonth?: string; toMonth?: string }) {
  let query = supabaseAdmin
    .from('provider_revenue')
    .select('clinic_id, provider_id, revenue_month, issued_revenue, invoice_count')
    .eq('clinic_id', clinicId)
    .order('revenue_month', { ascending: false });
  if (filters?.providerId) query = query.eq('provider_id', filters.providerId);
  if (filters?.fromMonth) query = query.gte('revenue_month', filters.fromMonth);
  if (filters?.toMonth) query = query.lte('revenue_month', filters.toMonth);
  const { data, error } = await query;
  if (error) {
    logEvent('payroll_provider_revenue_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}
