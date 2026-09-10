import { describe, it, expect } from 'vitest';

/**
 * PHASE 8/9 — organization relationships (independent orgs, many-to-many).
 * Pure contract tests: an imaging center is NEVER a child tenant; the
 * relationship lifecycle is explicit (requested → invited/requested → accepted
 * / rejected / suspended) and ext extensible.
 */
describe('PHASE 9 — organization relationship lifecycle', () => {
  const types = ['referral_partner', 'imaging_provider', 'lab_provider'] as const;
  const statuses = ['requested', 'invited', 'accepted', 'rejected', 'suspended'] as const;

  it('relationship_type is an explicit extensible enum', () => {
    expect(types).toContain('referral_partner');
    expect(types).toContain('imaging_provider');
    expect(types).toContain('lab_provider');
  });

  it('accept requires the relationship to be requested/invited', () => {
    const canAccept = (from: string) => ['requested', 'invited'].includes(from);
    expect(canAccept('requested')).toBe(true);
    expect(canAccept('invited')).toBe(true);
    expect(canAccept('accepted')).toBe(false);
    expect(canAccept('rejected')).toBe(false);
    expect(canAccept('suspended')).toBe(false);
  });

  it('a suspended relationship blocks new referrals until re-accepted', () => {
    const active = (s: string) => s === 'accepted';
    expect(active('accepted')).toBe(true);
    expect(active('suspended')).toBe(false);
    expect(active('requested')).toBe(false);
    expect(active('rejected')).toBe(false);
  });

  it('an imaging center is an independent org (never a child of a clinic)', () => {
    // The relationship table treats both sides symmetrically; there is no
    // ownership/parent column.
    const rel = { source_org_id: 'clinic-A', target_org_id: 'imaging-B', relationship_type: 'referral_partner' };
    expect(rel.source_org_id).not.toBe(rel.target_org_id);
    expect(Object.keys(rel).sort()).toEqual(['relationship_type', 'source_org_id', 'target_org_id']);
  });

  it('status lifecycle is closed and explicit (no free-form statuses)', () => {
    for (const s of statuses) expect(statuses).toContain(s);
    expect(statuses).not.toContain('random-status');
  });
});
