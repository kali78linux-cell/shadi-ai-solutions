/**
 * STEP 15G-C — Pending selected plan vs effective plan.
 *
 * When an owner selects a paid plan, checkout keeps the subscription row as
 * `status: 'unpaid'` with the SELECTED plan_id until the Stripe webhook confirms
 * payment (which flips the row to `active`). Entitlements correctly keep the
 * effective plan at Starter (degraded) meanwhile — but the UI must show the
 * SELECTED plan as "awaiting payment" instead of silently displaying Starter.
 *
 * Pure + testable. Never grants the pending plan any effectiveness.
 */
export type PendingSubscriptionLike = {
  plan_id: string | null | undefined;
  status: string | null | undefined;
} | null;

/**
 * Returns the plan_id awaiting payment, or null when nothing is pending.
 * - `unpaid` + non-starter plan_id → that plan is pending payment.
 * - `unpaid` + starter → nothing pending (starter needs no checkout).
 * - any other status (active/trialing/…) → nothing pending (plan already effective).
 */
export function resolvePendingSelectedPlan(subscription: PendingSubscriptionLike): string | null {
  if (!subscription) return null;
  if (subscription.status !== 'unpaid') return null;
  const planId = subscription.plan_id ?? null;
  if (!planId || planId === 'starter') return null;
  return planId;
}
