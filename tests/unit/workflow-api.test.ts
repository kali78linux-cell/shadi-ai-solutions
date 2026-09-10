import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 1B — API-level workflow gate proofs (PATCH activity-requests/[requestId]):
// 401 unauthenticated · 403 RBAC · 200 valid transition (workflow-directed) ·
// 400 invalid/terminal transition · 404 not found · 409 concurrent conflict ·
// audit params forwarded · notes-only PATCH unchanged.

const state = vi.hoisted(() => ({
  clinic: { data: { activity_type: 'imaging_center' }, error: null } as any,
  entity: { data: { id: 'req-1', status: 'requested', requested_service: 'Panorama', notes: null }, error: null } as any,
  rpcResult: { data: { ok: true, status: 'scheduled' }, error: null } as any,
}));

const mockDb = vi.hoisted(() => {
  function chain() {
    const c: any = {};
    c.select = vi.fn(() => c);
    c.eq = vi.fn(() => c);
    c.is = vi.fn(() => c);
    c.limit = vi.fn(() => c);
    c.update = vi.fn(() => c);
    c.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
    return c;
  }
  const clinics = chain();
  const entity = chain();
  return {
    from: vi.fn((t: string) => (t === 'clinics' ? clinics : entity)),
    rpc: vi.fn(async () => state.rpcResult),
    __clinics: clinics,
    __entity: entity,
  };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

// REAL workflowService (no mock) — the API must drive the true pipeline.
import { PATCH } from '@/app/api/clinic/activity-requests/[requestId]/route';

const CID = '11111111-1111-1111-1111-111111111111';
const EID = 'aaaaaaaa-1111-1111-1111-111111111111';

function req(body: unknown, table = 'imaging_requests') {
  return new Request(`http://localhost/api/clinic/activity-requests/${EID}?clinic_id=${CID}&table=${table}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({
    authorized: true,
    user: { id: 'owner-1' },
    role: 'owner',
  });
  mockAuth.roleDenied.mockReturnValue(null);
  state.clinic = { data: { activity_type: 'imaging_center' }, error: null };
  state.entity = { data: { id: EID, status: 'requested', requested_service: 'Panorama', notes: null }, error: null };
  state.rpcResult = { data: { ok: true, status: 'scheduled' }, error: null };
  mockDb.__clinics.maybeSingle.mockImplementation(() => Promise.resolve(state.clinic));
  mockDb.__entity.maybeSingle.mockImplementation(() => Promise.resolve(state.entity));
});

describe('PHASE 1B — workflow PATCH gate', () => {
  it('401 unauthenticated (before any workflow work)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await PATCH(req({ status: 'scheduled' }), { params: { requestId: EID } });
    expect(res.status).toBe(401);
    expect(mockDb.rpc).not.toHaveBeenCalled();
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('403 RBAC — staff cannot transition (role ≠ permission, server-enforced)', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const res = await PATCH(req({ status: 'scheduled' }), { params: { requestId: EID } });
    expect(res.status).toBe(403);
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('200 valid transition — workflow-directed, audit params forwarded, transition echoed', async () => {
    const res = await PATCH(req({ status: 'scheduled', reason: 'patient confirmed' }), { params: { requestId: EID } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transition).toEqual({ from: 'requested', to: 'scheduled' });
    expect(mockDb.rpc).toHaveBeenCalledWith('apply_workflow_transition', expect.objectContaining({
      p_clinic_id: CID,
      p_entity_type: 'imaging_requests',
      p_from_status: 'requested',
      p_to_status: 'scheduled',
      p_actor_clinic_user_id: 'owner-1',
      p_actor_role: 'owner',
      p_reason: 'patient confirmed',
    }));
  });
});

describe('PHASE 1B — more workflow PATCH gates', () => {
  it('400 invalid transition (skip) — DB update never attempted', async () => {
    const res = await PATCH(req({ status: 'delivered' }), { params: { requestId: EID } });
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe('invalid_transition');
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('400 terminal state — delivered accepts nothing further', async () => {
    state.entity = { data: { id: EID, status: 'delivered', requested_service: 'Panorama', notes: null }, error: null };
    const res = await PATCH(req({ status: 'ready' }), { params: { requestId: EID } });
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe('terminal_state');
  });

  it('404 when the row does not exist in this tenant (cross-tenant-safe)', async () => {
    state.entity = { data: null, error: null };
    const res = await PATCH(req({ status: 'scheduled' }), { params: { requestId: EID } });
    expect(res.status).toBe(404);
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });

  it('409 on concurrent/conflicting transition (guarded update lost)', async () => {
    state.rpcResult = { data: { ok: false, reason: 'transition_conflict' }, error: null };
    const res = await PATCH(req({ status: 'scheduled' }), { params: { requestId: EID } });
    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe('transition_conflict');
  });

  it('400 wrong activity — a clinic tenant cannot run the imaging workflow', async () => {
    state.clinic = { data: { activity_type: 'clinic' }, error: null };
    const res = await PATCH(req({ status: 'scheduled' }), { params: { requestId: EID } });
    expect(res.status).toBe(400);
    expect((await res.json()).reason).toBe('wrong_activity');
  });

  it('notes-only PATCH stays a plain update (no workflow rpc)', async () => {
    const res = await PATCH(req({ notes: 'updated notes' }), { params: { requestId: EID } });
    expect(res.status).toBe(200);
    expect(mockDb.rpc).not.toHaveBeenCalled();
  });
});

