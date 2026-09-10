import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * AI Clinic Operating Assistant — API route tests (RBAC + error mapping).
 */

const mockAuth = vi.hoisted(() => ({
  authorizeClinicRequest: vi.fn(),
}));
vi.mock('@/lib/services/clinicAuthorization', () => ({
  ...mockAuth,
  FINANCE_READ_ROLES: ['owner', 'accountant', 'manager', 'receptionist'],
}));

const mockAssistant = vi.hoisted(() => ({ runClinicAssistant: vi.fn() }));
vi.mock('@/lib/services/clinicAssistant', () => mockAssistant);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

import { POST } from '@/app/api/clinic/assistant/route';

const req = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/clinic/assistant', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: true, role: 'owner' });
});

describe('POST /api/clinic/assistant', () => {
  it('400 on missing clinic_id or question, and on invalid JSON', async () => {
    expect((await POST(req({ question: 'hi' }))).status).toBe(400);
    expect((await POST(req({ clinic_id: 'c1' }))).status).toBe(400);
    const bad = new Request('http://localhost/api/clinic/assistant', { method: 'POST', body: 'not-json' });
    expect((await POST(bad)).status).toBe(400);
  });

  it('401/403 from authorizeClinicRequest; service never called', async () => {
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 401 });
    expect((await POST(req({ clinic_id: 'c1', question: 'q' }))).status).toBe(401);
    mockAuth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    expect((await POST(req({ clinic_id: 'c1', question: 'q' }))).status).toBe(403);
    expect(mockAssistant.runClinicAssistant).not.toHaveBeenCalled();
  });

  it('200 passes server-derived role and clinic_id; patient/today forwarded', async () => {
    mockAssistant.runClinicAssistant.mockResolvedValue({ tool: 'today_appointments', answer: 'ok' });
    const res = await POST(req({ clinic_id: 'c1', question: 'مواعيد اليوم', patient_id: 'p9', today: '2026-09-02' }));
    expect(res.status).toBe(200);
    expect(mockAssistant.runClinicAssistant).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c1', role: 'owner', patientId: 'p9', today: '2026-09-02' })
    );
  });

  it('403 on FORBIDDEN_TOOL, 400 on PATIENT_ID_REQUIRED, 500 otherwise', async () => {
    mockAssistant.runClinicAssistant.mockRejectedValue(new Error('FORBIDDEN_TOOL'));
    expect((await POST(req({ clinic_id: 'c1', question: 'q' }))).status).toBe(403);
    mockAssistant.runClinicAssistant.mockRejectedValue(new Error('PATIENT_ID_REQUIRED'));
    expect((await POST(req({ clinic_id: 'c1', question: 'q' }))).status).toBe(400);
    mockAssistant.runClinicAssistant.mockRejectedValue(new Error('boom'));
    const res = await POST(req({ clinic_id: 'c1', question: 'q' }));
    expect(res.status).toBe(500);
    expect(mockLogging.logEvent).toHaveBeenCalled();
  });
});
