import { describe, it, expect, vi, beforeEach } from 'vitest';

// PHASE 3+4 — API-level security tests for recall endpoints, notification
// preferences, and intake staff endpoints: 401 / 403 RBAC / 400 invalid body.

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
  roleDenied: vi.fn(() => null),
  ADMIN_ROLES: ['owner', 'manager'],
  DATA_ROLES: ['owner', 'manager', 'doctor', 'receptionist', 'staff'],
}));
vi.mock('@/lib/services/clinicAuthorization', () => mockAuth);

const mockSvc = vi.hoisted(() => ({
  getRecallRules: vi.fn(async () => ({ clinic_id: 'c1', enabled: true, interval_days: 180, channels: ['sms'] })),
  upsertRecallRules: vi.fn(async (p: any) => ({ clinic_id: p.clinicId, enabled: p.enabled, interval_days: p.intervalDays, channels: p.channels })),
  listRecalls: vi.fn(async () => []),
  computeEligibleRecalls: vi.fn(async () => []),
  runRecallGeneration: vi.fn(async () => ({ eligible: 1, created: 1, skippedActive: 0, queueRows: 1 })),
  cancelRecall: vi.fn(async () => undefined),
  getPatientNotificationPreferences: vi.fn(async () => null),
  upsertPatientNotificationPreferences: vi.fn(async (p: any) => ({ clinic_id: p.clinicId, patient_id: p.patientId, opt_out: false, channels: ['sms'], dnd_start: null, dnd_end: null })),
  createIntakeForm: vi.fn(async (p: any) => {
    // Mirror the real service check (duplicate/invalid keys -> INVALID_FORM_SCHEMA)
    const keys = (p.schema ?? []).map((f: any) => f.key);
    if (new Set(keys).size !== keys.length || keys.length === 0) {
      throw new Error('INVALID_FORM_SCHEMA');
    }
    return { id: 'f1', clinic_id: p.clinicId, title: p.title, description: null, form_schema: p.schema, consent_text: null, active: true, created_at: 'x' };
  }),
  listIntakeForms: vi.fn(async () => []),
  listIntakeResponses: vi.fn(async () => []),
}));
vi.mock('@/lib/services/recallService', () => mockSvc);
vi.mock('@/lib/services/intakeService', () => ({
  createIntakeForm: mockSvc.createIntakeForm,
  listIntakeForms: mockSvc.listIntakeForms,
  listIntakeResponses: mockSvc.listIntakeResponses,
}));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { GET as rulesGET, PATCH as rulesPATCH } from '@/app/api/clinic/recalls/rules/route';
import { POST as runPOST } from '@/app/api/clinic/recalls/run/route';
import { POST as cancelPOST } from '@/app/api/clinic/recalls/cancel/route';
import { GET as recallsGET } from '@/app/api/clinic/recalls/route';
import { PUT as prefsPUT } from '@/app/api/clinic/patients/[patientId]/notification-preferences/route';
import { GET as intakeFormsGET, POST as intakeFormsPOST } from '@/app/api/clinic/intake/forms/route';
import { GET as intakeResponsesGET } from '@/app/api/clinic/intake/responses/route';

const CID = '11111111-1111-1111-1111-111111111111';
const PID = 'aaaaaaaa-1111-1111-1111-111111111111';

function req(url: string, init?: RequestInit) {
  return new Request(url, init ?? { method: 'GET', headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'u1' }, role: 'owner' });
  mockAuth.roleDenied.mockReturnValue(null);
});

