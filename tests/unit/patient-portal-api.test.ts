import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  listOwn: vi.fn(),
}));

vi.mock('@/lib/services/patientPortal', () => ({
  authorizePatientRequest: mocks.authorize,
  listOwnAppointments: mocks.listOwn,
  PatientPortalError: class PatientPortalError extends Error {
    code: string;
    status: number;
    constructor(code: string, status = 401) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
}));

import { GET as identityGET } from '@/app/api/portal/identity/route';
import { GET as appointmentsGET } from '@/app/api/portal/appointments/route';

const IDENTITY = {
  id: 'i1',
  clinic_id: '11111111-1111-1111-1111-111111111111',
  patient_id: '22222222-2222-2222-2222-222222222222',
  email: 'p@x.com',
};

function err(code: string, status: number) {
  const e = new Error(code) as Error & { code: string; status: number };
  (e as any).code = code;
  (e as any).status = status;
  return e;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /api/portal/identity', () => {
  it('blocks unauthenticated (401)', async () => {
    mocks.authorize.mockResolvedValue({ error: err('PATIENT_UNAUTHENTICATED', 401) });
    const res = await identityGET(new Request('https://x.test/api/portal/identity'));
    expect(res.status).toBe(401);
    expect(((await res.json()) as any).error).toBe('PATIENT_UNAUTHENTICATED');
  });

  it('blocks revoked/unverified identity (403)', async () => {
    mocks.authorize.mockResolvedValue({ error: err('NO_ACTIVE_PATIENT_IDENTITY', 403) });
    const res = await identityGET(new Request('https://x.test/api/portal/identity'));
    expect(res.status).toBe(403);
  });

  it('returns the session-derived identity (never client-supplied)', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    const res = await identityGET(
      new Request('https://x.test/api/portal/identity?patient_id=EVIL&clinic_id=EVIL')
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.identity).toEqual({
      clinic_id: IDENTITY.clinic_id,
      patient_id: IDENTITY.patient_id,
      email: IDENTITY.email,
    });
  });
});

describe('GET /api/portal/appointments', () => {
  it('blocks unauthenticated (401)', async () => {
    mocks.authorize.mockResolvedValue({ error: err('PATIENT_UNAUTHENTICATED', 401) });
    const res = await appointmentsGET(new Request('https://x.test/api/portal/appointments'));
    expect(res.status).toBe(401);
  });

  it('returns own appointments for a valid identity', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.listOwn.mockResolvedValue([{ id: 'a1' }]);
    const res = await appointmentsGET(new Request('https://x.test/api/portal/appointments'));
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).appointments).toEqual([{ id: 'a1' }]);
    // reads are keyed by the identity, ignoring any client params
    expect(mocks.listOwn).toHaveBeenCalledWith(IDENTITY);
  });

  it('fails closed on query error (500, no leakage)', async () => {
    mocks.authorize.mockResolvedValue({ identity: IDENTITY });
    mocks.listOwn.mockRejectedValue(new Error('db down'));
    const res = await appointmentsGET(new Request('https://x.test/api/portal/appointments'));
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).error).toBe('PORTAL_QUERY_FAILED');
  });
});
