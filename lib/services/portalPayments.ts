import { randomUUID } from 'crypto';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';
import { loadClinicLocalization } from '@/lib/clinic/localization';
import {
  PORTAL_PAYMENT_KIND,
  PaymentProviderError,
  currencyExponent,
  getPaymentProvider,
  intentIdToUuid,
  toMajor,
  toMinor,
} from '@/lib/payments/provider';
import type { PatientIdentity } from '@/lib/services/patientPortal';

/**
 * PP-3 — Patient Portal Payments service (owner-approved command + 6 amendments).
 *
 * Source-of-truth map (approved command §7):
 *   provider (Stripe)  = payment state   (payment_intent.status)
 *   clinic_payments    = clinic books    (written ONLY via record_payment RPC, ONLY from the webhook)
 *   invoice_balances   = derived         (never stored)
 *   reference          = reconciliation  (provider intent id)
 *
 * Security invariants:
 *   - clinic_id/patient_id ALWAYS from the verified portal identity (PP-1);
 *     client-supplied ids are ignored entirely.
 *   - amount = server-derived invoice balance; currency = invoice snapshot
 *     (amendment #2: clinic_invoices.currency is authoritative;
 *     clinic_settings.currency ONLY as legacy fallback for NULL invoices).
 *   - No client-supplied currency/amount/destination account. Ever.
 */

export class PortalPaymentError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

type InvoiceRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  status: string;
  currency: string | null;
  total: number;
};

/** Loads an invoice STRICTLY owned by the verified identity, payable state only. */
async function loadOwnPayableInvoice(
  identity: PatientIdentity,
  invoiceId: string
): Promise<{ invoice: InvoiceRow; balance: number }> {
  const { data: inv, error: invErr } = await supabaseAdmin
    .from('clinic_invoices')
    .select('id, clinic_id, patient_id, status, currency, total')
    .eq('clinic_id', identity.clinic_id)
    .eq('patient_id', identity.patient_id)
    .eq('id', invoiceId)
    .maybeSingle();
  if (invErr) {
    logEvent('portal_pay_intent_invoice_error', { clinic_id: identity.clinic_id, error: invErr.message }, 'error');
    throw new PortalPaymentError('INVOICE_LOOKUP_FAILED', 500);
  }
  // Not owned → indistinguishable from nonexistent (no existence disclosure).
  const invoice = (inv ?? null) as InvoiceRow | null;
  if (!invoice) throw new PortalPaymentError('INVOICE_NOT_FOUND', 404);
  if (invoice.status === 'voided') throw new PortalPaymentError('INVOICE_VOIDED', 409);

  const { data: bal, error: balErr } = await supabaseAdmin
    .from('invoice_balances')
    .select('balance_amount')
    .eq('clinic_id', identity.clinic_id)
    .eq('invoice_id', invoiceId)
    .maybeSingle();
  if (balErr) {
    logEvent('portal_pay_intent_balance_error', { clinic_id: identity.clinic_id, error: balErr.message }, 'error');
    throw new PortalPaymentError('INVOICE_LOOKUP_FAILED', 500);
  }
  const balance = Number((bal as { balance_amount: number } | null)?.balance_amount ?? 0);
  if (!(balance > 0)) throw new PortalPaymentError('INVOICE_NOT_PAYABLE', 409);
  return { invoice, balance: Math.round(balance * 100) / 100 };
}

/** Amendment #2 — invoice currency is AUTHORITATIVE; settings only as legacy fallback. */
async function resolveIntentCurrency(invoice: InvoiceRow): Promise<string> {
  if (invoice.currency && /^[A-Za-z]{3}$/.test(invoice.currency)) return invoice.currency.toLowerCase();
  const loc = await loadClinicLocalization(invoice.clinic_id);
  return loc.currency.toLowerCase();
}

export type ConnectReadinessRow = {
  id: string;
  clinic_id: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  onboarding_status: string;
  country: string | null;
};

