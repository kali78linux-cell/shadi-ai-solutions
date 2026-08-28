import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as servicesGET } from '@/app/api/booking/services/route';
import { GET as providersGET } from '@/app/api/booking/providers/route';

// Mock bookingService
const mockBookingService = vi.hoisted(() => ({
  getActiveServices: vi.fn(),
  getActiveProviders: vi.fn(),
}));
vi.mock('@/lib/services/bookingService', () => mockBookingService);

// Mock logging
const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

function makeRequest(url: string): Request {
  return new Request(url);
}

const CLINIC = '11111111-1111-1111-1111-111111111111';
const SERVICE = '22222222-2222-2222-2222-222222222222';

describe('GET /api/booking/services', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active services for a valid clinic', async () => {
    mockBookingService.getActiveServices.mockResolvedValue([
      { id: 's1', name: 'Cleaning', description: 'Dental cleaning', duration_minutes: 30, price: 100 },
      { id: 's2', name: 'Root Canal', description: null, duration_minutes: 60, price: 500 },
    ]);

    const res = await servicesGET(makeRequest(`http://localhost/api/booking/services?clinic_id=${CLINIC}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.services).toEqual([
      { id: 's1', name: 'Cleaning', description: 'Dental cleaning', duration_minutes: 30 },
      { id: 's2', name: 'Root Canal', description: null, duration_minutes: 60 },
    ]);
    expect(JSON.stringify(body.data.services)).not.toContain('price');
    expect(mockBookingService.getActiveServices).toHaveBeenCalledWith(CLINIC);
  });

  it('returns only active services (no inactive)', async () => {
    mockBookingService.getActiveServices.mockResolvedValue([
      { id: 's1', name: 'Cleaning', description: null, duration_minutes: 30, price: null },
    ]);

    const res = await servicesGET(makeRequest(`http://localhost/api/booking/services?clinic_id=${CLINIC}`));
    const body = await res.json();

    expect(body.data.services).toHaveLength(1);
    expect(body.data.services[0].id).toBe('s1');
  });

  it('returns 400 for invalid clinic_id', async () => {
    const res = await servicesGET(makeRequest('http://localhost/api/booking/services?clinic_id=not-a-uuid'));
    expect(res.status).toBe(400);
    expect(mockBookingService.getActiveServices).not.toHaveBeenCalled();
  });

  it('returns 400 for missing clinic_id', async () => {
    const res = await servicesGET(makeRequest('http://localhost/api/booking/services'));
    expect(res.status).toBe(400);
  });

  it('returns 500 on internal error', async () => {
    mockBookingService.getActiveServices.mockRejectedValue(new Error('DB down'));
    const res = await servicesGET(makeRequest(`http://localhost/api/booking/services?clinic_id=${CLINIC}`));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('does not expose internal/sensitive fields', async () => {
    mockBookingService.getActiveServices.mockResolvedValue([
      { id: 's1', name: 'Cleaning', description: null, duration_minutes: 30, price: 100 },
    ]);
    const res = await servicesGET(makeRequest(`http://localhost/api/booking/services?clinic_id=${CLINIC}`));
    const body = await res.json();
    const raw = JSON.stringify(body);
    // No internal fields like created_at, updated_at, deleted_at, active, clinic_id
    expect(raw).not.toContain('created_at');
    expect(raw).not.toContain('updated_at');
    expect(raw).not.toContain('deleted_at');
    expect(raw).not.toContain('"active"');
  });
});

describe('GET /api/booking/providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active providers with schedules for a valid clinic', async () => {
    mockBookingService.getActiveProviders.mockResolvedValue([
      { id: 'p1', name: 'Dr. Smith', title: 'Dentist' },
      { id: 'p2', name: 'Dr. Jones', title: 'Hygienist' },
    ]);

    const res = await providersGET(makeRequest(`http://localhost/api/booking/providers?clinic_id=${CLINIC}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.providers).toEqual([
      { id: 'p1', name: 'Dr. Smith', title: 'Dentist' },
      { id: 'p2', name: 'Dr. Jones', title: 'Hygienist' },
    ]);
    expect(mockBookingService.getActiveProviders).toHaveBeenCalledWith(CLINIC, undefined);
  });

  it('filters providers by service_id when provided', async () => {
    mockBookingService.getActiveProviders.mockResolvedValue([
      { id: 'p1', name: 'Dr. Smith', title: 'Dentist' },
    ]);

    const res = await providersGET(makeRequest(`http://localhost/api/booking/providers?clinic_id=${CLINIC}&service_id=${SERVICE}`));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.service_id).toBe(SERVICE);
    expect(mockBookingService.getActiveProviders).toHaveBeenCalledWith(CLINIC, SERVICE);
  });

  it('returns 400 for invalid clinic_id', async () => {
    const res = await providersGET(makeRequest('http://localhost/api/booking/providers?clinic_id=bad'));
    expect(res.status).toBe(400);
    expect(mockBookingService.getActiveProviders).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid service_id', async () => {
    const res = await providersGET(makeRequest(`http://localhost/api/booking/providers?clinic_id=${CLINIC}&service_id=bad`));
    expect(res.status).toBe(400);
  });

  it('returns 500 on internal error', async () => {
    mockBookingService.getActiveProviders.mockRejectedValue(new Error('DB down'));
    const res = await providersGET(makeRequest(`http://localhost/api/booking/providers?clinic_id=${CLINIC}`));
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('does not expose internal/sensitive provider fields', async () => {
    mockBookingService.getActiveProviders.mockResolvedValue([
      { id: 'p1', name: 'Dr. Smith', title: 'Dentist' },
    ]);
    const res = await providersGET(makeRequest(`http://localhost/api/booking/providers?clinic_id=${CLINIC}`));
    const body = await res.json();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('email');
    expect(raw).not.toContain('phone');
    expect(raw).not.toContain('user_id');
    expect(raw).not.toContain('created_at');
    expect(raw).not.toContain('deleted_at');
  });
});
