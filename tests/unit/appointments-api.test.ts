import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn() }));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockSupabase = vi.hoisted(() => {
  const q: Record<string, any> = {
    from: vi.fn(), select: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), order: vi.fn(), single: vi.fn(), upsert: vi.fn(), delete: vi.fn(), in: vi.fn(), gte: vi.fn(), lt: vi.fn(), limit: vi.fn(),
  };
  return { supabase: q };
});
vi.mock('@/lib/supabase', () => mockSupabase);

const mockConfig = vi.hoisted(() => ({ getSupabaseEnvConfig: vi.fn() }));
vi.mock('@/lib/config', () => mockConfig);

const mockScheduling = vi.hoisted(() => ({ getCalendarRange: vi.fn() }));
vi.mock('@/lib/services/scheduling', () => mockScheduling);

const mockDemo = vi.hoisted(() => ({ createDemoAppointment: vi.fn(), getDemoAppointments: vi.fn() }));
vi.mock('@/lib/demoState', () => mockDemo);

import { GET as getAppointments, PATCH as patchAppointment } from '@/app/api/appointments/route';

const CLINIC = '11111111-1111-1111-1111-111111111111';
const OTHER_CLINIC = '22222222-2222-2222-2222-222222222222';
const PATIENT = '33333333-3333-3333-3333-333333333333';
const PROVIDER = '44444444-4444-4444-4444-444444444444';
const APPT = '55555555-5555-5555-5555-555555555555';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}
function jsonBody(data: unknown): RequestInit {
  return { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

function resetChain() {
  const q = mockSupabase.supabase;
  q.from.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.order.mockReturnValue(q); // chainable — `limit` is the terminal
  q.single.mockResolvedValue({ data: null, error: null });
  q.upsert.mockResolvedValue({ error: null });
  q.delete.mockReturnValue(q);
  q.insert.mockResolvedValue({ error: null });
  q.in.mockResolvedValue({ data: [], error: null });
  q.gte.mockReturnValue(q);
  q.lt.mockReturnValue(q);
  q.limit.mockResolvedValue({ data: [], error: null });
  q.update.mockReturnValue(q);
  q.limit.mockImplementation(() => Promise.resolve({ data: [], error: null }));
}

describe('Appointments API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    mockConfig.getSupabaseEnvConfig.mockReturnValue({ isConfigured: true });
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('returns enriched appointments with patient and provider names', async () => {
    const q = mockSupabase.supabase;
    // Appointments query: `limit` is the terminal — use mockImplementation to return data
    q.limit.mockImplementation(() => Promise.resolve({
      data: [{
        id: APPT,
        clinic_id: CLINIC,
        patient_id: PATIENT,
        provider_id: PROVIDER,
        service: 'Cleaning',
        appointment_date: '2026-07-20',
        scheduled_at: '2026-07-20T09:00:00.000Z',
        status: 'confirmed',
      }],
      error: null,
    }));
    // Patient lookup — `in` is the terminal, returns resolved data
    q.in.mockImplementationOnce(() => Promise.resolve({ data: [{ id: PATIENT, full_name: 'John Doe' }], error: null }));
    // Provider lookup
    q.in.mockImplementationOnce(() => Promise.resolve({ data: [{ id: PROVIDER, name: 'Dr. Smith' }], error: null }));

    const res = await getAppointments(makeRequest(`http://localhost/api/appointments?clinic_id=${CLINIC}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].patient_name).toBe('John Doe');
    expect(body.data[0].provider_name).toBe('Dr. Smith');
    expect(body.data[0].appointment_time).toBe('09:00');
  });

  it('returns 403 for cross-clinic access', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await getAppointments(makeRequest(`http://localhost/api/appointments?clinic_id=${OTHER_CLINIC}`));
    expect(res.status).toBe(403);
  });

  it('returns 400 for missing clinic_id', async () => {
    const res = await getAppointments(makeRequest('http://localhost/api/appointments'));
    expect(res.status).toBe(400);
  });

  it('updates appointment status via PATCH', async () => {
    const q = mockSupabase.supabase;
    q.single.mockResolvedValue({
      data: {
        id: APPT,
        clinic_id: CLINIC,
        patient_id: PATIENT,
        provider_id: PROVIDER,
        service: 'Cleaning',
        appointment_date: '2026-07-20',
        scheduled_at: '2026-07-20T09:00:00.000Z',
        status: 'completed',
      },
      error: null,
    });
    // Patient lookup
    q.in.mockResolvedValueOnce({ data: [{ id: PATIENT, full_name: 'John Doe' }], error: null });
    // Provider lookup
    q.in.mockResolvedValueOnce({ data: [{ id: PROVIDER, name: 'Dr. Smith' }], error: null });

    const res = await patchAppointment(makeRequest(`http://localhost/api/appointments?clinic_id=${CLINIC}&appointment_id=${APPT}`, jsonBody({ status: 'completed' })));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('completed');
  });

  it('rejects invalid appointment status via PATCH', async () => {
    const res = await patchAppointment(makeRequest(`http://localhost/api/appointments?clinic_id=${CLINIC}&appointment_id=${APPT}`, jsonBody({ status: 'invalid' })));
    expect(res.status).toBe(400);
  });

  it('returns 403 for cross-clinic PATCH', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await patchAppointment(makeRequest(`http://localhost/api/appointments?clinic_id=${OTHER_CLINIC}&appointment_id=${APPT}`, jsonBody({ status: 'confirmed' })));
    expect(res.status).toBe(403);
  });

  it('returns 404 when appointment not found for PATCH', async () => {
    const q = mockSupabase.supabase;
    q.single.mockResolvedValue({ data: null, error: { message: 'not found' } });
    const res = await patchAppointment(makeRequest(`http://localhost/api/appointments?clinic_id=${CLINIC}&appointment_id=${APPT}`, jsonBody({ status: 'confirmed' })));
    expect(res.status).toBe(404);
  });
});