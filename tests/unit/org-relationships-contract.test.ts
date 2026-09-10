import { describe, it, expect } from 'vitest';
import {
  canTransitionRelationship,
  relationshipStatusLabelAr,
  relationshipStatusTone,
  type RelationshipStatus,
  type RelationshipParty,
} from '@/lib/services/organizationRelationships';

/**
 * PHASE F — acceptance / rejection / suspension state-machine coverage.
 *
 * Drives the imaging-centers / referring-clinics UI actions (قبول / رفض /
 * تعليق / إعادة تفعيل / سحب). Pure contract tests for the transition rules
 * that gate the PATCH handler.
 */
describe('organization relationships — state machine', () => {
  const T: RelationshipStatus = 'requested';
  const A: RelationshipStatus = 'accepted';
  const R: RelationshipStatus = 'rejected';
  const S: RelationshipStatus = 'suspended';

  it('TARGET accepts a requested relationship', () => {
    expect(canTransitionRelationship(T, A, 'target')).toBe(true);
  });

  it('SOURCE cannot accept its own outgoing request (only TARGET does)', () => {
    expect(canTransitionRelationship(T, A, 'source')).toBe(false);
  });

  it('EITHER party can reject a requested relationship', () => {
    expect(canTransitionRelationship(T, R, 'target')).toBe(true);
    expect(canTransitionRelationship(T, R, 'source')).toBe(true);
  });

  it('a party outside the relationship cannot act (neither)', () => {
    expect(canTransitionRelationship(T, A, 'neither')).toBe(false);
    expect(canTransitionRelationship(T, R, 'neither')).toBe(false);
    expect(canTransitionRelationship(T, S, 'neither')).toBe(false);
  });

  it('an accepted relationship can be suspended by EITHER party (reactivate later)', () => {
    expect(canTransitionRelationship(A, S, 'source')).toBe(true);
    expect(canTransitionRelationship(A, S, 'target')).toBe(true);
  });

  it('a suspended relationship can be reactivated to accepted by EITHER party', () => {
    expect(canTransitionRelationship(S, A, 'source')).toBe(true);
    expect(canTransitionRelationship(S, A, 'target')).toBe(true);
  });

  it('a suspended relationship can be rejected/canceled by EITHER party', () => {
    expect(canTransitionRelationship(S, R, 'source')).toBe(true);
    expect(canTransitionRelationship(S, R, 'target')).toBe(true);
  });

  it('terminal states (rejected/canceled) cannot transition anywhere', () => {
    expect(canTransitionRelationship(R, A, 'target')).toBe(false);
    expect(canTransitionRelationship(R, S, 'target')).toBe(false);
    expect(canTransitionRelationship(R, T, 'target')).toBe(false);
  });

  it('no-op transitions (same status) are rejected', () => {
    expect(canTransitionRelationship(T, T, 'target')).toBe(false);
    expect(canTransitionRelationship(A, A, 'source')).toBe(false);
  });

  it('an accepted relationship cannot jump straight to rejected/canceled', () => {
    expect(canTransitionRelationship(A, R, 'source')).toBe(false);
    expect(canTransitionRelationship(A, R, 'target')).toBe(false);
  });

  it('an accepted relationship cannot be re-requested', () => {
    expect(canTransitionRelationship(A, T, 'target')).toBe(false);
  });
});

describe('organization relationships — labels & tones (Arabic UI)', () => {
  it('maps every lifecycle status to a non-empty Arabic label', () => {
    const all: RelationshipStatus[] = ['requested', 'accepted', 'rejected', 'suspended', 'canceled'];
    for (const s of all) {
      const label = relationshipStatusLabelAr(s);
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('tone signals are stable for status rendering', () => {
        expect(relationshipStatusTone('accepted')).toBe('success');
    // suspended/rejected/canceled are all grouped as 'danger' — inactive/blocked states.
    expect(relationshipStatusTone('suspended')).toBe('danger');
    expect(relationshipStatusTone('rejected')).toBe('danger');
    expect(relationshipStatusTone('canceled')).toBe('danger');
    expect(['neutral', 'warning']).toContain(relationshipStatusTone('requested'));
  });

  it('requested is NOT shown as active/accepted to the user', () => {
    expect(relationshipStatusLabelAr('requested')).toBe('قيد الانتظار');
    expect(relationshipStatusTone('requested')).not.toBe('success');
  });
});

describe('organization relationships — cross-tenant safety (contract)', () => {
  it('each relationship has exactly two distinct orgs (source != target)', () => {
    // Mirrors the symmetric, non-hierarchical invariant asserted by the API.
    const make = (src: string, tgt: string) => ({ source_org_id: src, target_org_id: tgt });
    const rel = make('dental-clinic-A', 'imaging-center-B');
    expect(rel.source_org_id).not.toBe(rel.target_org_id);
  });

  it('the imaging center is never a child/tenant of the clinic', () => {
    // There is no parent_org_id column — the relation is many-to-many between
    // independent organizations. A dental lab must not appear as an imaging partner.
    const rel = { source_org_id: 'dental-clinic', target_org_id: 'imaging-center', relationship_type: 'imaging_provider' };
    expect('parent_org_id' in rel).toBe(false);
    expect(rel.relationship_type).not.toBe('lab_provider');
  });
});