describe('PHASE 3 — recall rules API', () => {
  it('401 unauthenticated', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await rulesGET(req(`http://localhost/api/clinic/recalls/rules?clinic_id=${CID}`));
    expect(res.status).toBe(401);
  });

  it('403 RBAC (staff)', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const res = await rulesPATCH(req('http://localhost/api/clinic/recalls/rules', {
      method: 'PATCH',
      body: JSON.stringify({ clinic_id: CID, enabled: true, interval_days: 180, channels: ['sms', 'email'] }),
    }));
    expect(res.status).toBe(403);
  });

  it('200 upsert rules for owner', async () => {
    const res = await rulesPATCH(req('http://localhost/api/clinic/recalls/rules', {
      method: 'PATCH',
      body: JSON.stringify({ clinic_id: CID, enabled: true, interval_days: 180, channels: ['sms', 'email'] }),
    }));
    expect(res.status).toBe(200);
    expect(mockSvc.upsertRecallRules).toHaveBeenCalled();
  });

  it('400 invalid body (interval too small)', async () => {
    const res = await rulesPATCH(req('http://localhost/api/clinic/recalls/rules', {
      method: 'PATCH',
      body: JSON.stringify({ clinic_id: CID, enabled: true, interval_days: 1, channels: ['sms'] }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('PHASE 3 — recall run/cancel API', () => {
  it('200 run generation (owner)', async () => {
    const res = await runPOST(req('http://localhost/api/clinic/recalls/run', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: CID }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.created).toBe(1);
  });

  it('401 run generation', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await runPOST(req('http://localhost/api/clinic/recalls/run', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: CID }),
    }));
    expect(res.status).toBe(401);
  });

  it('200 cancel recall (owner)', async () => {
    const res = await cancelPOST(req('http://localhost/api/clinic/recalls/cancel', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: CID, recall_id: 'bbbbbbbb-1111-1111-1111-111111111111' }),
    }));
    expect(res.status).toBe(200);
  });

  it('recalls GET returns rules + eligible', async () => {
    const res = await recallsGET(req(`http://localhost/api/clinic/recalls?clinic_id=${CID}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.rules).not.toBeNull();
  });
});

describe('PHASE 3 — patient notification preferences', () => {
  it('403 RBAC (non-admin)', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const res = await prefsPUT(req(`http://localhost/api/clinic/patients/${PID}/notification-preferences?clinic_id=${CID}`, {
      method: 'PUT',
      body: JSON.stringify({ opt_out: true }),
    }), { params: { patientId: PID } });
    expect(res.status).toBe(403);
  });

  it('200 owner updates prefs', async () => {
    const res = await prefsPUT(req(`http://localhost/api/clinic/patients/${PID}/notification-preferences?clinic_id=${CID}`, {
      method: 'PUT',
      body: JSON.stringify({ opt_out: true, channels: ['email'] }),
    }), { params: { patientId: PID } });
    expect(res.status).toBe(200);
  });
});

describe('PHASE 4 — intake staff API', () => {
  it('401 unauth on forms GET', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValueOnce({ authorized: false, status: 401 });
    const res = await intakeFormsGET(req(`http://localhost/api/clinic/intake/forms?clinic_id=${CID}`));
    expect(res.status).toBe(401);
  });

  it('201 create a valid intake form (owner)', async () => {
    const res = await intakeFormsPOST(req('http://localhost/api/clinic/intake/forms', {
      method: 'POST',
      body: JSON.stringify({
        clinic_id: CID,
        title: 'New patient',
        schema: [{ key: 'full_name', label: 'Name', type: 'text', required: true }],
      }),
    }));
    expect(res.status).toBe(201);
  });

  it('400 rejects an invalid form schema (duplicate keys)', async () => {
    const res = await intakeFormsPOST(req('http://localhost/api/clinic/intake/forms', {
      method: 'POST',
      body: JSON.stringify({
        clinic_id: CID,
        title: 'Bad',
        schema: [
          { key: 'a', label: 'A', type: 'text' },
          { key: 'a', label: 'A2', type: 'text' },
        ],
      }),
    }));
    expect(res.status).toBe(400);
  });

  it('403 RBAC on responses GET (staff blocked)', async () => {
    mockAuth.roleDenied.mockReturnValueOnce({ status: 403 });
    const res = await intakeResponsesGET(req(`http://localhost/api/clinic/intake/responses?clinic_id=${CID}`));
    expect(res.status).toBe(403);
  });
});