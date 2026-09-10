// PP-4 — Patient Portal Refunds service (owner-approved).
// Server-only. No PAN/CVC ever. Provider (Stripe) is AUTHORITATIVE for the
// refund lifecycle; accounting reversal goes through the EXISTING approved
// refund_payment RPC (Phase A/B) — refund_payment creates a direction='refund'
// clinic_payments row + refund_recorded financial_transaction + RCP receipt.
// This module NEVER issues ledger writes itself.
import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';
import { loadClinicLocalization } from '@/lib/clinic/localization';
import {
  PORTAL_REFUND_KIND,
  PaymentProviderError,
  getPaymentProvider,
  toMajor,
  toMinor,
} from '@/lib/payments/provider';

export class PortalRefundError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type PaymentRow = {
  id: string;
  clinic_id: string;
  invoice_id: string;
  direction: string;
  status: string;
  method: string;
  reference: string | null;
};

type InvoiceRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  currency: string | null;
};

/**
 * Loads an original portal payment STRICTLY scoped to the clinic. Non-portal
 * payments are rejected here — provider refunds only make sense for card
 * payments that carry a provider intent id as their reference.
 */
async function loadPortalPayment(clinicId: string, paymentId: string): Promise<PaymentRow> {
  const { data, error } = await supabaseAdmin
    .from('clinic_payments')
    .select('id, clinic_id, invoice_id, direction, status, method, reference')
    .eq('clinic_id', clinicId)
    .eq('id', paymentId)
    .maybeSingle();
  if (error) {
    logEvent('portal_refund_payment_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new PortalRefundError('PAYMENT_LOOKUP_FAILED', 500);
  }
  const payment = (data ?? null) as PaymentRow | null;
  if (!payment) throw new PortalRefundError('PAYMENT_NOT_FOUND', 404);
  if (payment.direction !== 'payment') throw new PortalRefundError('REFUND_ONLY_ON_PAYMENT', 400);
  if (payment.status !== 'recorded') throw new PortalRefundError('PAYMENT_VOIDED', 400);
  if (payment.method !== 'card' || !payment.reference || !/^pi_/.test(payment.reference)) {
    throw new PortalRefundError('PAYMENT_NOT_PROVIDER_ELIGIBLE', 400);
  }
  return payment;
}

async function loadInvoice(clinicId: string, invoiceId: string): Promise<InvoiceRow> {
  const { data, error } = await supabaseAdmin
    .from('clinic_invoices')
    .select('id, clinic_id, patient_id, currency')
    .eq('clinic_id', clinicId)
    .eq('id', invoiceId)
    .maybeSingle();
  if (error) {
    logEvent('portal_refund_invoice_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new PortalRefundError('INVOICE_LOOKUP_FAILED', 500);
  }
  const invoice = (data ?? null) as InvoiceRow | null;
  if (!invoice) throw new PortalRefundError('INVOICE_NOT_FOUND', 404);
  return invoice;
}

/**
 * Server-derived refundable amount for the invoice (mirrors the accounting
 * RPC's net-paid − already-refunded cap so we never ask the provider for more
 * than the books allow). Used only as a pre-flight gate; the DB RPC remains
 * the hard, authoritative guard (`REFUND_EXCEEDS_PAID`).
 */
async function computeRefundableAmount(clinicId: string, invoiceId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('clinic_payments')
    .select('direction, amount, status')
    .eq('clinic_id', clinicId)
    .eq('invoice_id', invoiceId);

  if (error) {
    logEvent('portal_refund_refundable_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new PortalRefundError('REFUNDABLE_LOOKUP_FAILED', 500);
  }
  const rows = (data ?? []) as Array<{ direction: string; amount: number; status: string }>;
  let netPaid = 0;
  let refunded = 0;
  for (const r of rows) {
    if (r.status !== 'recorded') continue;
    if (r.direction === 'payment') netPaid += Number(r.amount);
    else refunded += Number(r.amount);
  }
  const refundable = netPaid - refunded;
  return Math.round(Math.max(refundable, 0) * 100) / 100;
}

export type InitiateRefundInput = {
  clinicId: string;
  paymentId: string;
  amount: number;
  reason: string;
  actorUserId: string | null;
  /**
   * Level-1 idempotency (Stripe-style retry token). The caller owns the token:
   * a retried logical request (same key + same original payment) returns the
   * ORIGINAL refund — never a second provider refund. When omitted a fresh key
   * is issued server-side. The DB partial unique index (clinic_id,
   * idempotency_key) is the hard guard under concurrency.
   */
  idempotencyKey?: string;
};

export type InitiatedRefund = {
  refundId: string;
  providerRefundId: string;
  status: string;
  amount: number;
  currency: string;
  invoiceId: string;
  patientId: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RefundLifecycleRow = {
  id: string;
  clinic_id: string;
  clinic_payment_id: string;
  provider_refund_id: string;
  amount: number;
  currency: string;
  status: string;
  invoice_id: string;
  patient_id: string;
};

async function findRefundByIdempotencyKey(clinicId: string, idempotencyKey: string): Promise<RefundLifecycleRow | null> {
  const { data, error } = await supabaseAdmin
    .from('clinic_payment_refunds')
    .select(
      'id, clinic_id, clinic_payment_id, provider_refund_id, amount, currency, status, invoice_id, patient_id'
    )
    .eq('clinic_id', clinicId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();
  if (error) {
    logEvent('portal_refund_idempotency_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new PortalRefundError('REFUND_LOOKUP_FAILED', 500);
  }
  return (data ?? null) as RefundLifecycleRow | null;
}

function toInitiatedRefund(row: RefundLifecycleRow): InitiatedRefund {
  return {
    refundId: row.id,
    providerRefundId: row.provider_refund_id,
    status: row.status,
    amount: Number(row.amount),
    currency: row.currency,
    invoiceId: row.invoice_id,
    patientId: row.patient_id,
  };
}

/**
 * Admin/FINANCE-only entry point (patients can never self-refund).
 * Validates tenant/ownership/amount server-side, then asks the provider for a
 * refund. The accounting reversal does NOT happen here — it happens in the
 * webhook handler after the provider confirms `refund.updated = succeeded`.
 */
export async function initiateProviderRefund(
  input: InitiateRefundInput
): Promise<InitiatedRefund> {
  if (!(input.amount > 0)) throw new PortalRefundError('REFUND_AMOUNT_INVALID', 400);
  if (!input.reason || input.reason.trim().length === 0) {
    throw new PortalRefundError('REFUND_REASON_REQUIRED', 400);
  }
  const payment = await loadPortalPayment(input.clinicId, input.paymentId);
  const invoice = await loadInvoice(input.clinicId, payment.invoice_id);

  // Currency: invoice snapshot is authoritative; fall back to clinic_settings
  // only for legacy NULL invoices (mirrors PP-3 amendment #2). Server-derived.
  let currency = (invoice.currency ?? '').trim().toLowerCase();
  if (!currency) {
    try {
      const localization = await loadClinicLocalization(input.clinicId);
      currency = (localization.currency ?? 'ils').toLowerCase();
    } catch {
      currency = 'ils';
    }
  }
  if (!/^[a-z]{3}$/.test(currency)) throw new PortalRefundError('INVALID_CURRENCY', 400);

  // Level-1 idempotency (Stripe-style): a retried logical request (same key +
  // same original payment) returns the ORIGINAL refund — never a second
  // provider refund. Runs BEFORE the refundable-cap check so a replay stays
  // idempotent even after the first attempt was fully booked.
  const idempotencyKey = input.idempotencyKey ? input.idempotencyKey.trim() : randomUUID();
  if (!UUID_RE.test(idempotencyKey)) throw new PortalRefundError('INVALID_IDEMPOTENCY_KEY', 400);
  const prior = await findRefundByIdempotencyKey(input.clinicId, idempotencyKey);
  if (prior) {
    if (prior.clinic_payment_id !== payment.id) {
      throw new PortalRefundError('IDEMPOTENCY_KEY_CONFLICT', 409);
    }
    logEvent('portal_refund_idempotent_replay', {
      clinic_id: input.clinicId,
      provider_refund_id: prior.provider_refund_id,
    });
    return toInitiatedRefund(prior);
  }

  // Refundable cap (server-side pre-flight; RPC remains the hard guard).
  const refundable = await computeRefundableAmount(input.clinicId, invoice.id);
  if (input.amount > refundable + 0.005) throw new PortalRefundError('REFUND_EXCEEDS_PAID', 400);

  const provider = getPaymentProvider();
  let refund: { id: string; status: string; amountMinor: number; currency: string };
  try {
    refund = await provider.createRefund({
      paymentIntentId: payment.reference!,
      amountMinor: toMinor(input.amount, currency),
      currency,
      reason: input.reason,
      metadata: {
        clinic_id: input.clinicId,
        patient_id: invoice.patient_id,
        invoice_id: invoice.id,
        kind: PORTAL_REFUND_KIND,
      },
      idempotencyKey,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logEvent('portal_refund_provider_error', { clinic_id: input.clinicId, payment_id: input.paymentId, error: message }, 'error');
    if (err instanceof PaymentProviderError) throw err;
    // Stripe API errors are plain Error with a message — surface a safe mapping.
    if (/invalid|not found|cannot be refunded|already been refunded/i.test(message)) {
      throw new PortalRefundError('PROVIDER_REFUND_REJECTED', 400);
    }
    throw new PortalRefundError('PROVIDER_REFUND_FAILED', 503);
  }

  const status = refund.status === 'succeeded' ? 'succeeded' : refund.status === 'failed' ? 'failed' : 'pending';
  const { data: inserted, error: insErr } = await supabaseAdmin
    .from('clinic_payment_refunds')
    .insert({
      clinic_id: input.clinicId,
      patient_id: invoice.patient_id,
      invoice_id: invoice.id,
      clinic_payment_id: payment.id,
      provider_refund_id: refund.id,
      amount: input.amount,
      currency,
      status,
      reason: input.reason,
      idempotency_key: idempotencyKey,
      metadata: { kind: PORTAL_REFUND_KIND, payment_intent_id: payment.reference },
    })
    .select('id')
    .single();
  if (insErr || !inserted) {
    // Hard guard: a concurrent duplicate raced past the pre-check and hit the
    // unique (clinic_id, idempotency_key) index → return the ORIGINAL refund.
    if (insErr && /23505|duplicate key value violates unique constraint/i.test(`${insErr.code ?? ''} ${insErr.message}`)) {
      const raced = await findRefundByIdempotencyKey(input.clinicId, idempotencyKey);
      if (raced && raced.clinic_payment_id === payment.id) {
        logEvent('portal_refund_concurrent_replay', {
          clinic_id: input.clinicId,
          provider_refund_id: raced.provider_refund_id,
        });
        return toInitiatedRefund(raced);
      }
    }
    logEvent('portal_refund_track_error', { clinic_id: input.clinicId, error: insErr?.message ?? 'no id' }, 'error');
    throw new PortalRefundError('REFUND_TRACK_FAILED', 500);
  }

  await writeAuditLog({
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    action: 'portal_refund_requested',
    resourceType: 'clinic_payment_refunds',
    resourceId: inserted.id,
    metadata: {
      original_payment_id: payment.id,
      invoice_id: invoice.id,
      amount: input.amount,
      currency,
      provider_refund_id: refund.id,
      reason: input.reason,
    },
  });
  logEvent('portal_refund_requested', {
    clinic_id: input.clinicId,
    invoice_id: invoice.id,
    payment_id: payment.id,
    provider_refund_id: refund.id,
    amount: input.amount,
    currency,
  });

  return {
    refundId: inserted.id,
    providerRefundId: refund.id,
    status,
    amount: input.amount,
    currency,
    invoiceId: invoice.id,
    patientId: invoice.patient_id,
  };
}
export type PortalRefundWebhookOutcome = {
  handled: boolean;
  recorded?: boolean;
  duplicate?: boolean;
  requiresReview?: boolean;
  ignored?: boolean;
};

/**
 * Webhook-side handler — called ONLY from the verified webhook route.
 * Events: refund.created / refund.updated (object = Refund).
 *
 * RULES:
 *  - Only `status === 'succeeded'` may touch the books — via the existing
 *    refund_payment RPC (never a new payment, never a raw insert).
 *  - Booking is atomic (booked_at claim): duplicate/concurrent deliveries →
 *    EXACTLY ONE ledger reversal per provider refund id.
 *  - Provider is authoritative: we cross-check live provider state before
 *    booking (defense-in-depth, mirrors the payment_intent.succeeded path).
 */
export async function handlePortalRefundEvent(
  refund: any
): Promise<PortalRefundWebhookOutcome> {
  const providerRefundId: string = String(refund?.id ?? '');
  const metadata = refund?.metadata ?? {};
  if (!providerRefundId || metadata?.kind !== PORTAL_REFUND_KIND) {
    return { handled: false, ignored: true };
  }

  const { data: trackedRow } = await supabaseAdmin
    .from('clinic_payment_refunds')
    .select('id, clinic_id, clinic_payment_id, amount, currency, status, booked_at')
    .eq('provider_refund_id', providerRefundId)
    .maybeSingle();
  const tracked = (trackedRow ?? null) as {
    id: string;
    clinic_id: string;
    clinic_payment_id: string;
    amount: number;
    currency: string;
    status: string;
    booked_at: string | null;
  } | null;

  if (!tracked) {
    logEvent('portal_refund_webhook_untracked', { provider_refund_id: providerRefundId }, 'warn');
    return { handled: true, ignored: true };
  }

  const newStatus: string = String(refund?.status ?? tracked.status);

  if (newStatus !== 'succeeded') {
    await supabaseAdmin
      .from('clinic_payment_refunds')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', tracked.id);
    logEvent('portal_refund_status', {
      clinic_id: tracked.clinic_id,
      provider_refund_id: providerRefundId,
      status: newStatus,
    });
    return { handled: true, duplicate: tracked.booked_at != null };
  }

  // ===== status = 'succeeded' → book the reversal =====
  if (tracked.booked_at) {
    logEvent('portal_refund_duplicate', { clinic_id: tracked.clinic_id, provider_refund_id: providerRefundId });
    return { handled: true, duplicate: true };
  }

  // Cross-check the REAL refund on the provider (fail closed on mismatch).
  let verified = false;
  try {
    const provider = getPaymentProvider();
    const live = await provider.getRefund(providerRefundId);
    const major = toMajor(live.amountMinor, tracked.currency);
    if (
      live.status === 'succeeded' &&
      live.currency === tracked.currency &&
      Math.abs(major - Number(tracked.amount)) < 0.005
    ) {
      verified = true;
    } else {
      logEvent('portal_refund_mismatch', {
        clinic_id: tracked.clinic_id,
        provider_refund_id: providerRefundId,
        live_status: live.status,
        live_currency: live.currency,
        tracked_currency: tracked.currency,
        live_major: major,
        tracked_amount: Number(tracked.amount),
      }, 'error');
    }
  } catch (err) {
    // Let the provider retry: without provider verification we never book.
    logEvent('portal_refund_fetch_failed', {
      clinic_id: tracked.clinic_id,
      provider_refund_id: providerRefundId,
      error: err instanceof Error ? err.message : String(err),
    }, 'error');
    throw err;
  }
  if (!verified) {
    await supabaseAdmin
      .from('clinic_payment_refunds')
      .update({ status: 'needs_review', updated_at: new Date().toISOString() })
      .eq('id', tracked.id);
    logEvent('portal_refund_requires_review', { clinic_id: tracked.clinic_id, provider_refund_id: providerRefundId }, 'error');
    return { handled: true, requiresReview: true };
  }

  // Atomic claim — EXACTLY ONE booking per provider refund id even under
  // concurrent/duplicate deliveries.
  const claimedAt = new Date().toISOString();
  const { data: claimed } = await supabaseAdmin
    .from('clinic_payment_refunds')
    .update({ booked_at: claimedAt, status: 'succeeded', updated_at: claimedAt })
    .eq('id', tracked.id)
    .is('booked_at', null)
    .select('id')
    .maybeSingle();
  if (!claimed) {
    logEvent('portal_refund_duplicate', { clinic_id: tracked.clinic_id, provider_refund_id: providerRefundId });
    return { handled: true, duplicate: true };
  }
// Book via the EXISTING accounting RPC. refund_payment enforces
  // REFUND_EXCEEDS_PAID and INVOICE_VOIDED — accounting invariants stay
  // authoritative.
  const majorAmount = toMajor(Number(refund?.amount ?? tracked.amount), tracked.currency);
  try {
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('refund_payment', {
      p_clinic_id: tracked.clinic_id,
      p_payment_id: tracked.clinic_payment_id,
      p_amount: majorAmount,
      p_reason: `portal refund ${providerRefundId} — ${String(refund?.reason ?? '')}`,
      p_refunded_by: null,
    });
    if (rpcError) throw new Error(rpcError.message);
    const refundId = rpcData as string | null;
    await writeAuditLog({
      clinicId: tracked.clinic_id,
      actorUserId: null,
      action: 'portal_refund_recorded',
      resourceType: 'clinic_payments',
      resourceId: refundId ?? tracked.clinic_payment_id,
      metadata: { provider_refund_id: providerRefundId, amount: majorAmount, currency: tracked.currency },
    });
    logEvent('portal_refund_recorded', {
      clinic_id: tracked.clinic_id,
      provider_refund_id: providerRefundId,
      amount: majorAmount,
      currency: tracked.currency,
    });
    return { handled: true, recorded: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Money already returned at the provider but the books refused (e.g. the
    // invoice was voided meanwhile) → mark needs_review; booked_at is already
    // claimed so a re-delivery will NOT double-book.
    logEvent('portal_refund_book_error', {
      clinic_id: tracked.clinic_id,
      provider_refund_id: providerRefundId,
      error: message,
    }, 'error');
    await supabaseAdmin
      .from('clinic_payment_refunds')
      .update({ status: 'needs_review', updated_at: new Date().toISOString() })
      .eq('id', tracked.id);
    return { handled: true, requiresReview: true };
  }
}