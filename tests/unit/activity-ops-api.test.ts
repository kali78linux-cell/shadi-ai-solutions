import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * DHS-OPS — activity admin API tests.
 * Covers the administrative layer added on top of the closed DHS foundation:
 *  - imaging/lab service catalog: POST/PUT/DELETE (owner/manager only)
 *  - imaging requests / lab cases: POST + PATCH(status) + DELETE
 *  - RBAC negative (staff/doctor/receptionist/unauthenticated → denied)
 *  - cross-tenant isolation (writes scoped by clinic_id from session)
 *  - invalid input / invalid status rejected
 */

const CID = '11111111-1111-1111-1111-111111111111';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(
    (auth: any, roles: readonly string[]) =>
      !auth.authorized ? { status: auth.status ?? 403 } : roles.includes(auth.role) ? null : { status: 403 }
  ),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockDb = vi.hoisted(() => {
  const makeChain = (resolver: () => unknown) => {
    const chain: any = {
      select: () => chain,
      insert: (v: unknown) => { chain._insert = v; return chain; },
      update: (v: unknown) => { chain._update = v; return chain; },
      eq: (col: string, val: unknown) => { (chain._eq ??= []).push([col, val]); return chain; },
      is: (col: string, val: unknown) => { (chain._is ??= []).push([col, val]); return chain; },
      single: () => Promise.resolve(resolver()),
      maybeSingle: () => Promise.resolve(resolver()),
      order: () => chain,
      limit: () => chain,
    };
    return chain;
  };
  return {
    from: vi.fn((_t: string) => { mockDb._lastChain = makeChain(() => ({ data: mockDb._row, error: null })); return mockDb._lastChain; }),
    _row: null as unknown,
    _lastChain: null as any,
  };
});
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mockDb,
}));

// PHASE 1A — the activity creation endpoints are now entitlement-gated; these
// DHS-OPS tests cover the RBAC/CRUD layer, so the activity gate is stubbed open.
vi.mock('@/lib/subscription/activityEntitlements', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    assertActivityEntitlement: vi.fn(async () => ({
      allowed: true,
      limit: null,
      used: 0,
      planId: 'growth',
      activityType: 'imaging_center',
    })),
    releaseActivityEntitlement: vi.fn(async () => undefined),
    withActivityEntitlement: vi.fn(async (_c: string, _cap: string, fn: () => Promise<unknown>) => fn()),
  };
});

// PHASE 1B — status PATCHes are workflow-directed; this suite covers the RBAC/
// CRUD layer, so applyWorkflowTransition is replaced by a shim that uses the
// REAL machine validation (mockDb._row.status → from) and skips the rpc.
vi.mock('@/lib/services/workflowService', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    applyWorkflowTransition: vi.fn(async (input: any) => {
      const { validateWorkflowTransition, getWorkflowMachine, WorkflowTransitionError } = actual;
      const machine = getWorkflowMachine(input.entityType);
      if (!machine) throw new WorkflowTransitionError('unknown_entity', null, null, input.toStatus);
      const rowStatus = typeof (mockDb._row as any)?.status === 'string' ? (mockDb._row as any).status : machine.initialState;
      const from = machine.transitions[rowStatus] ? rowStatus : machine.initialState;
      const failure = validateWorkflowTransition(input.entityType, from, input.toStatus);
      if (failure) throw new WorkflowTransitionError(failure, input.entityType, from, input.toStatus);
      return { ok: true, entityType: input.entityType, entityId: input.entityId, fromStatus: from, toStatus: input.toStatus };
    }),
  };
});

import { POST as CATALOG_POST } from '@/app/api/clinic/activity-catalog/route';
import { PUT as CATALOG_PUT, DELETE as CATALOG_DELETE } from '@/app/api/clinic/activity-catalog/[itemId]/route';
import { POST as REQ_POST } from '@/app/api/clinic/activity-requests/route';
import { PATCH as REQ_PATCH, DELETE as REQ_DELETE } from '@/app/api/clinic/activity-requests/[requestId]/route';

const ITEM_ID = '22222222-2222-2222-2222-222222222222';
const REQ_ID = '33333333-3333-3333-3333-333333333333';

