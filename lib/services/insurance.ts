/**
 * Insurance Foundation — per-clinic payer / coverage / claims skeleton.
 *
 * - The claim is the INSURANCE entity (D-I2): claim_settled is NOT a cash
 *   movement and never creates a payment. Money enters ONLY via the existing
 *   record_payment accounting RPC (payment_recorded).
 * - Coverage is configuration/data foundation ONLY (D-I3): no auto split, no
 *   adjudication, no deductible/co-pay engines.
 * - RBAC is enforced at the API layer with FINANCE gates (D-I4) — DATA_ROLES
 *   are untouched.
 * - Legacy clinic_payments.method='insurance' is untouched (D-I5): claims are
 *   the insurance entity; payments remain the financial movement.
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';

export type PayerType = 'insurance' | 'employer' | 'third_party';
export type ClaimStatus = 'draft' | 'submitted' | 'settled' | 'rejected';

// ---------------------------------------------------------------------------
// Payers (directory) — tenant-scoped direct ops; deactivate, never delete
// (DB guard blocks DELETE and clinic_id change).
// ---------------------------------------------------------------------------

export async function listPayers(clinicId: string, includeInactive = false) {
  let query = supabaseAdmin
    .from('clinic_payers')
    .select('id, name, payer_type, contact_name, contact_phone, notes, is_active, created_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true });
  if (!includeInactive) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) {
    logEvent('insurance_payers_list_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function createPayer(input: {
  clinicId: string;
  name: string;
  payerType: PayerType;
  contactName?: string | null;
  contactPhone?: string | null;
  notes?: string | null;
  actorUserId: string | null;
}) {
  if (!input.name || !input.name.trim()) throw new Error('PAYER_NAME_REQUIRED');
  const { data, error } = await supabaseAdmin
    .from('clinic_payers')
    .insert({
      clinic_id: input.clinicId,
      name: input.name.trim(),
      payer_type: input.payerType,
      contact_name: input.contactName ?? null,
      contact_phone: input.contactPhone ?? null,
      notes: input.notes ?? '',
    })
    .select('id, name, payer_type, is_active, created_at')
    .single();
  if (error) {
    logEvent('insurance_payer_create_error', { clinic_id: input.clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.payer.created',
    resourceType: 'clinic_payers',
    resourceId: data.id,
    metadata: { name: data.name, payer_type: data.payer_type },
  });
  return data;
}

export async function updatePayer(input: {
  clinicId: string;
  payerId: string;
  name?: string;
  contactName?: string | null;
  contactPhone?: string | null;
  isActive?: boolean;
  actorUserId: string | null;
}) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.name !== undefined) {
    if (!input.name.trim()) throw new Error('PAYER_NAME_REQUIRED');
    patch.name = input.name.trim();
  }
  if (input.contactName !== undefined) patch.contact_name = input.contactName;
  if (input.contactPhone !== undefined) patch.contact_phone = input.contactPhone;
  if (input.isActive !== undefined) patch.is_active = input.isActive;
  const { data, error } = await supabaseAdmin
    .from('clinic_payers')
    .update(patch)
    .eq('clinic_id', input.clinicId)
    .eq('id', input.payerId)
    .select('id, name, payer_type, is_active')
    .single();
  if (error) {
    logEvent('insurance_payer_update_error', { clinic_id: input.clinicId, payer_id: input.payerId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.payer.updated',
    resourceType: 'clinic_payers',
    resourceId: input.payerId,
    metadata: patch,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Patient coverages — configuration/data foundation ONLY (D-I3).
// Lifecycle via status (active → suspended/ended); never deleted.
// ---------------------------------------------------------------------------

export async function listPatientCoverages(clinicId: string, patientId?: string) {
  let query = supabaseAdmin
    .from('clinic_patient_coverages')
    .select('id, patient_id, payer_id, policy_number, member_ref, coverage_percent, effective_from, effective_to, status, created_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true });
  if (patientId) query = query.eq('patient_id', patientId);
  const { data, error } = await query;
  if (error) {
    logEvent('insurance_coverages_list_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function createPatientCoverage(input: {
  clinicId: string;
  patientId: string;
  payerId: string;
  policyNumber: string;
  memberRef?: string | null;
  coveragePercent?: number | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  actorUserId: string | null;
}) {
  if (!input.policyNumber || !input.policyNumber.trim()) throw new Error('POLICY_NUMBER_REQUIRED');
  const { data, error } = await supabaseAdmin
    .from('clinic_patient_coverages')
    .insert({
      clinic_id: input.clinicId,
      patient_id: input.patientId,
      payer_id: input.payerId,
      policy_number: input.policyNumber.trim(),
      member_ref: input.memberRef ?? null,
      coverage_percent: input.coveragePercent ?? null,
      effective_from: input.effectiveFrom,
      effective_to: input.effectiveTo ?? null,
      status: 'active',
    })
    .select('id, patient_id, payer_id, policy_number, coverage_percent, status, effective_from')
    .single();
  if (error) {
    logEvent('insurance_coverage_create_error', { clinic_id: input.clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.coverage.created',
    resourceType: 'clinic_patient_coverages',
    resourceId: data.id,
    metadata: { patient_id: input.patientId, payer_id: input.payerId, policy_number: data.policy_number },
  });
  return data;
}

export async function updatePatientCoverage(input: {
  clinicId: string;
  coverageId: string;
  status?: 'active' | 'suspended' | 'ended';
  effectiveTo?: string | null;
  coveragePercent?: number | null;
  memberRef?: string | null;
  actorUserId: string | null;
}) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.status !== undefined) patch.status = input.status;
  if (input.effectiveTo !== undefined) patch.effective_to = input.effectiveTo;
  if (input.coveragePercent !== undefined) patch.coverage_percent = input.coveragePercent;
  if (input.memberRef !== undefined) patch.member_ref = input.memberRef;
  const { data, error } = await supabaseAdmin
    .from('clinic_patient_coverages')
    .update(patch)
    .eq('clinic_id', input.clinicId)
    .eq('id', input.coverageId)
    .select('id, status, effective_to, coverage_percent')
    .single();
  if (error) {
    logEvent('insurance_coverage_update_error', { clinic_id: input.clinicId, coverage_id: input.coverageId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.coverage.updated',
    resourceType: 'clinic_patient_coverages',
    resourceId: input.coverageId,
    metadata: patch,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Claims skeleton (D-I2) — lifecycle via SECURITY DEFINER RPCs so invariants
// hold regardless of caller:
//   create (draft + claim_recorded ledger) → submit → settle (claim_settled,
//   NOT cash) | reject. Settlement NEVER creates a payment.
// ---------------------------------------------------------------------------

export async function listClaims(clinicId: string, filters?: { patientId?: string; payerId?: string; invoiceId?: string; status?: ClaimStatus }) {
  let query = supabaseAdmin
    .from('clinic_claims')
    .select('id, claim_number, patient_id, payer_id, invoice_id, coverage_id, status, claimed_amount, settled_amount, submitted_at, settled_at, rejection_reason, external_ref, created_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: false });
  if (filters?.patientId) query = query.eq('patient_id', filters.patientId);
  if (filters?.payerId) query = query.eq('payer_id', filters.payerId);
  if (filters?.invoiceId) query = query.eq('invoice_id', filters.invoiceId);
  if (filters?.status) query = query.eq('status', filters.status);
  const { data, error } = await query;
  if (error) {
    logEvent('insurance_claims_list_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function createClaim(input: {
  clinicId: string;
  patientId: string;
  payerId: string;
  invoiceId: string;
  claimedAmount: number;
  coverageId?: string | null;
  externalRef?: string | null;
  actorUserId: string | null;
  idempotencyKey?: string | null;
}) {
  const { data, error } = await supabaseAdmin.rpc('create_insurance_claim', {
    p_clinic_id: input.clinicId,
    p_patient_id: input.patientId,
    p_payer_id: input.payerId,
    p_invoice_id: input.invoiceId,
    p_claimed_amount: input.claimedAmount,
    p_coverage_id: input.coverageId ?? null,
    p_external_ref: input.externalRef ?? null,
    p_created_by: input.actorUserId ?? null,
    p_idempotency_key: input.idempotencyKey ?? null,
  });
  if (error) {
    logEvent('insurance_claim_create_error', { clinic_id: input.clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.claim.created',
    resourceType: 'clinic_claims',
    resourceId: data.claim_id,
    metadata: { claim_number: data.claim_number, claimed_amount: input.claimedAmount, invoice_id: input.invoiceId },
  });
  return data;
}

export async function submitClaim(input: {
  clinicId: string;
  claimId: string;
  externalRef?: string | null;
  actorUserId: string | null;
}) {
  const { data, error } = await supabaseAdmin.rpc('submit_insurance_claim', {
    p_clinic_id: input.clinicId,
    p_claim_id: input.claimId,
    p_external_ref: input.externalRef ?? null,
    p_actor: input.actorUserId ?? null,
  });
  if (error) {
    logEvent('insurance_claim_submit_error', { clinic_id: input.clinicId, claim_id: input.claimId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.claim.submitted',
    resourceType: 'clinic_claims',
    resourceId: input.claimId,
    metadata: { claim_number: data.claim_number },
  });
  return data;
}

export async function settleClaim(input: {
  clinicId: string;
  claimId: string;
  settledAmount: number;
  actorUserId: string | null;
}) {
  const { data, error } = await supabaseAdmin.rpc('settle_insurance_claim', {
    p_clinic_id: input.clinicId,
    p_claim_id: input.claimId,
    p_settled_amount: input.settledAmount,
    p_actor: input.actorUserId ?? null,
  });
  if (error) {
    logEvent('insurance_claim_settle_error', { clinic_id: input.clinicId, claim_id: input.claimId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.claim.settled',
    resourceType: 'clinic_claims',
    resourceId: input.claimId,
    metadata: { claim_number: data.claim_number, settled_amount: input.settledAmount, note: 'claim_settled is not a cash movement' },
  });
  return data;
}

export async function rejectClaim(input: {
  clinicId: string;
  claimId: string;
  reason: string;
  actorUserId: string | null;
}) {
  const { data, error } = await supabaseAdmin.rpc('reject_insurance_claim', {
    p_clinic_id: input.clinicId,
    p_claim_id: input.claimId,
    p_reason: input.reason,
    p_actor: input.actorUserId ?? null,
  });
  if (error) {
    logEvent('insurance_claim_reject_error', { clinic_id: input.clinicId, claim_id: input.claimId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'insurance.claim.rejected',
    resourceType: 'clinic_claims',
    resourceId: input.claimId,
    metadata: { claim_number: data.claim_number, reason: input.reason },
  });
  return data;
}
