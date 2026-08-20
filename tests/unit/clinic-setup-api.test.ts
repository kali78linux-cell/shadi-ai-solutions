import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn() }));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockSupabaseServer = vi.hoisted(() => {
  const q: Record<string, any> = {
    from: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), order: vi.fn(), single: vi.fn(), upsert: vi.fn(), delete: vi.fn(), in: vi.fn(), is: vi.fn(),
  };
  return { createSupabaseServerClient: () => q };
});
vi.mock('@/lib/supabase/server', () => mockSupabaseServer);

import { GET as getProfile, PUT as putProfile } from '@/app/api/clinic/profile/route';
import { GET as getSetupStatus } from '@/app/api/clinic/setup-status/route';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const PROVIDER = '33333333-3333-3333-3333-333333333333';
const SERVICE = '44444444-4444-4444-4444-444444444444';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}
function jsonBody(data: unknown): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

function resetChain() {
  const q = mockSupabaseServer.createSupabaseServerClient();
  q.from.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.order.mockResolvedValue({ data: [], error: null });
  q.single.mockResolvedValue({ data: { id: CLINIC_A, name: 'Test Clinic', phone: '123', address: 'Addr', website: null, slug: 'test', created_at: '2026-01-01', updated_at: '2026-01-01' }, error: null });
  q.upsert.mockResolvedValue({ error: null });
  q.delete.mockReturnValue(q);
  q.insert.mockResolvedValue({ error: null });
  q.in.mockResolvedValue({ data: [], error: null });
  q.is.mockResolvedValue({ data: [], error: null });
  q.update.mockReturnValue(q);
}

describe('Clinic Profile API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('gets clinic profile for an authorized member', async () => {
    const res = await getProfile(makeRequest(`http://localhost/api/clinic/profile?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.name).toBe('Test Clinic');
  });

  it('returns 403 for cross-clinic access', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await getProfile(makeRequest(`http://localhost/api/clinic/profile?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
  });

  it('returns 401 for unauthenticated access', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await getProfile(makeRequest(`http://localhost/api/clinic/profile?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(401);
  });

  it('returns 400 for missing clinic_id', async () => {
    const res = await getProfile(makeRequest('http://localhost/api/clinic/profile'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when clinic not found', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    q.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await getProfile(makeRequest(`http://localhost/api/clinic/profile?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(404);
  });

  it('updates clinic profile for an authorized member', async () => {
    const res = await putProfile(makeRequest(`http://localhost/api/clinic/profile?clinic_id=${CLINIC_A}`, jsonBody({
      name: 'Updated Clinic',
      phone: '555-1234',
      address: '123 Main St',
      website: 'https://example.com',
    })));
    expect(res.status).toBe(200);
    expect(res.json).toBeDefined();
  });

  it('rejects invalid profile payload', async () => {
    const res = await putProfile(makeRequest(`http://localhost/api/clinic/profile?clinic_id=${CLINIC_A}`, jsonBody({
      name: '',
    })));
    expect(res.status).toBe(400);
  });

  it('rejects cross-clinic profile update', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await putProfile(makeRequest(`http://localhost/api/clinic/profile?clinic_id=${CLINIC_B}`, jsonBody({
      name: 'Hacked',
    })));
    expect(res.status).toBe(403);
  });
});

describe('Clinic Setup Status API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('returns incomplete when no providers/services exist', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    // Clinic exists
    q.single.mockResolvedValue({ data: { id: CLINIC_A, name: 'Test', phone: '123', address: 'Addr', website: null }, error: null });
    // Make eq chainable, is is the terminal for providers and services queries
    q.eq.mockReturnValue(q);
    q.is.mockResolvedValue({ data: [], error: null });

    const res = await getSetupStatus(makeRequest(`http://localhost/api/clinic/setup-status?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('incomplete');
    expect(body.data.ready).toBe(false);
    expect(body.data.missing.length).toBeGreaterThan(0);
  });

  it('returns ready when all requirements are satisfied', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    // Clinic exists with full profile
    q.single.mockResolvedValue({ data: { id: CLINIC_A, name: 'Test', phone: '123', address: 'Addr', website: null }, error: null });
    // Providers exist
    q.is.mockResolvedValue({ data: [{ id: PROVIDER }], error: null });
    // Services exist
    q.eq.mockResolvedValue({ data: [{ id: SERVICE }], error: null });
    // Schedules exist (enabled)
    q.in.mockResolvedValue({ data: [{ provider_id: PROVIDER }], error: null });
    // Assignments exist and valid
    q.from.mockReturnValue(q);
    q.select.mockReturnValue(q);
    q.eq.mockReturnValue(q);
    q.in.mockResolvedValue({ data: [{ provider_id: PROVIDER, service_id: SERVICE }], error: null });

    const res = await getSetupStatus(makeRequest(`http://localhost/api/clinic/setup-status?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('ready');
    expect(body.data.ready).toBe(true);
  });

  it('returns 403 for cross-clinic access', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await getSetupStatus(makeRequest(`http://localhost/api/clinic/setup-status?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing clinic_id', async () => {
    const res = await getSetupStatus(makeRequest('http://localhost/api/clinic/setup-status'));
    expect(res.status).toBe(400);
  });

  it('returns 404 when clinic not found', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    q.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await getSetupStatus(makeRequest(`http://localhost/api/clinic/setup-status?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(404);
  });
});