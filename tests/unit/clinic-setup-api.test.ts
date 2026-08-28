import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn(), roleDenied: vi.fn(() => null), ADMIN_ROLES: ['owner','manager'], DATA_ROLES: ['owner','manager','doctor','receptionist','staff'] }));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

// These routes were unified onto the service-role admin client, so the test
// harness must mock the real dependency (@/lib/supabase/admin) rather than the
// legacy cookie-based server client. The routes issue several DISTINCT queries
// per request (clinic, providers, services, schedules, assignments), each ending
// in a different terminal method (.single/.is/.in/.eq), so the mock returns a
// fresh chainable+thenable builder per .from(table) whose resolved {data,error}
// is looked up by table. This models the real Supabase chain faithfully.
const mockSupabaseAdmin = vi.hoisted(() => {
  const rows: Record<string, any> = {};
  const CHAIN_METHODS = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'order', 'limit', 'single'];
  function makeBuilder(): Record<string, any> {
    const b: Record<string, any> = {};
    for (const m of CHAIN_METHODS) b[m] = vi.fn(() => b); // chainable: every method returns the same builder
    // Thenable: awaiting the result of any terminal call resolves to the row for
    // the table that was selected by the most recent .from(table).
    b.then = (resolve: (v: unknown) => void) => resolve(rows.__current ?? { data: [], error: null });
    return b;
  }
  const supabaseAdmin = {
    from: vi.fn((table: string) => {
      rows.__current = rows[table] ?? { data: [], error: null };
      return makeBuilder();
    }),
  };
  return { supabaseAdmin, rows };
});
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

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

const clinicRow = { id: CLINIC_A, name: 'Test Clinic', phone: '123', address: 'Addr', website: null, slug: 'test', created_at: '2026-01-01', updated_at: '2026-01-01' };

function resetRows() {
  const rows = mockSupabaseAdmin.rows;
  rows.clinics = { data: clinicRow, error: null };
  rows.providers = { data: [], error: null };
  rows.clinic_services = { data: [], error: null };
  rows.provider_schedules = { data: [], error: null };
  rows.provider_services = { data: [], error: null };
}

describe('Clinic Profile API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRows();
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
    mockSupabaseAdmin.rows.clinics = { data: null, error: { message: 'not found' } };
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
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.name).toBe('Test Clinic');
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
    resetRows();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
  });

  it('returns incomplete when no providers/services exist', async () => {
    const res = await getSetupStatus(makeRequest(`http://localhost/api/clinic/setup-status?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.status).toBe('incomplete');
    expect(body.data.ready).toBe(false);
    expect(body.data.missing.length).toBeGreaterThan(0);
  });

  it('returns ready when all requirements are satisfied', async () => {
    const rows = mockSupabaseAdmin.rows;
    rows.providers = { data: [{ id: PROVIDER }], error: null };
    rows.clinic_services = { data: [{ id: SERVICE, active: true }], error: null };
    rows.provider_schedules = { data: [{ provider_id: PROVIDER, enabled: true }], error: null };
    rows.provider_services = { data: [{ provider_id: PROVIDER, service_id: SERVICE }], error: null };

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
    mockSupabaseAdmin.rows.clinics = { data: null, error: { message: 'not found' } };
    const res = await getSetupStatus(makeRequest(`http://localhost/api/clinic/setup-status?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(404);
  });
});