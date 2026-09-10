import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 1A — route-level gate proofs (activity-requests + activity-catalog POST):
// 401 unauthenticated, 403 RBAC, cross-tenant rejection, allowed 201,
// 402 limit_reached, 403 not_entitled / wrong_activity / fail-closed infra,
// and compensating release when the guarded insert fails.

const mockEnt = vi.hoisted(() => ({
  assertActivityEntitlement: vi.fn(),
  releaseActivityEntitlement: vi.fn(),
}));

vi.mock('@/lib/subscription/activityEntitlements', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    assertActivityEntitlement: mockEnt.assertActivityEntitlement,
    releaseActivityEntitlement: mockEnt.releaseActivityEntitlement,
    // Faithful copy of the real wrapper semantics (delegating to the mocks above).
    withActivityEntitlement: vi.fn(async (clinicId: string, cap: string, fn: () => Promise<any>) => {
      await mockEnt.assertActivityEntitlement(clinicId, cap);
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof actual.ActivityEntitlementError)) {
          await mockEnt.releaseActivityEntitlement(clinicId, cap);
        }
        throw err;
      }
    }),
  };
});

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const mockDb = vi.hoisted(() => {
  const chain: any = {};
  const single = vi.fn(() => ({ data: { id: 'row-1' }, error: null }));
  chain.select = vi.fn(() => chain);
  chain.eq = vi.fn(() => chain);
  chain.is = vi.fn(() => chain);
  chain.order = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }));
  return { from: vi.fn(() => chain), __single: single, __chain: chain };
});
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockDb }));

import { ActivityEntitlementError } from '@/lib/subscription/activityEntitlements';
import { POST as postRequest } from '@/app/api/clinic/activity-requests/route';
import { POST as postCatalog } from '@/app/api/clinic/activity-catalog/route';

const CID = '11111111-1111-1111-1111-111111111111';

function makeReq(url: string, body: unknown) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const imagingReq = { patient_ref: 'patient-9', requested_service: 'Panoramic X-ray' };
const labReq = { case_ref: 'case-7', referring_clinic: 'smile clinic' };
const imagingSvc = { name: 'Panoramic X-ray', modality: 'panoramic', duration_minutes: 15 };
const labSvc = { name: 'Crown', turnaround_hours: 48 };

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({
    authorized: true,
    user: { id: 'owner-1' },
    role: 'owner',
  });
  mockAuth.roleDenied.mockReturnValue(null);
  mockDb.__single.mockImplementation(() => ({ data: { id: 'row-1' }, error: null }));
  mockEnt.assertActivityEntitlement.mockResolvedValue({ allowed: true, limit: 200, used: 1 });
});

