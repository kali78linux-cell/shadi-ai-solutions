import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PP-8A — Public Visibility API route tests (RBAC + deny-by-default shape).
 * Mocks the service module; the real service is covered in
 * provider-visibility.test.ts.
 */

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

const mockAudit = vi.hoisted(() => ({ writeAuditLog: vi.fn(async () => undefined) }));
vi.mock('@/lib/services/auditService', () => mockAudit);

const mockSvc = vi.hoisted(() => ({
  getPublicVisibilityState: vi.fn(),
  setClinicDiscoveryEnabled: vi.fn(),
  setProviderVisibility: vi.fn(),
  ensureProviderSlug: vi.fn(),
  updateProviderPublicProfile: vi.fn(),
  PROVIDER_VISIBILITY_VALUES: ['private', 'noindex', 'indexable'],
}));
vi.mock('@/lib/services/providerVisibility', () => mockSvc);

import { GET, PATCH } from '@/app/api/clinic/public-visibility/route';

const CID = '11111111-1111-1111-1111-111111111111';
const PID = '22222222-2222-2222-2222-222222222222';

const getReq = (clinicId = CID) =>
  new Request(`http://localhost/api/clinic/public-visibility?clinic_id=${clinicId}`);

const patchReq = (body: unknown, clinicId = CID) =>
  new Request(`http://localhost/api/clinic/public-visibility?clinic_id=${clinicId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'owner', user: { id: 'u1' } });
  mockSvc.getPublicVisibilityState.mockResolvedValue({
    clinic: { discovery_enabled: false },
    providers: [],
  });
});

describe('PP-8A API — GET visibility state', () => {
  it('400 when clinic_id missing (auth never called)', async () => {
    const res = await GET(new Request('http://localhost/api/clinic/public-visibility'));
    expect(res.status).toBe(400);
    expect(mockAuth.authorizeClinicRequest).not.toHaveBeenCalled();
  });

  it('401 for unauthenticated callers', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    expect((await GET(getReq())).status).toBe(401);
    expect(mockSvc.getPublicVisibilityState).not.toHaveBeenCalled();
  });

  it('200 for any clinic member (staff included — read-only)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'staff', user: { id: 'u2' } });
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.clinic.discovery_enabled).toBe(false);
    expect(mockSvc.getPublicVisibilityState).toHaveBeenCalledWith(CID);
  });

  it('404 when the clinic does not exist', async () => {
    mockSvc.getPublicVisibilityState.mockResolvedValue(null);
    expect((await GET(getReq())).status).toBe(404);
  });
});

describe('PP-8A API — PATCH (owner/manager only)', () => {
  it('401 for unauthenticated callers', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    expect((await PATCH(patchReq({ discovery_enabled: true }))).status).toBe(401);
    expect(mockSvc.setClinicDiscoveryEnabled).not.toHaveBeenCalled();
  });

  it('403 for staff — staff can never publish', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'staff', user: { id: 'u2' } });
    const res = await PATCH(patchReq({ discovery_enabled: true }));
    expect(res.status).toBe(403);
    expect(mockSvc.setClinicDiscoveryEnabled).not.toHaveBeenCalled();
  });

  it('403 for receptionist and doctor roles', async () => {
    for (const role of ['receptionist', 'doctor']) {
      mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role, user: { id: 'u2' } });
      expect((await PATCH(patchReq({ discovery_enabled: true }))).status).toBe(403);
    }
    expect(mockSvc.setClinicDiscoveryEnabled).not.toHaveBeenCalled();
  });

  it('200 for owner enabling discovery only (provider service untouched)', async () => {
    mockSvc.setClinicDiscoveryEnabled.mockResolvedValue(true);
    const res = await PATCH(patchReq({ discovery_enabled: true }));
    expect(res.status).toBe(200);
    expect(mockSvc.setClinicDiscoveryEnabled).toHaveBeenCalledWith(CID, true);
    expect(mockSvc.setProviderVisibility).not.toHaveBeenCalled();
    const body = await res.json();
    expect(body.data.clinic.discovery_enabled).toBe(true);
  });

  it('200 for manager updating one provider visibility', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'manager', user: { id: 'u3' } });
    mockSvc.setProviderVisibility.mockResolvedValue({
      id: PID,
      name: 'د. حلا',
      provider_type: 'dentist',
      public_visibility: 'noindex',
      deleted_at: null,
    });
    const res = await PATCH(patchReq({ provider_id: PID, visibility: 'noindex' }));
    expect(res.status).toBe(200);
    expect(mockSvc.setProviderVisibility).toHaveBeenCalledWith(CID, PID, 'noindex');
    expect(mockAudit.writeAuditLog).toHaveBeenCalled();
  });

  it('400 for an incomplete provider update (provider_id without visibility)', async () => {
    expect((await PATCH(patchReq({ provider_id: PID }))).status).toBe(400);
    expect((await PATCH(patchReq({ visibility: 'noindex' }))).status).toBe(400);
    expect((await PATCH(patchReq({}))).status).toBe(400);
    expect(mockSvc.setProviderVisibility).not.toHaveBeenCalled();
  });

  it('400 for an invalid visibility value', async () => {
    const res = await PATCH(patchReq({ provider_id: PID, visibility: 'public' }));
    expect(res.status).toBe(400);
    expect(mockSvc.setProviderVisibility).not.toHaveBeenCalled();
  });

  it('404 for an unknown/cross-tenant provider id (no existence leak)', async () => {
    mockSvc.setProviderVisibility.mockResolvedValue(null);
    expect((await PATCH(patchReq({ provider_id: PID, visibility: 'indexable' }))).status).toBe(404);
  });

  it('400 when a non-publishable provider is targeted (PROVIDER_NOT_PUBLISHABLE)', async () => {
    mockSvc.setProviderVisibility.mockRejectedValue(new Error('PROVIDER_NOT_PUBLISHABLE'));
    const res = await PATCH(patchReq({ provider_id: PID, visibility: 'indexable' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('This provider type cannot be publicly visible');
  });
});