function deriveOnboardingStatus(
  detailsSubmitted: boolean,
  chargesEnabled: boolean,
  previous: string
): 'pending' | 'onboarding' | 'complete' | 'restricted' {
  if (detailsSubmitted && chargesEnabled) return 'complete';
  if (previous === 'complete' && !chargesEnabled) return 'restricted';
  if (detailsSubmitted) return 'onboarding';
  return 'pending';
}

/**
 * Connect readiness (amendments #3/#4): read the mirrored row, then SYNC-ON-READ
 * from the provider (authoritative at the moment of charging). If the provider
 * is unreachable we degrade to the mirrored values — logged, never silent.
 * No ledger writes from this path.
 */
export async function ensureConnectReadiness(clinicId: string): Promise<ConnectReadinessRow> {
  const { data: row, error } = await supabaseAdmin
    .from('clinic_stripe_connect_accounts')
    .select('id, clinic_id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status, country')
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) {
    logEvent('portal_connect_readiness_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new PortalPaymentError('PROVIDER_READINESS_FAILED', 500);
  }
  const record = (row ?? null) as ConnectReadinessRow | null;
  if (!record) throw new PortalPaymentError('PROVIDER_NOT_CONNECTED', 409);

  try {
    const provider = getPaymentProvider();
    const live = await provider.getConnectAccountReadiness(record.stripe_account_id);
    const status = deriveOnboardingStatus(live.detailsSubmitted, live.chargesEnabled, record.onboarding_status);
    if (
      live.chargesEnabled !== record.charges_enabled ||
      live.payoutsEnabled !== record.payouts_enabled ||
      status !== record.onboarding_status
    ) {
      await supabaseAdmin
        .from('clinic_stripe_connect_accounts')
        .update({
          charges_enabled: live.chargesEnabled,
          payouts_enabled: live.payoutsEnabled,
          onboarding_status: status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', record.id);
    }
    return {
      ...record,
      charges_enabled: live.chargesEnabled,
      payouts_enabled: live.payoutsEnabled,
      onboarding_status: status,
    };
  } catch (err) {
    // Graceful fallback to the mirrored state (webhook account.updated keeps it fresh).
    logEvent('portal_connect_sync_fallback', {
      clinic_id: clinicId,
      error: err instanceof Error ? err.message : String(err),
    }, 'warn');
    return record;
  }
}

async function assertConnectChargesEnabled(clinicId: string): Promise<ConnectReadinessRow> {
  const ready = await ensureConnectReadiness(clinicId);
  if (!ready.charges_enabled) throw new PortalPaymentError('PROVIDER_NOT_READY', 409);
  return ready;
}

export type PortalIntentResult = {
  client_secret: string | null;
  payment_intent_id: string;
  status: string;
  amount: number;
  currency: string;
};

/**
 * Core portal intent entry (command §4 steps 1-12):
 * reuse a compatible ACTIVE intent for the same invoice, else create a new one.
 * A provider intent's amount is immutable — a balance change invalidates reuse
 * and forces a fresh intent (the stale tracked row moves to 'canceled').
 */
export async function createOrReusePortalIntent(
  identity: PatientIdentity,
  invoiceId: string
): Promise<PortalIntentResult> {
  const { invoice, balance } = await loadOwnPayableInvoice(identity, invoiceId);
  const ready = await assertConnectChargesEnabled(invoice.clinic_id);
  const currency = await resolveIntentCurrency(invoice);
  const amountMinor = toMinor(balance, currency);
  const provider = getPaymentProvider();

  const { data: existing } = await supabaseAdmin
    .from('clinic_payment_intents')
    .select('id, stripe_payment_intent_id, amount, currency, status')
    .eq('clinic_id', invoice.clinic_id)
    .eq('invoice_id', invoice.id)
    .eq('status', 'requires_payment_method')
    .maybeSingle();
  const tracked = (existing ?? null) as {
    id: string;
    stripe_payment_intent_id: string;
    amount: number;
    currency: string;
    status: string;
  } | null;

  if (tracked) {
    const sameAmount = Math.abs(Number(tracked.amount) - balance) < 0.005;
    const sameCurrency = tracked.currency === currency;
    try {
      const live = await provider.getPaymentIntent(tracked.stripe_payment_intent_id);
      if (live.status === 'succeeded' || live.status === 'processing') {
        // Money already moving — hand the truth back, create nothing.
        await supabaseAdmin
          .from('clinic_payment_intents')
          .update({
            status: live.status === 'succeeded' ? 'succeeded' : 'processing',
            updated_at: new Date().toISOString(),
          })
          .eq('id', tracked.id);
        return { client_secret: null, payment_intent_id: live.id, status: live.status, amount: balance, currency };
      }
      if (live.status === 'failed' || live.status === 'canceled') {
        await supabaseAdmin
          .from('clinic_payment_intents')
          .update({ status: live.status, failure_message: live.failureMessage, updated_at: new Date().toISOString() })
          .eq('id', tracked.id);
        // fall through → retire row → create a fresh intent
      } else if (sameAmount && sameCurrency && live.status === 'requires_payment_method') {
        // REUSE — amount/currency still valid; client_secret from live fetch
        // (never stored at rest).
        return {
          client_secret: live.clientSecret,
          payment_intent_id: live.id,
          status: live.status,
          amount: balance,
          currency,
        };
      }
      // else: stale → retire row → create new
    } catch (err) {
      logEvent('portal_intent_reuse_fetch_failed', {
        clinic_id: invoice.clinic_id,
        invoice_id: invoice.id,
        error: err instanceof Error ? err.message : String(err),
      }, 'warn');
      // Provider unreachable → do NOT blind-create; surface a retryable state.
      if (err instanceof PaymentProviderError) throw err;
      throw new PortalPaymentError('PROVIDER_UNAVAILABLE', 503);
    }
    await supabaseAdmin
      .from('clinic_payment_intents')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('id', tracked.id);
  }

  // Create a new provider intent (server-derived amount/currency only).
  const intent = await provider.createPaymentIntent({
    amountMinor,
    currency,
    metadata: {
      clinic_id: invoice.clinic_id,
      patient_id: invoice.patient_id,
      invoice_id: invoice.id,
      kind: PORTAL_PAYMENT_KIND,
    },
    destinationAccountId: ready.stripe_account_id,
    onBehalfOfAccountId: ready.stripe_account_id,
    idempotencyKey: randomUUID(),
  });

  const { error: insErr } = await supabaseAdmin.from('clinic_payment_intents').insert({
    clinic_id: invoice.clinic_id,
    patient_id: invoice.patient_id,
    invoice_id: invoice.id,
    stripe_payment_intent_id: intent.id,
    amount: balance,
    currency,
    status: intent.status === 'requires_payment_method' ? 'requires_payment_method' : 'initiated',
  });
  if (insErr) {
    logEvent('portal_intent_track_error', { clinic_id: invoice.clinic_id, error: insErr.message }, 'error');
    throw new PortalPaymentError('INTENT_TRACK_FAILED', 500);
  }
  logEvent('portal_payment_intent_created', {
    clinic_id: invoice.clinic_id,
    invoice_id: invoice.id,
    intent_id: intent.id,
    amount_minor: amountMinor,
    currency,
    exponent: currencyExponent(currency),
  });

  return {
    client_secret: intent.clientSecret,
    payment_intent_id: intent.id,
    status: intent.status,
    amount: balance,
    currency,
  };
}

// ---------------------------------------------------------------------------
// Webhook-side service functions (called ONLY from the verified webhook route).
// The webhook is the ONLY writer of portal payments to the books (command §5).
// ---------------------------------------------------------------------------

export type PortalWebhookOutcome = {
  handled: boolean;
  recorded?: boolean;
  duplicate?: boolean;
  requiresReview?: boolean;
  ignored?: boolean;
};

/** payment_intent.succeeded — verify → validate metadata → reconcile → record_payment RPC. */
export async function handlePortalIntentSucceeded(pi: any): Promise<PortalWebhookOutcome> {
  const intentId: string = String(pi?.id ?? '');
  const metadata = pi?.metadata ?? {};
  if (!intentId || metadata?.kind !== PORTAL_PAYMENT_KIND) return { handled: false, ignored: true };

  const { data: trackedRow } = await supabaseAdmin
    .from('clinic_payment_intents')
    .select('id, clinic_id, patient_id, invoice_id, amount, currency, status')
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  const tracked = (trackedRow ?? null) as {
    id: string;
    clinic_id: string;
    patient_id: string;
    invoice_id: string;
    amount: number;
    currency: string;
    status: string;
  } | null;

  if (!tracked) {
    logEvent('portal_webhook_intent_untracked', { intent_id: intentId }, 'error');
    return { handled: true, ignored: true };
  }
  if (metadata.clinic_id && metadata.clinic_id !== tracked.clinic_id) {
    logEvent('portal_webhook_metadata_mismatch', { intent_id: intentId }, 'error');
    await supabaseAdmin
      .from('clinic_payment_intents')
      .update({ status: 'requires_review', failure_message: 'METADATA_MISMATCH', updated_at: new Date().toISOString() })
      .eq('id', tracked.id);
    return { handled: true, requiresReview: true };
  }

  // Cross-check the REAL intent on the provider (defense-in-depth, mirrors the
  // Platform Billing checkout webhook pattern). Fail closed on mismatch.
  let verified = false;
  try {
    const provider = getPaymentProvider();
    const live = await provider.getPaymentIntent(intentId);
    const major = toMajor(live.amountMinor, tracked.currency);
    if (
      live.status === 'succeeded' &&
      live.currency === tracked.currency &&
      Math.abs(major - Number(tracked.amount)) < 0.005
    ) {
      verified = true;
    } else {
      logEvent('portal_webhook_intent_mismatch', {
        intent_id: intentId,
        live_status: live.status,
        live_currency: live.currency,
        tracked_currency: tracked.currency,
        live_major: major,
        tracked_amount: Number(tracked.amount),
      }, 'error');
    }
  } catch (err) {
    // Let Stripe retry: without provider verification we never write books.
    logEvent('portal_webhook_intent_fetch_failed', {
      intent_id: intentId,
      error: err instanceof Error ? err.message : String(err),
    }, 'error');
    throw err;
  }
  if (!verified) {
    await supabaseAdmin
      .from('clinic_payment_intents')
      .update({ status: 'requires_review', failure_message: 'INTENT_MISMATCH', updated_at: new Date().toISOString() })
      .eq('id', tracked.id);
    return { handled: true, requiresReview: true };
  }

  const majorAmount = toMajor(Number(pi?.amount ?? 0), tracked.currency);

  try {
    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('record_payment', {
      p_clinic_id: tracked.clinic_id,
      p_invoice_id: tracked.invoice_id,
      p_amount: majorAmount,
      p_method: 'card',
      p_reference: intentId,
      p_idempotency_key: intentIdToUuid(intentId),
      p_recorded_by: null,
    });
    if (rpcError) throw new Error(rpcError.message);
    const result = (rpcData ?? {}) as { payment_id?: string; duplicate?: boolean };
    await supabaseAdmin
      .from('clinic_payment_intents')
      .update({ status: 'succeeded', failure_message: null, updated_at: new Date().toISOString() })
      .eq('id', tracked.id);
    logEvent('portal_payment_recorded', {
      clinic_id: tracked.clinic_id,
      invoice_id: tracked.invoice_id,
      intent_id: intentId,
      duplicate: Boolean(result.duplicate),
      payment_id: result.payment_id ?? null,
    });
    return { handled: true, recorded: !result.duplicate, duplicate: Boolean(result.duplicate) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('INVOICE_VOIDED')) {
      // Money moved at the provider but the invoice died first → human review
      // (manual refund belongs to PP-4/ops). NO ledger write (fail closed).
      logEvent('portal_webhook_invoice_voided', { intent_id: intentId, clinic_id: tracked.clinic_id }, 'error');
      await supabaseAdmin
        .from('clinic_payment_intents')
        .update({ status: 'requires_review', failure_message: 'INVOICE_VOIDED', updated_at: new Date().toISOString() })
        .eq('id', tracked.id);
      return { handled: true, requiresReview: true };
    }
    throw err; // retryable failure → Stripe will re-deliver
  }
}

/** payment_intent.payment_failed — lifecycle ONLY; never touches the books. */
export async function handlePortalIntentFailed(pi: any): Promise<PortalWebhookOutcome> {
  const intentId: string = String(pi?.id ?? '');
  if (!intentId || pi?.metadata?.kind !== PORTAL_PAYMENT_KIND) return { handled: false, ignored: true };
  const { data: trackedRow } = await supabaseAdmin
    .from('clinic_payment_intents')
    .select('id, clinic_id')
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  const tracked = (trackedRow ?? null) as { id: string; clinic_id: string } | null;
  if (!tracked) {
    logEvent('portal_webhook_failed_intent_untracked', { intent_id: intentId }, 'warn');
    return { handled: true, ignored: true };
  }
  await supabaseAdmin
    .from('clinic_payment_intents')
    .update({
      status: 'failed',
      failure_message: pi?.last_payment_error?.message ?? 'PAYMENT_FAILED',
      updated_at: new Date().toISOString(),
    })
    .eq('id', tracked.id);
  logEvent('portal_payment_failed', { clinic_id: tracked.clinic_id, intent_id: intentId });
  return { handled: true };
}

/** charge.dispute.created — audit/alert ONLY; no auto-refund (PP-4 out of scope). */
export async function handlePortalDispute(dispute: any): Promise<PortalWebhookOutcome> {
  const intentId: string = String(dispute?.payment_intent ?? '');
  if (!intentId) return { handled: false, ignored: true };
  const { data: trackedRow } = await supabaseAdmin
    .from('clinic_payment_intents')
    .select('id, clinic_id')
    .eq('stripe_payment_intent_id', intentId)
    .maybeSingle();
  const tracked = (trackedRow ?? null) as { id: string; clinic_id: string } | null;
  if (!tracked) {
    logEvent('portal_webhook_dispute_untracked', { intent_id: intentId }, 'warn');
    return { handled: true, ignored: true };
  }
  await writeAuditLog({
    clinicId: tracked.clinic_id,
    actorUserId: null,
    action: 'portal_payment_dispute_created',
    resourceType: 'clinic_payment_intents',
    resourceId: tracked.id,
    metadata: { intent_id: intentId, dispute_id: dispute?.id ?? null, reason: dispute?.reason ?? null },
  });
  logEvent('portal_payment_dispute', { clinic_id: tracked.clinic_id, intent_id: intentId }, 'warn');
  return { handled: true };
}

/** account.updated — Connect readiness mirror. NO ledger writes (amendment #4). */
export async function handleConnectAccountUpdated(account: any): Promise<PortalWebhookOutcome> {
  const accountId: string = String(account?.id ?? '');
  if (!accountId) return { handled: false, ignored: true };
  const { data: row } = await supabaseAdmin
    .from('clinic_stripe_connect_accounts')
    .select('id, clinic_id, onboarding_status')
    .eq('stripe_account_id', accountId)
    .maybeSingle();
  const record = (row ?? null) as { id: string; clinic_id: string; onboarding_status: string } | null;
  if (!record) {
    logEvent('portal_connect_account_untracked', { account_id: accountId }, 'warn');
    return { handled: true, ignored: true };
  }
  const chargesEnabled = Boolean(account?.charges_enabled);
  const payoutsEnabled = Boolean(account?.payouts_enabled);
  const detailsSubmitted = Boolean(account?.details_submitted);
  const status = deriveOnboardingStatus(detailsSubmitted, chargesEnabled, record.onboarding_status);
  await supabaseAdmin
    .from('clinic_stripe_connect_accounts')
    .update({
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      onboarding_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', record.id);
  logEvent('portal_connect_account_updated', {
    clinic_id: record.clinic_id,
    status,
    charges_enabled: chargesEnabled,
  });
  return { handled: true };
}

// ---------------------------------------------------------------------------
// Connect onboarding (command §8) — clinic administration, FINANCE_ADMIN gated
// at the route level. Server-built same-origin URLs only (no open redirect).
// ---------------------------------------------------------------------------

export async function getConnectReadinessView(clinicId: string): Promise<{
  connected: boolean;
  accountId: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  onboarding_status: string;
  country: string | null;
}> {
  const { data: row } = await supabaseAdmin
    .from('clinic_stripe_connect_accounts')
    .select('id, stripe_account_id, charges_enabled, payouts_enabled, onboarding_status, country')
    .eq('clinic_id', clinicId)
    .maybeSingle();
  const record = (row ?? null) as {
    id: string;
    stripe_account_id: string;
    charges_enabled: boolean;
    payouts_enabled: boolean;
    onboarding_status: string;
    country: string | null;
  } | null;
  if (!record) {
    return {
      connected: false,
      accountId: null,
      charges_enabled: false,
      payouts_enabled: false,
      onboarding_status: 'pending',
      country: null,
    };
  }
  // sync-on-read (authoritative readiness for the dashboard); degrade on error.
  const synced = await ensureConnectReadiness(clinicId).catch(() => null);
  return {
    connected: true,
    accountId: record.stripe_account_id,
    charges_enabled: synced?.charges_enabled ?? record.charges_enabled,
    payouts_enabled: synced?.payouts_enabled ?? record.payouts_enabled,
    onboarding_status: synced?.onboarding_status ?? record.onboarding_status,
    country: record.country,
  };
}

/** Creates (or retrieves) the clinic's Express connected account + onboarding link. */
export async function startConnectOnboarding(params: {
  clinicId: string;
  country: string; // server-derived from the clinic profile (never client-supplied)
  refreshUrl: string; // server-built same-origin URL
  returnUrl: string; // server-built same-origin URL
}): Promise<{ accountId: string; onboarding_url: string; onboarding_status: string }> {
  const provider = getPaymentProvider();
  const { data: existing } = await supabaseAdmin
    .from('clinic_stripe_connect_accounts')
    .select('stripe_account_id, onboarding_status')
    .eq('clinic_id', params.clinicId)
    .maybeSingle();
  let accountId: string;
  let onboardingStatus: string;
  const record = (existing ?? null) as { stripe_account_id: string; onboarding_status: string } | null;
  if (record) {
    accountId = record.stripe_account_id;
    onboardingStatus = record.onboarding_status;
  } else {
    const created = await provider.createConnectAccount({
      country: params.country,
      idempotencyKey: randomUUID(),
    });
    const { error: insErr } = await supabaseAdmin.from('clinic_stripe_connect_accounts').insert({
      clinic_id: params.clinicId,
      stripe_account_id: created.accountId,
      onboarding_status: 'pending',
      country: params.country.toUpperCase(),
    });
    if (insErr) {
      logEvent('portal_connect_account_track_error', { clinic_id: params.clinicId, error: insErr.message }, 'error');
      throw new PortalPaymentError('PROVIDER_TRACK_FAILED', 500);
    }
    accountId = created.accountId;
    onboardingStatus = 'pending';
    await writeAuditLog({
      clinicId: params.clinicId,
      actorUserId: null,
      action: 'portal_connect_onboarding_started',
      resourceType: 'clinic_stripe_connect_accounts',
      resourceId: accountId,
      metadata: { country: params.country },
    });
  }
  const link = await provider.createConnectAccountLink({
    accountId,
    refreshUrl: params.refreshUrl,
    returnUrl: params.returnUrl,
  });
  return { accountId, onboarding_url: link.url, onboarding_status: onboardingStatus };
}