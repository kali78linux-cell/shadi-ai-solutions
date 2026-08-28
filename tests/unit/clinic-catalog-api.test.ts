import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn(), roleDenied: vi.fn(() => null), ADMIN_ROLES: ['owner','manager'], DATA_ROLES: ['owner','manager','doctor','receptionist','staff'] }));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

// Shared chainable query builder mock. Dashboard APIs use the server-only
// service client after authorization, so this mirrors that real dependency.
const mockSupabaseAdmin = vi.hoisted(() => {
  const q: Record<string, any> = {
    from: vi.fn(),
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    single: vi.fn(),
  };
  return { supabaseAdmin: q };
});
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

import { GET as getProviders, POST as postProvider } from '@/app/api/clinic/providers/route';
import { PUT as putProvider, DELETE as deleteProvider } from '@/app/api/clinic/providers/[providerId]/route';
import { GET as getServices, POST as postService } from '@/app/api/clinic/services/route';
import { PUT as putService, DELETE as deleteService } from '@/app/api/clinic/services/[serviceId]/route';

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';
const PROVIDER = '33333333-3333-3333-3333-333333333333';
const SERVICE = '44444444-4444-4444-4444-444444444444';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}
function jsonBody(data: unknown): RequestInit {
  return { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

function resetChain() {
  const q = mockSupabaseAdmin.supabaseAdmin;
  q.from.mockReturnValue(q);
  q.select.mockReturnValue(q);
  q.insert.mockReturnValue(q);
  q.update.mockReturnValue(q);
  q.eq.mockReturnValue(q);
  q.order.mockResolvedValue({ data: [], error: null });
  q.single.mockResolvedValue({ data: null, error: null });
}

const providerRow = { id: PROVIDER, name: 'Dr. Smith', title: 'Dentist', provider_type: 'dentist', email: null, phone: null, deleted_at: null };
const serviceRow = { id: SERVICE, name: 'Cleaning', description: null, duration_minutes: 30, price: 100, active: true, deleted_at: null };

describe('Provider management API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('lists providers for an authorized clinic member', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.order.mockResolvedValue({ data: [providerRow], error: null });
    const res = await getProviders(makeRequest(`http://localhost/api/clinic/providers?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].name).toBe('Dr. Smith');
  });

  it('returns 403 when caller is not a member of the clinic (tenant isolation)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await getProviders(makeRequest(`http://localhost/api/clinic/providers?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
  });

  it('creates a provider and a default schedule row', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.single.mockResolvedValue({ data: providerRow, error: null });
    const res = await postProvider(makeRequest(`http://localhost/api/clinic/providers?clinic_id=${CLINIC_A}`, jsonBody({ name: 'Dr. Smith', title: 'Dentist', provider_type: 'dentist' })));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.name).toBe('Dr. Smith');
    expect(q.from).toHaveBeenCalledWith('provider_schedules');
  });

  it('returns 400 for invalid provider payload', async () => {
    const res = await postProvider(makeRequest(`http://localhost/api/clinic/providers?clinic_id=${CLINIC_A}`, jsonBody({ name: '' })));
    expect(res.status).toBe(400);
  });

  it('updates a provider clinic-scoped', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.single.mockResolvedValue({ data: { ...providerRow, name: 'Dr. Renamed' }, error: null });
    const res = await putProvider(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}?clinic_id=${CLINIC_A}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Dr. Renamed' }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.name).toBe('Dr. Renamed');
  });

  it('returns 403 when updating a provider of another clinic', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await putProvider(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}?clinic_id=${CLINIC_B}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) }));
    expect(res.status).toBe(403);
  });

  it('deletes a provider clinic-scoped (soft delete)', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.update.mockReturnValue(q);
    const res = await deleteProvider(makeRequest(`http://localhost/api/clinic/providers/${PROVIDER}?clinic_id=${CLINIC_A}`, { method: 'DELETE' }));
    expect(res.status).toBe(200);
  });
});

describe('Service management API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetChain();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('lists services for an authorized clinic member', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.order.mockResolvedValue({ data: [serviceRow], error: null });
    const res = await getServices(makeRequest(`http://localhost/api/clinic/services?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].name).toBe('Cleaning');
  });

  it('returns 403 for services of another clinic (tenant isolation)', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await getServices(makeRequest(`http://localhost/api/clinic/services?clinic_id=${CLINIC_B}`));
    expect(res.status).toBe(403);
  });

  it('creates a service clinic-scoped', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.single.mockResolvedValue({ data: serviceRow, error: null });
    const res = await postService(makeRequest(`http://localhost/api/clinic/services?clinic_id=${CLINIC_A}`, jsonBody({ name: 'Cleaning', duration_minutes: 30, price: 100 })));
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data.name).toBe('Cleaning');
  });

  it('returns 400 for invalid service payload', async () => {
    const res = await postService(makeRequest(`http://localhost/api/clinic/services?clinic_id=${CLINIC_A}`, jsonBody({ name: 'Cleaning', duration_minutes: 0 })));
    expect(res.status).toBe(400);
  });

  it('updates a service clinic-scoped', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.single.mockResolvedValue({ data: { ...serviceRow, duration_minutes: 45, price: 150 }, error: null });
    const res = await putService(makeRequest(`http://localhost/api/clinic/services/${SERVICE}?clinic_id=${CLINIC_A}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ duration_minutes: 45, price: 150 }) }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.duration_minutes).toBe(45);
  });

  it('returns 403 when updating a service of another clinic', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const res = await putService(makeRequest(`http://localhost/api/clinic/services/${SERVICE}?clinic_id=${CLINIC_B}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ duration_minutes: 45 }) }));
    expect(res.status).toBe(403);
  });

  it('deletes a service clinic-scoped (soft delete)', async () => {
    const q = mockSupabaseAdmin.supabaseAdmin;
    q.update.mockReturnValue(q);
    const res = await deleteService(makeRequest(`http://localhost/api/clinic/services/${SERVICE}?clinic_id=${CLINIC_A}`, { method: 'DELETE' }));
    expect(res.status).toBe(200);
  });
});
