import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn() }));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockSupabaseServer = vi.hoisted(() => {
  const q: Record<string, any> = {
    from: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), order: vi.fn(), single: vi.fn(), upsert: vi.fn(), delete: vi.fn(), in: vi.fn(),
  };
  return { createSupabaseServerClient: () => q };
});
vi.mock('@/lib/supabase/server', () => mockSupabaseServer);

import { GET as getSchedule, PUT as putSchedule } from '@/app/api/clinic/providers/[providerId]/schedule/route';
import { GET as getAssignments, PUT as putAssignments } from '@/app/api/clinic/providers/[providerId]/services/route';

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
  q.single.mockResolvedValue({ data: { id: PROVIDER }, error: null });
  q.upsert.mockResolvedValue({ error: null });
    // Make delete chainable so tests can mock subsequent `eq` calls as the terminal step
    q.delete.mockReturnValue(q);
  q.insert.mockResolvedValue({ error: null });
  q.in.mockResolvedValue({ data: [{ id: SERVICE }], error: null });
}

describe('Provider Schedule API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('gets schedule for an authorized clinic member', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    q.order.mockResolvedValue({ data: [{ weekday: 1, enabled: true, start_time: '09:00', end_time: '17:00' }], error: null });
    const res = await getSchedule(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/schedule?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].weekday).toBe(1);
  });

  it('returns 403 for cross-clinic schedule access', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await getSchedule(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/schedule?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
  });

  it('returns 404 when provider is not in the clinic', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    q.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await getSchedule(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/schedule?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(404);
  });

  it('updates a valid schedule', async () => {
    const res = await putSchedule(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/schedule?clinic_id=${CLINIC_A}`, jsonBody({
      schedule: [{ weekday: 1, enabled: true, start_time: '09:00', end_time: '17:00' }],
    })));
    expect(res.status).toBe(200);
  });

  it('rejects invalid schedule (end before start)', async () => {
    const res = await putSchedule(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/schedule?clinic_id=${CLINIC_A}`, jsonBody({
      schedule: [{ weekday: 1, enabled: true, start_time: '17:00', end_time: '09:00' }],
    })));
    expect(res.status).toBe(400);
  });

  it('rejects invalid time format', async () => {
    const res = await putSchedule(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/schedule?clinic_id=${CLINIC_A}`, jsonBody({
      schedule: [{ weekday: 1, enabled: true, start_time: '25:00', end_time: '17:00' }],
    })));
    expect(res.status).toBe(400);
  });

  it('rejects cross-clinic schedule update', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await putSchedule(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/schedule?clinic_id=${CLINIC_B}`, jsonBody({
      schedule: [{ weekday: 1, enabled: true, start_time: '09:00', end_time: '17:00' }],
    })));
    expect(res.status).toBe(403);
  });
});

describe('Provider/Service Assignment API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('gets assignments for an authorized clinic member', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    // Sequence eq calls: provider single uses 2 eqs, provider_services uses 2 eqs — make first three chainable and the 4th resolve
    q.eq.mockImplementationOnce(() => q).mockImplementationOnce(() => q).mockImplementationOnce(() => q).mockResolvedValueOnce({ data: [{ service_id: SERVICE }], error: null });
    const res = await getAssignments(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/services?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([SERVICE]);
  });

  it('returns 403 for cross-clinic assignment access', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await getAssignments(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/services?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
  });

  it('saves assignments for services in the same clinic', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    // The terminal method for clinic_services query is `in`, mock it to return the clinic services
    q.in.mockResolvedValueOnce({ data: [{ id: SERVICE }], error: null });
    // Sequence eq calls: provider single (2 eqs) + clinic_services eq (1) + delete eq (1) -> make first 4 chainable then final resolve
    q.eq.mockImplementationOnce(() => q).mockImplementationOnce(() => q).mockImplementationOnce(() => q).mockImplementationOnce(() => q).mockResolvedValueOnce({ error: null });
    const res = await putAssignments(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/services?clinic_id=${CLINIC_A}`, jsonBody({ service_ids: [SERVICE] })));
    expect(res.status).toBe(200);
  });

  it('rejects assignment to a service from another clinic', async () => {
    const q = mockSupabaseServer.createSupabaseServerClient();
    // Sequence eq calls: provider single (2 eqs) + clinic_services eq (1) -> make them chainable, and have `in` return no services
    q.eq.mockImplementationOnce(() => q).mockImplementationOnce(() => q).mockImplementationOnce(() => q);
    q.in.mockResolvedValueOnce({ data: [], error: null });
    const res = await putAssignments(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/services?clinic_id=${CLINIC_A}`, jsonBody({ service_ids: [SERVICE] })));
    expect(res.status).toBe(404);
  });

  it('rejects cross-clinic assignment save', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await putAssignments(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}/services?clinic_id=${CLINIC_B}`, jsonBody({ service_ids: [SERVICE] })));
    expect(res.status).toBe(403);
  });
});