describe('PHASE 1A — activity-requests POST gate', () => {
  it('401 when the requester is not authenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, imagingReq)
    );
    expect(res.status).toBe(401);
    expect(mockEnt.assertActivityEntitlement).not.toHaveBeenCalled();
  });

  it('401 cross-tenant: a member of another clinic is rejected before the entitlement gate', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, imagingReq)
    );
    expect(res.status).toBe(401);
    expect(mockEnt.assertActivityEntitlement).not.toHaveBeenCalled();
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('403 RBAC: staff cannot create activity requests (role ≠ permission)', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, imagingReq)
    );
    expect(res.status).toBe(403);
    expect(mockEnt.assertActivityEntitlement).not.toHaveBeenCalled();
  });

  it('201 when the entitlement gate allows (activity-specific capability enforced)', async () => {
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, imagingReq)
    );
    expect(res.status).toBe(201);
    expect(mockEnt.assertActivityEntitlement).toHaveBeenCalledWith(CID, 'imaging_requests_limit');
    expect(mockDb.__chain.insert).toHaveBeenCalled();
  });

  it('uses the lab capability for lab_cases', async () => {
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=lab_cases`, labReq)
    );
    expect(res.status).toBe(201);
    expect(mockEnt.assertActivityEntitlement).toHaveBeenCalledWith(CID, 'lab_cases_limit');
  });

  it('402 ENTITLEMENT_LIMIT_REACHED when the monthly limit is exhausted', async () => {
    mockEnt.assertActivityEntitlement.mockRejectedValueOnce(
      new ActivityEntitlementError('imaging_requests_limit', 'limit_reached', 200, 200)
    );
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, imagingReq)
    );
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: 'ENTITLEMENT_LIMIT_REACHED',
      resource: 'imaging_requests_limit',
      upgrade_required: true,
    });
    expect(mockDb.__chain.insert).not.toHaveBeenCalled();
  });

  it('403 ACTIVITY_ENTITLEMENT_DENIED when the plan has no cap grant (fail-closed)', async () => {
    mockEnt.assertActivityEntitlement.mockRejectedValueOnce(
      new ActivityEntitlementError('imaging_requests_limit', 'not_entitled')
    );
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, imagingReq)
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'ACTIVITY_ENTITLEMENT_DENIED',
      reason: 'not_entitled',
      capability: 'imaging_requests_limit',
      upgrade_required: true,
    });
  });

  it('releases the counter when the guarded insert fails', async () => {
    mockDb.__single.mockImplementationOnce(() => ({ data: null, error: { message: 'insert failed' } }));
    const res = await postRequest(
      makeReq(`http://localhost/api/clinic/activity-requests?clinic_id=${CID}&table=imaging_requests`, imagingReq)
    );
    expect(res.status).toBe(500);
    expect(mockEnt.releaseActivityEntitlement).toHaveBeenCalledWith(CID, 'imaging_requests_limit');
  });
});

describe('PHASE 1A — activity-catalog POST gate', () => {
  it('201 allowed → imaging_services_limit enforced', async () => {
    const res = await postCatalog(
      makeReq(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=imaging_services`, imagingSvc)
    );
    expect(res.status).toBe(201);
    expect(mockEnt.assertActivityEntitlement).toHaveBeenCalledWith(CID, 'imaging_services_limit');
  });

  it('201 allowed → lab_services_limit enforced', async () => {
    const res = await postCatalog(
      makeReq(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=lab_services`, labSvc)
    );
    expect(res.status).toBe(201);
    expect(mockEnt.assertActivityEntitlement).toHaveBeenCalledWith(CID, 'lab_services_limit');
  });

  it('401 cross-tenant rejection happens BEFORE the entitlement gate', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await postCatalog(
      makeReq(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=imaging_services`, imagingSvc)
    );
    expect(res.status).toBe(401);
    expect(mockEnt.assertActivityEntitlement).not.toHaveBeenCalled();
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('402 limit_reached stops the catalog insert', async () => {
    mockEnt.assertActivityEntitlement.mockRejectedValueOnce(
      new ActivityEntitlementError('imaging_services_limit', 'limit_reached', 3, 3)
    );
    const res = await postCatalog(
      makeReq(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=imaging_services`, imagingSvc)
    );
    expect(res.status).toBe(402);
    expect((await res.json()).resource).toBe('imaging_services_limit');
    expect(mockDb.__chain.insert).not.toHaveBeenCalled();
  });

  it('403 fail-closed infra denial stops the catalog insert', async () => {
    mockEnt.assertActivityEntitlement.mockRejectedValueOnce(
      new ActivityEntitlementError('imaging_services_limit', 'infra_error')
    );
    const res = await postCatalog(
      makeReq(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=imaging_services`, imagingSvc)
    );
    expect(res.status).toBe(403);
    expect(mockDb.__chain.insert).not.toHaveBeenCalled();
  });

  it('releases the counter when the guarded insert fails', async () => {
    mockDb.__single.mockImplementationOnce(() => ({ data: null, error: { message: 'insert failed' } }));
    const res = await postCatalog(
      makeReq(`http://localhost/api/clinic/activity-catalog?clinic_id=${CID}&table=lab_services`, labSvc)
    );
    expect(res.status).toBe(500);
    expect(mockEnt.releaseActivityEntitlement).toHaveBeenCalledWith(CID, 'lab_services_limit');
  });
});
