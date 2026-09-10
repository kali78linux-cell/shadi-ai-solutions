import {
  type PaymentProvider,
  type CreateIntentParams,
  type PaymentIntentInfo,
  type CreateRefundParams,
  type RefundInfo,
  PORTAL_REFUND_KIND,
} from './provider';
import { stripeRequestWithHeaders } from './stripe';

/**
 * PP-3 — Stripe adapter (the ONLY concrete provider today; owner amendment #1).
 *
 * Model (D-PP3-a): Stripe Connect, Express-style connected accounts with
 * Stripe-hosted onboarding. NOT Standard; NOT direct charges without Connect.
 *
 * Owner amendment #3: this adapter does NOT assume any country is supported.
 * The connected account is created with the clinic's own country; if Stripe
 * rejects it (country unsupported), the error surfaces as-is — no workarounds.
 * Country availability stays an EXTERNAL PRODUCTION GATE.
 *
 * API surface (owner review note #4): built against the v1 Connect API
 * (`/v1/accounts` type=express + `/v1/account_links`), which is the stable,
 * universally documented surface. Accounts-v2 can be adopted later behind the
 * same interface without touching portal/webhook/accounting code.
 */

function intentFrom(pi: any): PaymentIntentInfo {
  return {
    id: String(pi?.id ?? ''),
    status: String(pi?.status ?? 'unknown'),
    amountMinor: Number(pi?.amount ?? 0),
    currency: String(pi?.currency ?? '').toLowerCase(),
    clientSecret: pi?.client_secret ?? null,
    failureMessage: pi?.last_payment_error?.message ?? null,
  };
}

function refundFrom(r: any): RefundInfo {
  return {
    id: String(r?.id ?? ''),
    status: String(r?.status ?? 'unknown'),
    amountMinor: Number(r?.amount ?? 0),
    currency: String(r?.currency ?? '').toLowerCase(),
    failureMessage: r?.failure_reason ?? null,
  };
}

export const stripePaymentProvider: PaymentProvider = {
  name: 'stripe',

  async createPaymentIntent(params: CreateIntentParams): Promise<PaymentIntentInfo> {
    // Stripe form encoding: nested fields use bracket notation
    // (metadata[clinic_id]=…, automatic_payment_methods[enabled]=true).
    const pairs: Array<[string, string]> = [
      ['amount', String(params.amountMinor)],
      ['currency', params.currency.toLowerCase()],
      ['automatic_payment_methods[enabled]', 'true'],
      ['metadata[clinic_id]', params.metadata.clinic_id],
      ['metadata[patient_id]', params.metadata.patient_id],
      ['metadata[invoice_id]', params.metadata.invoice_id],
      ['metadata[kind]', params.metadata.kind],
    ];
    if (params.description) pairs.push(['description', params.description]);
    // Connect destination-charge semantics (Express model): funds settle to the
    // clinic's connected account; `on_behalf_of` makes the clinic the merchant
    // of record when provided.
    if (params.destinationAccountId) pairs.push(['transfer_data[destination]', params.destinationAccountId]);
    if (params.onBehalfOfAccountId) pairs.push(['on_behalf_of', params.onBehalfOfAccountId]);

    const pi = await stripeRequestWithHeaders('/payment_intents', {
      method: 'POST',
      body: new URLSearchParams(pairs).toString(),
      headers: { 'Idempotency-Key': params.idempotencyKey },
    });
    return intentFrom(pi);
  },

  async getPaymentIntent(intentId: string): Promise<PaymentIntentInfo> {
    if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) throw new Error('INVALID_INTENT_ID');
    const pi = await stripeRequestWithHeaders(`/payment_intents/${encodeURIComponent(intentId)}`);
    return intentFrom(pi);
  },

  async createConnectAccount(params: { country: string; idempotencyKey: string }): Promise<{ accountId: string }> {
    const form = new URLSearchParams({
      type: 'express',
      country: params.country.toUpperCase(),
      'capabilities[card_payments][requested]': 'true',
      'capabilities[transfers][requested]': 'true',
    }).toString();
    const account = await stripeRequestWithHeaders('/accounts', {
      method: 'POST',
      body: form,
      headers: { 'Idempotency-Key': params.idempotencyKey },
    });
    return { accountId: String(account?.id ?? '') };
  },

  async createConnectAccountLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }> {
    const form = new URLSearchParams({
      account: params.accountId,
      refresh_url: params.refreshUrl,
      return_url: params.returnUrl,
      type: 'account_onboarding',
    }).toString();
    const link = await stripeRequestWithHeaders('/account_links', { method: 'POST', body: form });
    return { url: String(link?.url ?? '') };
  },

  async getConnectAccountReadiness(accountId: string): Promise<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  }> {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new Error('INVALID_ACCOUNT_ID');
    const account = await stripeRequestWithHeaders(`/accounts/${encodeURIComponent(accountId)}`);
    return {
      chargesEnabled: Boolean(account?.charges_enabled),
      payoutsEnabled: Boolean(account?.payouts_enabled),
      detailsSubmitted: Boolean(account?.details_submitted),
    };
  },

  async createRefund(params: CreateRefundParams): Promise<RefundInfo> {
    if (!/^pi_[A-Za-z0-9]+$/.test(params.paymentIntentId)) throw new Error('INVALID_PAYMENT_INTENT_ID');
    const pairs: Array<[string, string]> = [
      ['payment_intent', params.paymentIntentId],
      ['amount', String(params.amountMinor)],
      ['currency', params.currency.toLowerCase()],
      ['metadata[clinic_id]', params.metadata.clinic_id],
      ['metadata[patient_id]', params.metadata.patient_id],
      ['metadata[invoice_id]', params.metadata.invoice_id],
      ['metadata[kind]', PORTAL_REFUND_KIND],
    ];
    if (params.reason) pairs.push(['reason', params.reason]);
    const refund = await stripeRequestWithHeaders('/refunds', {
      method: 'POST',
      body: new URLSearchParams(pairs).toString(),
      headers: { 'Idempotency-Key': params.idempotencyKey },
    });
    return refundFrom(refund);
  },

  async getRefund(refundId: string): Promise<RefundInfo> {
    if (!/^re_[A-Za-z0-9]+$/.test(refundId)) throw new Error('INVALID_REFUND_ID');
    const refund = await stripeRequestWithHeaders(`/refunds/${encodeURIComponent(refundId)}`);
    return refundFrom(refund);
  },
};