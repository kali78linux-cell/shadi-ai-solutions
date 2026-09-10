/**
 * STEP 15A — Server-only Stripe Price ID resolution.
 *
 * Removed the silent fallback strings ('price_founding_monthly' etc.) that used to
 * live in lib/subscription/plans.ts. A paid plan MUST have a real, well-formed
 * Stripe Price ID configured or checkout fails loudly (PAYMENT_NOT_CONFIGURED).
 *
 * This module is server-only: it reads process.env and must never be imported
 * from a client component.
 */

// The three paid plans in lib/subscription/plans.ts (founding / growth / pro).
const PRICE_ENV_KEY: Record<string, string> = {
  founding: 'STRIPE_PRICE_FOUNDING_MONTHLY',
  growth: 'STRIPE_PRICE_GROWTH_MONTHLY',
  pro: 'STRIPE_PRICE_PRO_MONTHLY',
};

/** Real Stripe Price IDs always look like `price_<base58>`. */
const PRICE_ID_PATTERN = /^price_[A-Za-z0-9]+$/;

/**
 * Returns the configured Stripe Price ID for a plan, or null when missing,
 * empty or malformed (e.g. the old literal `price_growth_monthly` placeholders).
 * Read lazily from process.env at call time (safe under test env mutation and
 * Next.js runtime env injection alike).
 */
export function getStripePriceId(planId: string): string | null {
  const envKey = PRICE_ENV_KEY[planId];
  if (!envKey) return null;
  const id = process.env[envKey];
  if (!id) return null;
  const trimmed = id.trim();
  return PRICE_ID_PATTERN.test(trimmed) ? trimmed : null;
}