function req(url: string, init?: RequestInit): Request {
  return new Request(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.from.mockClear();
  mockDb._row = { id: ITEM_ID, name: 'خدمة', active: true };
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'owner', user: { id: 'u1' } });
});
describe('DHS-OPS — catalog admin', () => {
  it('owner can create an imaging/lab catalog item (POST → 201)', async () => {
    mockDb._row = { id: ITEM_ID, name: 'أشعة بانوراما', active: true };
    const res = await CATALOG_POST(req(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=imaging_services`, {
      method: 'POST',
      body: JSON.stringify({ name: 'أشعة بانوراما', modality: 'panoramic', price: 85 }),
    }));
    expect(res.status).toBe(201);
    expect(mockDb.from).toHaveBeenCalledWith('imaging_services');
  });

  it('owner can update a catalog item (PUT → 200)', async () => {
    mockDb._row = { id: ITEM_ID, name: 'محدث', active: true };
    const res = await CATALOG_PUT(
      req(`http://localhost/api/clinic/activity-catalog/${ITEM_ID}?clinic_id=${CID}&table=lab_services`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'محدث', turnaround_hours: 48 }),
      }),
      { params: { itemId: ITEM_ID } }
    );
    expect(res.status).toBe(200);
    expect(mockDb.from).toHaveBeenCalledWith('lab_services');
  });

  it('owner can soft-delete a catalog item (DELETE → 200)', async () => {
    const res = await CATALOG_DELETE(
      req(`http://localhost/api/clinic/activity-catalog/${ITEM_ID}?clinic_id=${CID}&table=imaging_services`, { method: 'DELETE' }),
      { params: { itemId: ITEM_ID } }
    );
    expect(res.status).toBe(200);
  });

  it.each(['staff', 'receptionist', 'doctor'])('catalog POST/PUT/DELETE denied for %s (403)', async (role) => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'u1' } });
    expect((await CATALOG_POST(req(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=imaging_services`, { method: 'POST', body: '{}' }))).status).toBe(403);
    expect((await CATALOG_PUT(req(`http://localhost/api/clinic/activity-catalog/${ITEM_ID}?clinic_id=${CID}&table=imaging_services`, { method: 'PUT', body: '{}' }), { params: { itemId: ITEM_ID } })).status).toBe(403);
    expect((await CATALOG_DELETE(req(`http://localhost/api/clinic/activity-catalog/${ITEM_ID}?clinic_id=${CID}&table=imaging_services`, { method: 'DELETE' }), { params: { itemId: ITEM_ID } })).status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('unauthenticated catalog writes are rejected (401)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    expect((await CATALOG_POST(req(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=imaging_services`, { method: 'POST', body: '{}' }))).status).toBe(401);
  });

  it('invalid table is rejected before DB (400)', async () => {
    const res = await CATALOG_POST(req(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=not_a_table`, { method: 'POST', body: JSON.stringify({ name: 'x' }) }));
    expect(res.status).toBe(400);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});

describe('DHS-OPS — requests/cases admin', () => {
  it('owner can create an imaging request (POST → 201)', async () => {
    mockDb._row = { id: REQ_ID, status: 'requested' };
    const res = await REQ_POST(req(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, {
      method: 'POST',
      body: JSON.stringify({ patient_ref: 'P1', requested_service: 'أشعة بانوراما' }),
    }));
    expect(res.status).toBe(201);
    expect(mockDb.from).toHaveBeenCalledWith('imaging_requests');
  });

  it('owner can update request status (PATCH valid → 200)', async () => {
    mockDb._row = { id: REQ_ID, status: 'ready' };
    const res = await REQ_PATCH(
      req(`http://localhost/api/clinic/activity-requests/${REQ_ID}?clinic_id=${CID}&table=imaging_requests`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'delivered' }),
      }),
      { params: { requestId: REQ_ID } }
    );
    expect(res.status).toBe(200);
  });

  it('invalid status for the domain is rejected (400) without touching DB', async () => {
    const res = await REQ_PATCH(
      req(`http://localhost/api/clinic/activity-requests/${REQ_ID}?clinic_id=${CID}&table=lab_cases`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'not-a-real-status' }),
      }),
      { params: { requestId: REQ_ID } }
    );
    expect(res.status).toBe(400);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('owner can soft-delete an imaging request (DELETE → 200)', async () => {
    const res = await REQ_DELETE(
      req(`http://localhost/api/clinic/activity-requests/${REQ_ID}?clinic_id=${CID}&table=imaging_requests`, { method: 'DELETE' }),
      { params: { requestId: REQ_ID } }
    );
    expect(res.status).toBe(200);
  });

  it.each(['staff', 'receptionist', 'doctor'])('requests POST/PATCH/DELETE denied for %s (403)', async (role) => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'u1' } });
    expect((await REQ_POST(req(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, { method: 'POST', body: '{}' }))).status).toBe(403);
    expect((await REQ_PATCH(req(`http://localhost/api/clinic/activity-requests/${REQ_ID}?clinic_id=${CID}&table=imaging_requests`, { method: 'PATCH', body: '{}' }), { params: { requestId: REQ_ID } })).status).toBe(403);
    expect((await REQ_DELETE(req(`http://localhost/api/clinic/activity-requests/${REQ_ID}?clinic_id=${CID}&table=imaging_requests`, { method: 'DELETE' }), { params: { requestId: REQ_ID } })).status).toBe(403);
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});

describe('DHS-OPS — cross-tenant scoping', () => {
  it('catalog writes are scoped to the session clinic_id (eq clinic_id present)', async () => {
    await CATALOG_DELETE(
      req(`http://localhost/api/clinic/activity-catalog/${ITEM_ID}?clinic_id=${CID}&table=imaging_services`, { method: 'DELETE' }),
      { params: { itemId: ITEM_ID } }
    );
    expect(mockDb._lastChain).not.toBeNull();
    expect(mockDb._lastChain._eq).toContainEqual(['clinic_id', CID]);
  });

  it('request status updates are scoped to the session clinic_id (eq clinic_id present)', async () => {
    mockDb._row = { id: REQ_ID, status: 'quality_check' };
    await REQ_PATCH(
      req(`http://localhost/api/clinic/activity-requests/${REQ_ID}?clinic_id=${CID}&table=lab_cases`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'ready' }),
      }),
      { params: { requestId: REQ_ID } }
    );
    expect(mockDb._lastChain).not.toBeNull();
    expect(mockDb._lastChain._eq).toContainEqual(['clinic_id', CID]);
  });
});
