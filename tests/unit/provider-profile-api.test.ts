import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PP-8B-i — Public profile API extension tests (RBAC + slug/profile flows).
 * Service module is mocked; the real service is covered in provider-profile.test.ts.
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

import { PATCH } from '@/app/api/clinic/public-visibility/route';

const CID = '11111111-1111-1111-1111-111111111111';
const PID = '22222222-2222-2222-2222-222222222222';

const patchReq = (body: unknown, clinicId = CID) =>
  new Request(`http://localhost/api/clinic/public-visibility?clinic_id=${clinicId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PID,
    name: 'د. حلا',
    provider_type: 'dentist',
    public_visibility: 'private',
    public_slug: null,
    specialty: null,
    bio: null,
    photo_url: null,
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'owner', user: { id: 'u1' } });
  mockSvc.getPublicVisibilityState.mockResolvedValue({ clinic: { discovery_enabled: false }, providers: [] });
});

describe('PP-8B-i API — profile PATCH', () => {
  it('200 owner updates profile; slug generated once and returned', async () => {
    mockSvc.updateProviderPublicProfile.mockResolvedValue(profileRow({ specialty: 'تقويم' }));
    mockSvc.ensureProviderSlug.mockResolvedValue({ slug: 'dr-abc123def456' });
    const res = await PATCH(patchReq({
      provider_id: PID,
      profile: { specialty: 'تقويم', bio: null, photo_url: null },
    }));
    expect(res.status).toBe(200);
    expect(mockSvc.updateProviderPublicProfile).toHaveBeenCalledWith(CID, PID, {
      specialty: 'تقويم', bio: null, photo_url: null,
    });
    expect(mockSvc.ensureProviderSlug).toHaveBeenCalledWith(CID, PID);
    const body = await res.json();
    expect(body.data.provider.public_slug).toBe('dr-abc123def456');
    expect(body.data.provider.specialty).toBe('تقويم');
    expect(mockAudit.writeAuditLog).toHaveBeenCalled();
  });

  it('200 publishing via visibility also ensures the stable slug', async () => {
    mockSvc.setProviderVisibility.mockResolvedValue(profileRow({ public_visibility: 'noindex' }));
    mockSvc.ensureProviderSlug.mockResolvedValue({ slug: 'dr-abc123def456' });
    const res = await PATCH(patchReq({ provider_id: PID, visibility: 'noindex' }));
    expect(res.status).toBe(200);
    expect(mockSvc.ensureProviderSlug).toHaveBeenCalledWith(CID, PID);
  });

  it('private visibility does NOT generate a slug', async () => {
    mockSvc.setProviderVisibility.mockResolvedValue(profileRow());
    const res = await PATCH(patchReq({ provider_id: PID, visibility: 'private' }));
    expect(res.status).toBe(200);
    expect(mockSvc.ensureProviderSlug).not.toHaveBeenCalled();
  });

  it('403 staff cannot edit profiles', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'staff', user: { id: 'u2' } });
    expect((await PATCH(patchReq({ provider_id: PID, profile: { bio: 'x' } }))).status).toBe(403);
    expect(mockSvc.updateProviderPublicProfile).not.toHaveBeenCalled();
  });

  it('400 profile without provider_id', async () => {
    expect((await PATCH(patchReq({ profile: { bio: 'x' } }))).status).toBe(400);
    expect(mockSvc.updateProviderPublicProfile).not.toHaveBeenCalled();
  });

  it('400 invalid photo_url (must be http(s))', async () => {
    expect((await PATCH(patchReq({ provider_id: PID, profile: { photo_url: 'javascript:alert(1)' } }))).status).toBe(400);
    expect(mockSvc.updateProviderPublicProfile).not.toHaveBeenCalled();
  });

  it('404 unknown/cross-tenant provider on profile update', async () => {
    mockSvc.updateProviderPublicProfile.mockResolvedValue(null);
    expect((await PATCH(patchReq({ provider_id: PID, profile: { bio: 'x' } }))).status).toBe(404);
  });

  it('400 non-publishable provider (PROVIDER_NOT_PUBLISHABLE)', async () => {
    mockSvc.updateProviderPublicProfile.mockRejectedValue(new Error('PROVIDER_NOT_PUBLISHABLE'));
    const res = await PATCH(patchReq({ provider_id: PID, profile: { bio: 'x' } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('This provider type cannot be publicly visible');
  });

  it('401 unauthenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    expect((await PATCH(patchReq({ provider_id: PID, profile: { bio: 'x' } }))).status).toBe(401);
  });
});
