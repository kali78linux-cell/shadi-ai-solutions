import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockAudit = vi.hoisted(() => ({ writeAuditLog: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/services/auditService', () => mockAudit);

// Harness mirrors clinic-setup-api: fresh chainable+thenable builder per
// .from(table), resolved {data,error} looked up per table.
const mockSupabaseAdmin = vi.hoisted(() => {
  const rows: Record<string, any> = {};
  const CHAIN_METHODS = ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'is', 'in', 'or', 'order', 'limit', 'single', 'maybeSingle'];
  function makeBuilder() {
    const b: Record<string, any> = {};
    for (const m of CHAIN_METHODS) b[m] = vi.fn(() => b);
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

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const CLINIC_B = '22222222-2222-2222-2222-222222222222';

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(`http://localhost${url}`, init);
}
function jsonBody(data: unknown): RequestInit {
  return { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

const clinicRow = {
  id: CLINIC_A, name: 'Test Clinic', phone: '123', address: 'Addr', website: null,
  slug: 'test', settings: { timezone: 'Asia/Jerusalem', country: 'فلسطين' },
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

function resetRows() {
  const rows = mockSupabaseAdmin.rows;
  rows.clinics = { data: clinicRow, error: null };
  rows.clinic_settings = {
    data: { clinic_id: CLINIC_A, currency: 'ils', timezone: 'Asia/Jerusalem', locale: 'ar', date_format: 'YYYY-MM-DD', number_format: 'en', fiscal_year: 'calendar' },
    error: null,
  };
}

describe('Localization — profile GET surfaces clinic_settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRows();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
  });

  it('returns currency/timezone/locale/date_format/number_format/fiscal_year', async () => {
    const res = await getProfile(makeRequest(`/api/clinic/profile?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.currency).toBe('ils');
    expect(body.data.timezone).toBe('Asia/Jerusalem');
    expect(body.data.locale).toBe('ar');
    expect(body.data.date_format).toBe('YYYY-MM-DD');
    expect(body.data.number_format).toBe('en');
    expect(body.data.fiscal_year).toBe('calendar');
  });

  it('falls back to the legacy settings.timezone when no clinic_settings row', async () => {
    mockSupabaseAdmin.rows.clinic_settings = { data: null, error: null };
    const res = await getProfile(makeRequest(`/api/clinic/profile?clinic_id=${CLINIC_A}`));
    const body = await res.json();
    expect(body.data.timezone).toBe('Asia/Jerusalem');
    expect(body.data.currency).toBeNull();
  });

  it('401 when unauthenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    const res = await getProfile(makeRequest(`/api/clinic/profile?clinic_id=${CLINIC_A}`));
    expect(res.status).toBe(401);
  });
});

describe('Localization — profile PUT persists clinic_settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRows();
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
  });

  it('rejects INVALID_TIMEZONE with 400 before any write', async () => {
    const res = await putProfile(makeRequest(`/api/clinic/profile?clinic_id=${CLINIC_A}`, jsonBody({
      name: 'X', timezone: 'Mars/Olympus',
    })));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('INVALID_TIMEZONE');
  });

  it('persists valid timezone + currency to clinic_settings', async () => {
    const res = await putProfile(makeRequest(`/api/clinic/profile?clinic_id=${CLINIC_A}`, jsonBody({
      name: 'Test Clinic',
      timezone: 'Asia/Amman',
      currency: 'JOD',
      locale: 'ar',
    })));
    expect(res.status).toBe(200);
    const upserts = mockSupabaseAdmin.supabaseAdmin.from.mock.results
      .map((r: any) => r.value.upsert)
      .filter((u: any) => u && u.mock.calls.length > 0);
    expect(upserts.length).toBeGreaterThan(0);
    expect(upserts[0].mock.calls[0][0]).toEqual(expect.objectContaining({ currency: 'JOD', timezone: 'Asia/Amman' }));
  });

  it('does NOT touch clinic_settings when no localization fields are sent', async () => {
    await putProfile(makeRequest(`/api/clinic/profile?clinic_id=${CLINIC_A}`, jsonBody({ name: 'Renamed' })));
    const upserts = mockSupabaseAdmin.supabaseAdmin.from.mock.results
      .map((r: any) => r.value.upsert)
      .filter((u: any) => u && u.mock.calls.length > 0);
    expect(upserts.length).toBe(0);
  });

  it('403 when not an ADMIN_ROLE', async () => {
    mockAuth.roleDenied.mockImplementation(() => ({ authorized: false, status: 403 }));
    const res = await putProfile(makeRequest(`/api/clinic/profile?clinic_id=${CLINIC_A}`, jsonBody({
      name: 'X', currency: 'SAR',
    })));
    expect(res.status).toBe(403);
  });
});