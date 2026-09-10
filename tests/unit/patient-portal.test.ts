import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  logEvent: vi.fn(),
  writeAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: (...args: unknown[]) => mocks.from(...args) },
}));
vi.mock('@/lib/server/logging', () => ({ logEvent: mocks.logEvent }));
vi.mock('@/lib/services/auditService', () => ({ writeAuditLog: mocks.writeAuditLog }));

import {
  resolvePatientIdentity,
  authorizePatientRequest,
  provisionPatientIdentity,
  revokePatientIdentity,
  listOwnAppointments,
  PatientPortalError,
} from '@/lib/services/patientPortal';

function chain(over: { single?: unknown; singleErr?: unknown; maybe?: unknown; maybeErr?: unknown } = {}) {
  const q: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: over.single ?? null, error: over.singleErr ?? null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: over.maybe ?? null, error: over.maybeErr ?? null }),
  };
  q.limit.mockResolvedValue({ data: [], error: null });
  return q;
}

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PATIENT = '22222222-2222-2222-2222-222222222222';
const USER = '44444444-4444-4444-4444-444444444444';
const IDENTITY_ROW = { id: 'i1', clinic_id: CLINIC, patient_id: PATIENT, email: 'p@x.com' };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockReset();
});

describe('patient identity resolution', () => {
  it('blocks unauthenticated sessions', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'no session' } });
    await expect(resolvePatientIdentity()).rejects.toMatchObject({ code: 'PATIENT_UNAUTHENTICATED' });
  });

  it('blocks unverified email even with a session', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER, email_confirmed_at: null } },
      error: null,
    });
    await expect(resolvePatientIdentity()).rejects.toMatchObject({ code: 'PATIENT_IDENTITY_UNVERIFIED' });
  });

  it('blocks when no active identity exists', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER, email_confirmed_at: '2026-01-01' } },
      error: null,
    });
    mocks.from.mockReturnValue(chain());
    await expect(resolvePatientIdentity()).rejects.toMatchObject({ code: 'NO_ACTIVE_PATIENT_IDENTITY' });
  });

  it('fails closed on ambiguous identities (defence in depth)', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER, email_confirmed_at: '2026-01-01' } },
      error: null,
    });
    const q = chain();
    q.limit.mockResolvedValue({ data: [IDENTITY_ROW, { ...IDENTITY_ROW, id: 'i2' }], error: null });
    mocks.from.mockReturnValue(q);
    await expect(resolvePatientIdentity()).rejects.toMatchObject({ code: 'PORTAL_IDENTITY_AMBIGUOUS' });
  });

  it('resolves the single active identity (verified user) with security filters', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: USER, email_confirmed_at: '2026-01-01' } },
      error: null,
    });
    const q = chain();
    q.limit.mockResolvedValue({ data: [IDENTITY_ROW], error: null });
    mocks.from.mockReturnValue(q);
    const identity = await resolvePatientIdentity();
    expect(identity).toMatchObject({ clinic_id: CLINIC, patient_id: PATIENT });
    expect(q.eq).toHaveBeenCalledWith('user_id', USER);
    expect(q.eq).toHaveBeenCalledWith('status', 'active');
    expect(q.is).toHaveBeenCalledWith('deleted_at', null);
    expect(q.not).toHaveBeenCalledWith('verified_at', 'is', null);
  });

  it('authorizePatientRequest maps PatientPortalError to status codes', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'x' } });
    const res = await authorizePatientRequest(new Request('https://x.test/api/portal/identity'));
    expect('error' in res && res.error).toBeInstanceOf(PatientPortalError);
    expect('error' in res && res.error.status).toBe(401);
  });
});

describe('provision / revoke identity', () => {
  it('provisions an identity and writes audit', async () => {
    const q = chain();
    q.single.mockResolvedValueOnce({ data: { id: 'i-new' }, error: null });
    mocks.from.mockReturnValue(q);
    const res = await provisionPatientIdentity({ clinicId: CLINIC, patientId: PATIENT, email: ' P@X.com ', userId: USER });
    expect(res).toEqual({ id: 'i-new' });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'portal_identity_provisioned' }));
  });

  it('treats duplicate provision as idempotent skip', async () => {
    const dupErr = Object.assign(new Error('duplicate key'), { code: '23505' });
    const q = chain();
    q.single.mockResolvedValueOnce({ data: null, error: dupErr });
    const q2 = chain({ maybe: { id: 'i-existing' } });
    mocks.from.mockReturnValueOnce(q).mockReturnValueOnce(q2);
    const res = await provisionPatientIdentity({ clinicId: CLINIC, patientId: PATIENT, email: 'p@x.com', userId: USER });
    expect(res.duplicate).toBe(true);
    expect(mocks.logEvent).toHaveBeenCalledWith('portal_identity_duplicate_skipped', expect.anything());
  });

  it('revokes via clinic-scoped update', async () => {
    const q = chain();
    mocks.from.mockReturnValue(q);
    await revokePatientIdentity({ clinicId: CLINIC, identityId: 'i1' });
    expect(q.eq).toHaveBeenCalledWith('clinic_id', CLINIC);
    expect(q.eq).toHaveBeenCalledWith('id', 'i1');
    expect(mocks.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'portal_identity_revoked' }));
  });
});

describe('portal appointment reads', () => {
  it('scopes reads strictly to the identity clinic+patient', async () => {
    const q = chain();
    q.limit.mockResolvedValue({ data: [{ id: 'a1' }], error: null });
    mocks.from.mockReturnValue(q);
    const rows = await listOwnAppointments(IDENTITY_ROW);
    expect(rows).toHaveLength(1);
    expect(q.eq).toHaveBeenCalledWith('clinic_id', CLINIC);
    expect(q.eq).toHaveBeenCalledWith('patient_id', PATIENT);
    expect(q.is).toHaveBeenCalledWith('deleted_at', null);
  });
});
