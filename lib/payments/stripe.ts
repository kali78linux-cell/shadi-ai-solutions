import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Stripe integration via the public REST API (no SDK dependency).
 * All calls run server-side. Never use the secret key in the browser.
 */

export type StripeConfig = {
  secretKey: string | null;
  webhookSecret: string | null;
  publishableKey: string | null;
  mode: 'test' | 'live' | 'unconfigured';
};

export function getStripeConfig(): StripeConfig {
  const secretKey = process.env.STRIPE_SECRET_KEY ?? null;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? null;
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null;
  const live = (process.env.STRIPE_MODE ?? 'test').toLowerCase() === 'live';
  return {
    secretKey,
    webhookSecret,
    publishableKey,
    mode: secretKey ? (live ? 'live' : 'test') : 'unconfigured',
  };
}

async function stripeRequest(path: string, init?: RequestInit): Promise<any> {
  const config = getStripeConfig();
  if (!config.secretKey) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(init?.headers ?? {}),
    },
    body: init?.body,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message ?? `Stripe HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

/**
 * Contract export for the payment provider adapter (stripeProvider.ts).
 * The adapter calls this for Connect account / PaymentIntent / Refund calls
 * with a form-encoded body + optional idempotency headers. Behaviourally it is
 * the same `stripeRequest` above (which always sends the auth headers).
 */
export const stripeRequestWithHeaders = stripeRequest;

function toForm(data: Record<string, unknown>): string {
  const p = new URLSearchParams();
  // Stripe expects nested structures in PHP-style bracket notation
  // (e.g. line_items[0][price]=...). Flatten recursively.
  const walk = (prefix: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, i) => walk(`${prefix}[${i}]`, item));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(`${prefix}[${k}]`, v);
    } else {
      p.append(prefix, String(value));
    }
  };
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(`${k}[${i}]`, item));
    } else if (typeof v === 'object' && k === 'metadata') {
      // Stripe accepts metadata[key] flat pairs at top level.
      for (const [mk, mv] of Object.entries(v as Record<string, string>)) p.append(`metadata[${mk}]`, String(mv));
    } else {
      p.append(k, String(v));
    }
  }
  return p.toString();
}

export type CreateCheckoutParams = {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  clientReferenceId: string; // clinic_id
  metadata?: Record<string, string>;
};

/** Creates a subscription Checkout Session. Price/amount come from the plan, never the client. */
export async function createCheckoutSession(params: CreateCheckoutParams): Promise<{ url: string; id: string }> {
  const session = await stripeRequest('/checkout/sessions', {
    method: 'POST',
    body: toForm({
      mode: 'subscription',
      line_items: [{ price: params.priceId, quantity: '1' }],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      client_reference_id: params.clientReferenceId,
      metadata: params.metadata ?? {},
    }),
  });
  return { url: session.url, id: session.id };
}

/**
 * Fetches a Checkout Session (with line_items) for the webhook activation
 * cross-check. Uses `?expand[]=line_items` so price/amount/currency can be
 * verified server-side before a subscription is activated.
 */
export async function getCheckoutSession(sessionId: string): Promise<any> {
  return stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`);
}

/**
 * Verifies a Stripe webhook signature (Stripe's `stripe-signature` scheme).
 * Signature header format: `t=<timestamp>,v1=<hex>`.
 */
export function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string | null
): boolean {
  if (!signatureHeader || !secret) return false;
  const parts = new Map<string, string>();
  for (const chunk of signatureHeader.split(',')) {
    const [k, v] = chunk.split('=');
    if (k) parts.set(k, v ?? '');
  }
  const timestamp = parts.get('t');
  const signature = parts.get('v1');
  if (!timestamp || !signature) return false;
  // Reject timestamps older than 5 minutes (replay protection).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 300) return false;

  const signed = `${timestamp}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signed, 'utf8').digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}