import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 1B — workflowService enforcement tests (fail-closed pipeline):
// activity ownership, tenant-scoped current-state load, machine validation,
// atomic rpc application, conflict handling, audit-always-written rule.

const state = vi.hoisted(() => ({
  clinic: { data: { activity_type: 'imaging_center' }, error: null } as any,
  entity: { data: { id: 'e-1', status: 'requested' }, error: null } as any,
  rpcResult: { data: { ok: true, status: 'scheduled' }, error: null } as any,
}));

const mockDb = vi.hoisted(() => {
  function chain() {
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.is = vi.fn(() => c);
    c.order = vi.fn(() => c);
    c.limit = vi.fn(() => c);
    c.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    return c;
  }
  const clinics = chain();
  const entity = chain();
  const rpc = vi.fn(async () => state.rpcResult);
  return {
    from: vi.fn((t: string) => (t === 'clinics' ? clinics : entity)),
    rpc,
    __clinics: clinics,
    __entity: entity,
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  applyWorkflowTransition,
  WorkflowTransitionError,
  workflowErrorResponse,
} from '@/lib/services/workflowService';

const CID = '11111111-1111-1111-1111-111111111111';
const EID = 'aaaaaaaa-1111-1111-1111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  state.clinic = { data: { activity_type: 'imaging_center' }, error: null };
  state.entity = { data: { id: EID, status: 'requested' }, error: null };
  state.rpcResult = { data: { ok: true, status: 'scheduled' }, error: null };
  mockDb.__clinics.maybeSingle.mockImplementation(() => Promise.resolve(state.clinic));
  mockDb.__entity.maybeSingle.mockImplementation(() => Promise.resolve(state.entity));
});

describe('PHASE 1B — applyWorkflowTransition (allowed path)', () => {
  it('applies a valid transition through the atomic rpc with actor + audit params', async () => {
    const r = await applyWorkflowTransition({
      clinicId: CID,
      entityType: 'imaging_requests',
      entityId: EID,
      toStatus: 'scheduled',
      actorUserId: 'user-1',
      actorRole: 'owner',
      reason: 'patient confirmed',
    });
    expect(r).toEqual({ ok: true, entityType: 'imaging_requests', entityId: EID, fromStatus: 'requested', toStatus: 'scheduled' });
    expect(mockDb.rpc).toHaveBeenCalledWith('apply_workflow_transition', {
      p_clinic_id: CID,
      p_entity_type: 'imaging_requests',
      p_entity_id: EID,
      p_from_status: 'requested',
      p_to_status: 'scheduled',
      p_actor_clinic_user_id: 'user-1',
      p_actor_role: 'owner',
      p_reason: 'patient confirmed',
    });
  });

  it('cancellation edges reach the rpc from any non-terminal state', async () => {
    state.entity = { data: { id: EID, status: 'in_progress' }, error: null };
    const r = await applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'cancelled' });
    expect(r.fromStatus).toBe('in_progress');
    expect(r.toStatus).toBe('cancelled');
  });

  it('reads the current state tenant-scoped (clinic_id + soft-delete guards)', async () => {
    await applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' });
    const eqCalls = mockDb.__entity.eq.mock.calls.map((c: any[]) => c[0]);
    expect(eqCalls).toContain('clinic_id');
    expect(mockDb.__entity.is).toHaveBeenCalledWith('deleted_at', null);
  });
});

describe('PHASE 1B — fail-closed denials', () => {
  it('rejects a clinic tenant running an imaging workflow (wrong_activity)', async () => {
    state.clinic = { data: { activity_type: 'clinic' }, error: null };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' })
    ).rejects.toMatchObject({ reason: 'wrong_activity' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('rejects an imaging tenant running the lab workflow (wrong_activity)', async () => {
    state.clinic = { data: { activity_type: 'imaging_center' }, error: null };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'lab_cases', entityId: EID, toStatus: 'in_production' })
    ).rejects.toMatchObject({ reason: 'wrong_activity' });
  });

  it('denies when the clinic row is unreadable (clinic_unresolvable)', async () => {
    state.clinic = { data: null, error: { message: 'db down' } };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' })
    ).rejects.toMatchObject({ reason: 'clinic_unresolvable' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('denies an unknown entity type (no machine — fail-closed, nothing invented)', async () => {
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'patients' as any, entityId: EID, toStatus: 'archived' })
    ).rejects.toMatchObject({ reason: 'unknown_entity' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('denies an unknown destination state', async () => {
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'not-a-real-state' })
    ).rejects.toMatchObject({ reason: 'unknown_state' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });
});

describe('PHASE 1B — more fail-closed denials', () => {
  it('404 — entity not found in this tenant (cross-tenant-safe, no rpc)', async () => {
    state.entity = { data: null, error: null };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' })
    ).rejects.toMatchObject({ reason: 'entity_not_found' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('rejects terminal-state transitions', async () => {
    state.entity = { data: { id: EID, status: 'delivered' }, error: null };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'ready' })
    ).rejects.toMatchObject({ reason: 'terminal_state' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('rejects skip/backward transitions', async () => {
    state.entity = { data: { id: EID, status: 'requested' }, error: null };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'delivered' })
    ).rejects.toMatchObject({ reason: 'invalid_transition' });
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('maps rpc rejection to transition_conflict (concurrent transition won)', async () => {
    state.rpcResult = { data: { ok: false, reason: 'transition_conflict' }, error: null };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' })
    ).rejects.toBeInstanceOf(WorkflowTransitionError);
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' })
    ).rejects.toMatchObject({ reason: 'transition_conflict' });
  });

  it('fail-closed on rpc infrastructure error — NO transition without audit', async () => {
    state.rpcResult = { data: null, error: { message: 'rpc missing' } };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' })
    ).rejects.toMatchObject({ reason: 'infra_error' });
  });

  it('fail-closed on entity read error', async () => {
    state.entity = { data: null, error: { message: 'db down' } };
    await expect(
      applyWorkflowTransition({ clinicId: CID, entityType: 'imaging_requests', entityId: EID, toStatus: 'scheduled' })
    ).rejects.toMatchObject({ reason: 'infra_error' });
  });
});

describe('PHASE 1B — HTTP mapping', () => {
  it('entity_not_found → 404, transition_conflict → 409, validation denials → 400', async () => {
    const notFound = workflowErrorResponse(new WorkflowTransitionError('entity_not_found', 'imaging_requests'))!;
    expect(notFound.status).toBe(404);
    const conflict = workflowErrorResponse(new WorkflowTransitionError('transition_conflict', 'imaging_requests'))!;
    expect(conflict.status).toBe(409);
    for (const reason of ['invalid_transition', 'terminal_state', 'unknown_state', 'unknown_entity', 'wrong_activity', 'clinic_unresolvable'] as const) {
      const res = workflowErrorResponse(new WorkflowTransitionError(reason, 'imaging_requests'))!;
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('WORKFLOW_TRANSITION_INVALID');
      expect(body.reason).toBe(reason);
    }
  });

  it('returns null for unrelated errors', () => {
    expect(workflowErrorResponse(new Error('x'))).toBeNull();
  });
});

