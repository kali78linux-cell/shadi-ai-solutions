import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * PP-7 — Growth / Retention & Engagement API route tests (RBAC + shape).
 * Separate file from the service tests so the service module can be mocked
 * here without shadowing the real implementation used there.
 */

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn((auth: any, _roles: readonly string[]) =>
    auth && auth.authorized === false ? { status: auth.status ?? 403 } : null),
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockGI = vi.hoisted(() => ({ getGrowthIntelligence: vi.fn() }));
vi.mock('@/lib/services/growthIntelligence', () => mockGI);

import { GET } from '@/app/api/clinic/growth-intelligence/route';

const req = (clinicId = 'c1') =>
  new Request(`http://localhost/api/clinic/growth-intelligence?clinic_id=${clinicId}`);

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true });
});

describe('PP-7 API route — RBAC and shape', () => {
  it('400 when clinic_id missing', async () => {
    const res = await GET(new Request('http://localhost/api/clinic/growth-intelligence'));
    expect(res.status).toBe(400);
    expect(mockAuth.authorizeClinicRequest).not.toHaveBeenCalled();
  });

  it('401 for unauthenticated callers (no data exposure)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGI.getGrowthIntelligence).not.toHaveBeenCalled();
  });

  it('403 for unauthorized actors — enforced against DATA_ROLES', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(mockGI.getGrowthIntelligence).not.toHaveBeenCalled();
    expect(mockAuth.roleDenied).toHaveBeenCalledWith(expect.anything(), mockAuth.DATA_ROLES);
  });

  it('200 with derived data for an authorized member; clinic_id passed through untouched', async () => {
    mockGI.getGrowthIntelligence.mockResolvedValue({ retention: { totalPatients: 1 } });
    const res = await GET(req('c1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.retention.totalPatients).toBe(1);
    expect(mockGI.getGrowthIntelligence).toHaveBeenCalledWith('c1', { fromDate: undefined, toDate: undefined });
  });

  it('forwards from_date/to_date query params', async () => {
    mockGI.getGrowthIntelligence.mockResolvedValue({});
    await GET(new Request('http://localhost/api/clinic/growth-intelligence?clinic_id=c1&from_date=2026-06-01&to_date=2026-08-31'));
    expect(mockGI.getGrowthIntelligence).toHaveBeenCalledWith('c1', { fromDate: '2026-06-01', toDate: '2026-08-31' });
  });

  it('400 on INVALID_ date errors, 500 otherwise (no stack leakage)', async () => {
    mockGI.getGrowthIntelligence.mockRejectedValue(new Error('INVALID_FROM_DATE'));
    expect((await GET(req())).status).toBe(400);
    mockGI.getGrowthIntelligence.mockRejectedValue(new Error('boom'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('boom');
  });
});
