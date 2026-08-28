import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ authorizeClinicRequest: vi.fn() }));
const db = vi.hoisted(() => {
  const q: Record<string, any> = { from: vi.fn(), select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn(), insert: vi.fn(), update: vi.fn(), single: vi.fn() };
  return { q };
});

vi.mock('@/lib/services/clinicAuthorization', () => ({ ...auth, roleDenied: vi.fn(() => null), ADMIN_ROLES: ['owner','manager'], DATA_ROLES: ['owner','manager','doctor','receptionist','staff'] }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: db.q }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { GET, PUT } from '@/app/api/clinic/ai-settings/route';

const clinicId = '11111111-1111-1111-1111-111111111111';
const request = (method = 'GET', body?: unknown) => new Request(`http://localhost/api/clinic/ai-settings?clinic_id=${clinicId}`, {
  method,
  headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
});

describe('clinic AI settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.authorizeClinicRequest.mockResolvedValue({ authorized: true, user: { id: 'user-1' }, role: 'owner' });
    db.q.from.mockReturnValue(db.q);
    db.q.select.mockReturnValue(db.q);
    db.q.eq.mockReturnValue(db.q);
    db.q.is.mockReturnValue(db.q);
    db.q.insert.mockReturnValue(db.q);
    db.q.update.mockReturnValue(db.q);
    db.q.maybeSingle.mockResolvedValue({ data: null, error: null });
    db.q.single.mockResolvedValue({ data: { clinic_id: clinicId, appointment_booking_enabled: true, knowledge_retrieval_enabled: true }, error: null });
  });

  it('persists the dashboard booking and retrieval controls for the authorized clinic only', async () => {
    const response = await PUT(request('PUT', { appointment_booking_enabled: true, knowledge_retrieval_enabled: false, lead_detection_enabled: true }));
    expect(response.status).toBe(200);
    expect(db.q.insert).toHaveBeenCalledWith(expect.objectContaining({
      clinic_id: clinicId,
      appointment_booking_enabled: true,
      knowledge_retrieval_enabled: false,
      lead_detection_enabled: true,
    }));
  });

  it('rejects malformed settings without a database write', async () => {
    const response = await PUT(request('PUT', { confidence_threshold: 2 }));
    expect(response.status).toBe(400);
    expect(db.q.insert).not.toHaveBeenCalled();
    expect(db.q.update).not.toHaveBeenCalled();
  });

  it('blocks a caller without membership before reading settings', async () => {
    auth.authorizeClinicRequest.mockResolvedValue({ authorized: false, status: 403 });
    const response = await GET(request());
    expect(response.status).toBe(403);
    expect(db.q.from).not.toHaveBeenCalled();
  });
});
