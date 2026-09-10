import { describe, it, expect } from 'vitest';

import { resolvePendingSelectedPlan } from '@/lib/subscription/pendingPlan';

// STEP 15G-C — selected plan awaiting payment vs effective plan.
// The subscription row keeps the CHOSEN plan_id while status=unpaid; entitlements
// correctly stay degraded at starter until the Stripe webhook flips status to
// active. resolvePendingSelectedPlan exposes the chosen plan for UI display
// WITHOUT ever granting it effectiveness.

describe('15G-C — resolvePendingSelectedPlan', () => {
  it('pro + unpaid → Professional is pending payment', () => {
    expect(resolvePendingSelectedPlan({ plan_id: 'pro', status: 'unpaid' })).toBe('pro');
  });

  it('founding + unpaid → Founding is pending payment', () => {
    expect(resolvePendingSelectedPlan({ plan_id: 'founding', status: 'unpaid' })).toBe('founding');
  });

  it('starter + unpaid → nothing pending (starter needs no checkout)', () => {
    expect(resolvePendingSelectedPlan({ plan_id: 'starter', status: 'unpaid' })).toBeNull();
  });

  it('pro + active → nothing pending (plan already effective)', () => {
    expect(resolvePendingSelectedPlan({ plan_id: 'pro', status: 'active' })).toBeNull();
  });

  it('other statuses (trialing/canceled) are never "pending payment"', () => {
    expect(resolvePendingSelectedPlan({ plan_id: 'pro', status: 'trialing' })).toBeNull();
    expect(resolvePendingSelectedPlan({ plan_id: 'pro', status: 'canceled' })).toBeNull();
  });

  it('null/empty subscription or plan → null', () => {
    expect(resolvePendingSelectedPlan(null)).toBeNull();
    expect(resolvePendingSelectedPlan({ plan_id: null, status: 'unpaid' })).toBeNull();
    expect(resolvePendingSelectedPlan({ plan_id: undefined, status: 'unpaid' })).toBeNull();
  });
});


// STEP 15G-B — Upgrade CTA helpers: href building, no-upgrade for unlimited
// resources, and 402 ENTITLEMENT_LIMIT_REACHED parsing (admin shape).

import {
  UPGRADE_SUGGESTIONS,
  buildUpgradeHref,
  parseEntitlementError,
  suggestedPlanFor,
} from '@/lib/subscription/upgradeCta';

describe('15G-B — buildUpgradeHref', () => {
  it('builds /dashboard/subscription?upgrade=1&resource=...&plan=... from the suggestion', () => {
    expect(buildUpgradeHref('ai_messages')).toBe('/dashboard/subscription?upgrade=1&resource=ai_messages&plan=growth');
    expect(buildUpgradeHref('users')).toBe('/dashboard/subscription?upgrade=1&resource=users&plan=growth');
    expect(buildUpgradeHref('patients')).toBe('/dashboard/subscription?upgrade=1&resource=patients&plan=starter');
  });

  it('honours an explicit plan (contextual CTA) over the suggestion', () => {
    expect(buildUpgradeHref('ai_messages', 'pro')).toBe('/dashboard/subscription?upgrade=1&resource=ai_messages&plan=pro');
  });

  it('is tenant-scoped when a clinicSlug is provided (tenant routing)', () => {
    expect(buildUpgradeHref('ai_messages', null, 'amal-clinic'))
      .toBe('/dashboard/amal-clinic/subscription?upgrade=1&resource=ai_messages&plan=growth');
    expect(buildUpgradeHref('users', 'pro', 'amal-clinic'))
      .toBe('/dashboard/amal-clinic/subscription?upgrade=1&resource=users&plan=pro');
    // null slug keeps the legacy flat fallback (transition compatibility only).
    expect(buildUpgradeHref('patients', null, null))
      .toBe('/dashboard/subscription?upgrade=1&resource=patients&plan=starter');
    // The slug is URL-encoded — never injects raw path segments.
    expect(buildUpgradeHref('ai_messages', null, '../admin'))
      .toBe('/dashboard/..%2Fadmin/subscription?upgrade=1&resource=ai_messages&plan=growth');
  });

  it('returns null for a resource that is unlimited everywhere (conversations)', () => {
    expect(buildUpgradeHref('conversations')).toBeNull();
    expect(buildUpgradeHref('conversations', null, 'amal-clinic')).toBeNull();
  });

  it('suggestedPlanFor is null only for unlimited resources', () => {
    expect(suggestedPlanFor('conversations')).toBeNull();
    expect(suggestedPlanFor('bookings')).toBe('growth');
    // Every key in the map is one of the seven canonical resources.
    expect(Object.keys(UPGRADE_SUGGESTIONS).sort()).toEqual([
      'ai_messages', 'bookings', 'conversations', 'knowledge_docs', 'patients', 'providers', 'users',
    ]);
  });
});

describe('15G-B — parseEntitlementError', () => {
  it('parses the unified admin 402 shape', () => {
    expect(parseEntitlementError({ error: 'ENTITLEMENT_LIMIT_REACHED', resource: 'users', upgrade_required: true }))
      .toEqual({ resource: 'users' });
    expect(parseEntitlementError({ error: 'ENTITLEMENT_LIMIT_REACHED', resource: 'providers' }))
      .toEqual({ resource: 'providers' });
  });

  it('returns null for unknown resources or non-entitlement bodies', () => {
    expect(parseEntitlementError({ error: 'ENTITLEMENT_LIMIT_REACHED', resource: 'nope' })).toBeNull();
    expect(parseEntitlementError({ error: 'PAYMENT_NOT_CONFIGURED' })).toBeNull();
    expect(parseEntitlementError(null)).toBeNull();
    expect(parseEntitlementError('text')).toBeNull();
    // The public patient-safe 402 shape has no machine `resource` → not an upgrade CTA.
    expect(parseEntitlementError({ error: 'عذراً...', upgrade_required: true })).toBeNull();
  });
});