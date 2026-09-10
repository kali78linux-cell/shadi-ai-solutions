import { createSupabaseServerClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';

/**
 * PP-1 — Patient Portal identity + authorization (D-PP1).
 *
 * Security invariants:
 * - clinic_id / patient_id are ALWAYS derived from the authenticated session's
 *   active identity row. Client-supplied patient_id/clinic_id are never trusted.
 * - revoked / unverified / soft-deleted identities fail authorization.
 * - V1: one active identity per user (DB-enforced) → one patient per session.
 */

export type PatientIdentity = {
  id: string;
  clinic_id: string;
  patient_id: string;
  email: string;
};

export class PatientPortalError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/** Resolve the active patient identity from the authenticated session. */
export async function resolvePatientIdentity(): Promise<PatientIdentity> {
  const supabase = createSupabaseServerClient();
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    throw new PatientPortalError('PATIENT_UNAUTHENTICATED', 401);
  }
  const user = authData.user;
  if (!user.email_confirmed_at) {
    logEvent('portal_identity_unverified', { user_id: user.id }, 'warn');
    throw new PatientPortalError('PATIENT_IDENTITY_UNVERIFIED', 403);
  }

  const { data: rows, error } = await supabaseAdmin
    .from('clinic_patient_identities')
    .select('id, clinic_id, patient_id, email')
    .eq('user_id', user.id)
    .eq('status', 'active')
    .is('deleted_at', null)
    .not('verified_at', 'is', null)
    .limit(2);
  if (error) {
    logEvent('portal_identity_lookup_error', { user_id: user.id, error: error.message }, 'error');
    throw new PatientPortalError('PORTAL_IDENTITY_LOOKUP_FAILED', 500);
  }
  const active = (rows ?? []) as PatientIdentity[];
  if (active.length === 0) {
    throw new PatientPortalError('NO_ACTIVE_PATIENT_IDENTITY', 403);
  }
  if (active.length > 1) {
    // DB constraints should make this unreachable; fail-closed anyway.
    logEvent('portal_identity_ambiguity', { user_id: user.id, count: active.length }, 'error');
    throw new PatientPortalError('PORTAL_IDENTITY_AMBIGUOUS', 403);
  }
  return active[0];
}

/** Portal API guard — mirrors authorizeClinicRequest semantics for patients. */
export async function authorizePatientRequest(
  req: Request
): Promise<{ identity: PatientIdentity } | { error: PatientPortalError }> {
  try {
    return { identity: await resolvePatientIdentity() };
  } catch (err) {
    if (err instanceof PatientPortalError) return { error: err };
    logEvent('portal_authorize_unexpected', { error: String(err) }, 'error');
    return { error: new PatientPortalError('PORTAL_AUTH_FAILED', 500) };
  }
}

/** Register (provision) a portal identity for a patient — service-side only. */
export async function provisionPatientIdentity(params: {
  clinicId: string;
  patientId: string;
  email: string;
  userId: string;
}): Promise<{ id: string; duplicate?: boolean }> {
  const email = params.email.trim().toLowerCase();
  const { data, error } = await supabaseAdmin
    .from('clinic_patient_identities')
    .upsert(
      {
        clinic_id: params.clinicId,
        patient_id: params.patientId,
        user_id: params.userId,
        email,
        status: 'active',
        verified_at: new Date().toISOString(),
      },
      { onConflict: 'clinic_id,patient_id', ignoreDuplicates: false }
    )
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505') {
      // Active identity already exists for this user or patient — idempotent skip.
      logEvent('portal_identity_duplicate_skipped', { clinic_id: params.clinicId, patient_id: params.patientId });
      const { data: existing } = await supabaseAdmin
        .from('clinic_patient_identities')
        .select('id')
        .eq('clinic_id', params.clinicId)
        .eq('patient_id', params.patientId)
        .eq('status', 'active')
        .is('deleted_at', null)
        .maybeSingle();
      return { id: existing?.id ?? '', duplicate: true };
    }
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: null,
    action: 'portal_identity_provisioned',
    resourceType: 'clinic_patient_identities',
    resourceId: (data as { id: string }).id,
    metadata: { email },
  });
  return { id: (data as { id: string }).id };
}

