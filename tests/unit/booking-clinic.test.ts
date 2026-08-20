import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as clinicGET } from '@/app/api/booking/clinic/route';

// Mock clinics service
const mockClinics = vi.hoisted(() => ({
  resolvePublicClinic: vi.fn(),
}));
vi.mock('@/lib/services/clinics', () => mockClinics);

// Mock logging
const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

function makeRequest(url: string): Request {
  return new Request(url);
}

const VALID_CLINIC = '11111111-1111-1111-1111-111111111111';
const VALID_SLUG = 'my-dental-clinic';

describe('GET /api/booking/clinic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves a valid clinic by id', async () => {
    mockClinics.resolvePublicClinic.mockResolvedValue({
      id: VALID_CLINIC,
      slug: VALID_SLUG,
      name: 'My Dental Clinic',
    });

    const res = await clinicGET(makeRequest(`http://localhost/api/booking/clinic?clinic_id=${VALID_CLINIC}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      id: VALID_CLINIC,
      slug: VALID_SLUG,
      name: 'My Dental Clinic',
    });
    expect(mockClinics.resolvePublicClinic).toHaveBeenCalledWith({ id: VALID_CLINIC, slug: undefined });
  });

  it('resolves a valid clinic by slug', async () => {
    mockClinics.resolvePublicClinic.mockResolvedValue({
      id: VALID_CLINIC,
      slug: VALID_SLUG,
      name: 'My Dental Clinic',
    });

    const res = await clinicGET(makeRequest(`http://localhost/api/booking/clinic?slug=${VALID_SLUG}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.id).toBe(VALID_CLINIC);
    expect(mockClinics.resolvePublicClinic).toHaveBeenCalledWith({ id: undefined, slug: VALID_SLUG });
  });

  it('returns 400 when neither clinic_id nor slug is provided', async () => {
    const res = await clinicGET(makeRequest('http://localhost/api/booking/clinic'));
    expect(res.status).toBe(400);
    expect(mockClinics.resolvePublicClinic).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid clinic_id (not a uuid)', async () => {
    const res = await clinicGET(makeRequest('http://localhost/api/booking/clinic?clinic_id=not-a-uuid'));
    expect(res.status).toBe(400);
    expect(mockClinics.resolvePublicClinic).not.toHaveBeenCalled();
  });

  it('returns 404 when clinic does not exist', async () => {
    mockClinics.resolvePublicClinic.mockResolvedValue(null);

    const res = await clinicGET(makeRequest(`http://localhost/api/booking/clinic?clinic_id=${VALID_CLINIC}`));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Clinic not found');
  });

  it('returns 404 when clinic is inactive (deleted_at set)', async () => {
    mockClinics.resolvePublicClinic.mockResolvedValue(null);

    const res = await clinicGET(makeRequest(`http://localhost/api/booking/clinic?clinic_id=${VALID_CLINIC}`));
    expect(res.status).toBe(404);
  });

  it('returns 500 on internal error', async () => {
    mockClinics.resolvePublicClinic.mockRejectedValue(new Error('DB down'));

    const res = await clinicGET(makeRequest(`http://localhost/api/booking/clinic?clinic_id=${VALID_CLINIC}`));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('does not expose private clinic fields', async () => {
    mockClinics.resolvePublicClinic.mockResolvedValue({
      id: VALID_CLINIC,
      slug: VALID_SLUG,
      name: 'My Dental Clinic',
    });

    const res = await clinicGET(makeRequest(`http://localhost/api/booking/clinic?clinic_id=${VALID_CLINIC}`));
    const body = await res.json();
    const raw = JSON.stringify(body);

    expect(raw).not.toContain('address');
    expect(raw).not.toContain('phone');
    expect(raw).not.toContain('website');
    expect(raw).not.toContain('logo');
    expect(raw).not.toContain('settings');
    expect(raw).not.toContain('created_at');
    expect(raw).not.toContain('deleted_at');
  });
});
