import { createHash } from 'crypto';

/**
 * PP-3 — Payment provider abstraction (owner amendment #1: REQUIRED).
 *
 * Portal payments are wired to THIS interface only — never to a concrete
 * provider's API. Stripe is the first adapter (stripeProvider.ts); a regional
 * gateway adapter (Moyasar/Tap/HyperPay…) can be added later without touching
 * the portal service, webhook, or accounting integration.
 *
 * Hard invariants (hold for EVERY adapter):
 *  - No PAN/CVC/card data ever passes through the server (hosted confirmation).
 *  - amountMinor/currency are always SERVER-derived (invoice balance snapshot).
 *  - Metadata carries clinic_id/patient_id/invoice_id/kind for webhook routing.
 *  - create* calls accept an idempotency key (provider-level dedup for retries).
 */

export const PORTAL_PAYMENT_KIND = 'portal_payment';
export const PORTAL_REFUND_KIND = 'portal_refund';

export type CreateIntentParams = {
  /** Smallest currency unit (e.g. cents — or fils for 3-decimal currencies). */
  amountMinor: number;
  /** lowercase ISO-4217 (Stripe convention; adapters normalize). */
  currency: string;
  metadata: {
    clinic_id: string;
    patient_id: string;
    invoice_id: string;
    kind: typeof PORTAL_PAYMENT_KIND;
  };
  description?: string;
  /** Connect destination (Express/destination-charge model) — adapter decides. */
  destinationAccountId?: string | null;
  onBehalfOfAccountId?: string | null;
  /** Provider-level idempotency for create retries. */
  idempotencyKey: string;
};

export type PaymentIntentInfo = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  /** Returned to the portal client for hosted confirmation. Never stored. */
  clientSecret: string | null;
  failureMessage: string | null;
};

export type ProviderReadiness = {
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingStatus: 'pending' | 'onboarding' | 'complete' | 'restricted';
  accountId: string | null;
  country: string | null;
};

/**
 * PP-4 — provider refund request. The provider (Stripe) is authoritative for
 * the refund lifecycle; only `refund.updated` with status 'succeeded' books
 * the accounting reversal (via the existing refund_payment RPC).
 */
export type CreateRefundParams = {
  /** The original PaymentIntent id (e.g. pi_...) — provider-charge reference. */
  paymentIntentId: string;
  /** Smallest currency unit — server-derived (invoice currency). */
  amountMinor: number;
  /** lowercase ISO-4217. */
  currency: string;
  reason: string;
  metadata: {
    clinic_id: string;
    patient_id: string;
    invoice_id: string;
    kind: typeof PORTAL_REFUND_KIND;
  };
  /** Provider-level idempotency key (duplicate requests → one provider refund). */
  idempotencyKey: string;
};

export type RefundInfo = {
  id: string;
  status: string;
  amountMinor: number;
  currency: string;
  failureMessage: string | null;
};

export interface PaymentProvider {
  readonly name: string;
  createPaymentIntent(params: CreateIntentParams): Promise<PaymentIntentInfo>;
  getPaymentIntent(intentId: string): Promise<PaymentIntentInfo>;
  createConnectAccount(params: { country: string; idempotencyKey: string }): Promise<{ accountId: string }>;
  createConnectAccountLink(params: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  getConnectAccountReadiness(accountId: string): Promise<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
  }>;
  /** PP-4 — request a provider refund (never passes card data; server-derived amount). */
  createRefund(params: CreateRefundParams): Promise<RefundInfo>;
  /** PP-4 — authoritative provider refund state (webhook cross-check). */
  getRefund(refundId: string): Promise<RefundInfo>;
}

export class PaymentProviderError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 503, message?: string) {
    super(message ?? code);
    this.code = code;
    this.status = status;
  }
}

/** Resolves the active adapter. Only Stripe exists today (owner amendment #6). */
export function getPaymentProvider(): PaymentProvider {
  // Lazy import keeps test mocking and edge bundles clean.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { getStripeConfig } = require('./stripe') as typeof import('./stripe');
  if (!getStripeConfig().secretKey) {
    throw new PaymentProviderError('PAYMENT_PROVIDER_UNCONFIGURED', 503);
  }
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { stripePaymentProvider } = require('./stripeProvider') as typeof import('./stripeProvider');
  return stripePaymentProvider;
}

// ---------------------------------------------------------------------------
// Currency minor-unit helpers — amounts cross the system as MAJOR units in the
// accounting tables (numeric(12,2)) and as MINOR units at the provider.
// ---------------------------------------------------------------------------

/** ISO-4217 currencies with 3 decimal places (Stripe special-cases these). */
const THREE_DECIMAL_CURRENCIES = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd', 'iqd', 'lyd']);

export function currencyExponent(currency: string): number {
  return THREE_DECIMAL_CURRENCIES.has(currency.toLowerCase()) ? 3 : 2;
}

/** Major accounting amount → provider minor amount (rounded, never truncated). */
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyExponent(currency));
}

/** Provider minor amount → major accounting amount. */
export function toMajor(amountMinor: number, currency: string): number {
  return amountMinor / 10 ** currencyExponent(currency);
}

/**
 * Deterministic UUID from a provider intent id — used as clinic_payments
 * idempotency_key so the SAME provider intent can never be recorded twice,
 * regardless of webhook delivery count (Phase A unique partial index enforces).
 */
export function intentIdToUuid(intentId: string): string {
  const hex = createHash('sha256').update(`portal_payment:${intentId}`).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}