/** Revoke a portal identity (service-side) — revocation must block access. */
export async function revokePatientIdentity(params: {
  clinicId: string;
  identityId: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('clinic_patient_identities')
    .update({ status: 'revoked', updated_at: new Date().toISOString() })
    .eq('clinic_id', params.clinicId)
    .eq('id', params.identityId);
  if (error) throw new Error(error.message);
  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: null,
    action: 'portal_identity_revoked',
    resourceType: 'clinic_patient_identities',
    resourceId: params.identityId,
    metadata: null,
  });
}

/** Portal-scoped appointment reads — strictly own appointments. */
export async function listOwnAppointments(identity: PatientIdentity): Promise<unknown[]> {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select(
      'id, service, appointment_date, scheduled_at, duration_minutes, status, provider_id, service_id'
    )
    .eq('clinic_id', identity.clinic_id)
    .eq('patient_id', identity.patient_id)
    .is('deleted_at', null)
    .order('appointment_date', { ascending: false })
    .limit(50);
  if (error) {
    logEvent('portal_appointments_query_error', { clinic_id: identity.clinic_id, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return (data ?? []) as unknown[];
}

// ─── PP-2 — Portal financial reads (read-only, identity-scoped) ──────────────
// Exposure guard: patient-safe field projections only — no internal notes,
// staff ids, audit, ledger metadata, or idempotency keys.

export type PortalInvoice = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  currency: string | null;
  total: number;
  paid: number;
  balance: number;
};

/** Own invoices list: amounts from invoice_balances (derived), dates from the invoice row. */
export async function listOwnInvoices(identity: PatientIdentity): Promise<PortalInvoice[]> {
  const { data: balRows, error: balErr } = await supabaseAdmin
    .from('invoice_balances')
    .select('invoice_id, invoice_number, status, total, paid_amount, balance_amount')
    .eq('clinic_id', identity.clinic_id)
    .eq('patient_id', identity.patient_id)
    .order('invoice_id', { ascending: false })
    .limit(100);
  if (balErr) {
    logEvent('portal_invoices_query_error', { clinic_id: identity.clinic_id, error: balErr.message }, 'error');
    throw new Error(balErr.message);
  }
  const balances = (balRows ?? []) as Array<{
    invoice_id: string;
    invoice_number: string;
    status: string;
    total: number;
    paid_amount: number;
    balance_amount: number;
  }>;
  if (balances.length === 0) return [];

  const ids = balances.map((b) => b.invoice_id);
  const { data: invRows, error: invErr } = await supabaseAdmin
    .from('clinic_invoices')
    .select('id, issued_at, due_at, currency')
    .eq('clinic_id', identity.clinic_id)
    .eq('patient_id', identity.patient_id)
    .in('id', ids);
  if (invErr) throw new Error(invErr.message);
  const meta = new Map(
    ((invRows ?? []) as Array<{ id: string; issued_at: string | null; due_at: string | null; currency: string | null }>).map(
      (r) => [r.id, r]
    )
  );

  return balances.map((b) => ({
    invoice_id: b.invoice_id,
    invoice_number: b.invoice_number,
    status: b.status,
    issued_at: meta.get(b.invoice_id)?.issued_at ?? null,
    due_at: meta.get(b.invoice_id)?.due_at ?? null,
    currency: meta.get(b.invoice_id)?.currency ?? null,
    total: Number(b.total),
    paid: Number(b.paid_amount),
    balance: Number(b.balance_amount),
  }));
}

/** Own invoice detail (fail-closed: composite-scoped by identity, not by client id). */
export async function getOwnInvoice(
  identity: PatientIdentity,
  invoiceId: string
): Promise<PortalInvoice & { items: Array<{ description: string | null; quantity: number; unit_price: number; line_total: number }> } | null> {
  const invoices = await listOwnInvoices(identity);
  const invoice = invoices.find((i) => i.invoice_id === invoiceId);
  if (!invoice) return null; // not owned → indistinguishable from nonexistent

  const { data: items, error } = await supabaseAdmin
    .from('invoice_items')
    .select('description, quantity, unit_price, line_total')
    .eq('clinic_id', identity.clinic_id)
    .eq('invoice_id', invoiceId);
  if (error) throw new Error(error.message);

  return {
    ...invoice,
    items: ((items ?? []) as Array<{ description: string | null; quantity: number; unit_price: number; line_total: number }>).map(
      (i) => ({
        description: i.description,
        quantity: Number(i.quantity),
        unit_price: Number(i.unit_price),
        line_total: Number(i.line_total),
      })
    ),
  };
}

/** Own balance from the derived patient_balances view (never stored drift-prone values). */
export async function getOwnBalance(identity: PatientIdentity): Promise<{
  outstanding: number;
  credit: number;
  invoiced_total: number;
  paid_total: number;
  written_off_total: number;
} | null> {
  const { data, error } = await supabaseAdmin
    .from('patient_balances')
    .select('outstanding_amount, credit_amount, invoiced_total, paid_total, written_off_total')
    .eq('clinic_id', identity.clinic_id)
    .eq('patient_id', identity.patient_id)
    .maybeSingle();
  if (error) {
    logEvent('portal_balance_query_error', { clinic_id: identity.clinic_id, error: error.message }, 'error');
    throw new Error(error.message);
  }
  const row = data as {
    outstanding_amount: number;
    credit_amount: number;
    invoiced_total: number;
    paid_total: number;
    written_off_total: number;
  } | null;
  if (!row) return null;
  return {
    outstanding: Number(row.outstanding_amount),
    credit: Number(row.credit_amount),
    invoiced_total: Number(row.invoiced_total),
    paid_total: Number(row.paid_total),
    written_off_total: Number(row.written_off_total),
  };
}

export type PortalPayment = {
  payment_id: string;
  date: string;
  direction: string;
  amount: number;
  status: string;
  method: string;
  receipt_number: string | null;
  invoice_number: string | null;
};

/** Own payment history — patient-safe projection only (voided excluded). */
export async function listOwnPayments(identity: PatientIdentity): Promise<PortalPayment[]> {
  const { data: ownInvoices, error: invErr } = await supabaseAdmin
    .from('clinic_invoices')
    .select('id, invoice_number')
    .eq('clinic_id', identity.clinic_id)
    .eq('patient_id', identity.patient_id);
  if (invErr) throw new Error(invErr.message);
  const invMap = new Map(
    ((ownInvoices ?? []) as Array<{ id: string; invoice_number: string }>).map((r) => [r.id, r.invoice_number])
  );
  if (invMap.size === 0) return [];

  const { data: payRows, error: payErr } = await supabaseAdmin
    .from('clinic_payments')
    .select('id, invoice_id, direction, amount, method, status, receipt_number, created_at')
    .eq('clinic_id', identity.clinic_id)
    .in('invoice_id', Array.from(invMap.keys()))
    .is('voided_at', null)
    .order('created_at', { ascending: false })
    .limit(100);
  if (payErr) {
    logEvent('portal_payments_query_error', { clinic_id: identity.clinic_id, error: payErr.message }, 'error');
    throw new Error(payErr.message);
  }
  return ((payRows ?? []) as Array<{
    id: string;
    invoice_id: string;
    direction: string;
    amount: number;
    method: string;
    status: string;
    receipt_number: string | null;
    created_at: string;
  }>).map((p) => ({
    payment_id: p.id,
    date: p.created_at,
    direction: p.direction,
    amount: Number(p.amount),
    status: p.status,
    method: p.method,
    receipt_number: p.receipt_number,
    invoice_number: invMap.get(p.invoice_id) ?? null,
  }));
}

/** Statement = derived composition of own invoices + payments + balance (read-only). */
export async function getOwnStatement(identity: PatientIdentity): Promise<{
  invoices: PortalInvoice[];
  payments: PortalPayment[];
  outstanding: number;
  credit: number;
}> {
  const [invoices, payments, balance] = await Promise.all([
    listOwnInvoices(identity),
    listOwnPayments(identity),
    getOwnBalance(identity),
  ]);
  return {
    invoices,
    payments,
    outstanding: balance?.outstanding ?? 0,
    credit: balance?.credit ?? 0,
  };
}
