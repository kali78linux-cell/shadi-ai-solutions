import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as availabilityGET } from '@/app/api/booking/availability/route';
import { POST as bookingPOST } from '@/app/api/booking/route';

// Mock bookingService
const mockBookingService = vi.hoisted(() => ({
  getAvailableSlots: vi.fn(),
  findOrCreatePatient: vi.fn(),
  createBooking: vi.fn(),
}));
vi.mock('@/lib/services/bookingService', () => mockBookingService);

// Mock logging
const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, init);
}

describe('GET /api/booking/availability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available slots for a valid request', async () => {
    mockBookingService.getAvailableSlots.mockResolvedValue([
      '2026-07-20T09:00:00.000Z',
      '2026-07-20T09:30:00.000Z',
    ]);

    const req = makeRequest('http://localhost/api/booking/availability?clinic_id=11111111-1111-1111-1111-111111111111&provider_id=22222222-2222-2222-2222-222222222222&date=2026-07-20');
    const res = await availabilityGET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.slots).toEqual([
      '2026-07-20T09:00:00.000Z',
      '2026-07-20T09:30:00.000Z',
    ]);
    expect(mockBookingService.getAvailableSlots).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '2026-07-20',
      10,
      undefined
    );
  });

  it('returns 400 for invalid date', async () => {
    const req = makeRequest('http://localhost/api/booking/availability?clinic_id=11111111-1111-1111-1111-111111111111&provider_id=22222222-2222-2222-2222-222222222222&date=not-a-date');
    const res = await availabilityGET(req);
    expect(res.status).toBe(400);
    expect(mockBookingService.getAvailableSlots).not.toHaveBeenCalled();
  });

  it('returns 400 for missing clinic_id', async () => {
    const req = makeRequest('http://localhost/api/booking/availability?provider_id=22222222-2222-2222-2222-222222222222&date=2026-07-20');
    const res = await availabilityGET(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when provider not found for clinic', async () => {
    mockBookingService.getAvailableSlots.mockRejectedValue(new Error('Provider not found for this clinic'));

    const req = makeRequest('http://localhost/api/booking/availability?clinic_id=11111111-1111-1111-1111-111111111111&provider_id=22222222-2222-2222-2222-222222222222&date=2026-07-20');
    const res = await availabilityGET(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Provider not found for this clinic');
  });

  it('returns 500 on internal error', async () => {
    mockBookingService.getAvailableSlots.mockRejectedValue(new Error('DB down'));

    const req = makeRequest('http://localhost/api/booking/availability?clinic_id=11111111-1111-1111-1111-111111111111&provider_id=22222222-2222-2222-2222-222222222222&date=2026-07-20');
    const res = await availabilityGET(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });
});

describe('POST /api/booking', () => {
  const validBody = {
    clinic_id: '11111111-1111-1111-1111-111111111111',
    provider_id: '22222222-2222-2222-2222-222222222222',
    service: 'Dental Cleaning',
    date: '2026-07-20',
    time: '09:00',
    patient_name: 'John Doe',
    phone: '+15551234567',
    email: 'john@example.com',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a booking for a new patient', async () => {
    mockBookingService.findOrCreatePatient.mockResolvedValue('patient-1');
    mockBookingService.createBooking.mockResolvedValue({
      id: 'appt-1',
      scheduled_at: '2026-07-20T09:00:00.000Z',
      status: 'tentative',
    });

    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await bookingPOST(req);
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data).toEqual({
      appointment_id: 'appt-1',
      date: '2026-07-20',
      time: '09:00',
      service: 'Dental Cleaning',
      provider_id: '22222222-2222-2222-2222-222222222222',
      status: 'tentative',
    });
    // No sensitive patient data returned
    expect(body.data).not.toHaveProperty('patient');
    expect(body.data).not.toHaveProperty('patient_id');
    expect(mockBookingService.findOrCreatePatient).toHaveBeenCalledWith({
      clinicId: '11111111-1111-1111-1111-111111111111',
      name: 'John Doe',
      phone: '+15551234567',
      email: 'john@example.com',
    });
    expect(mockBookingService.createBooking).toHaveBeenCalledWith({
      clinicId: '11111111-1111-1111-1111-111111111111',
      providerId: '22222222-2222-2222-2222-222222222222',
      service: 'Dental Cleaning',
      serviceId: undefined,
      date: '2026-07-20',
      time: '09:00',
      patientId: 'patient-1',
      durationMinutes: undefined,
    });
  });

  it('reuses an existing patient (no duplicate created)', async () => {
    mockBookingService.findOrCreatePatient.mockResolvedValue('existing-patient-1');
    mockBookingService.createBooking.mockResolvedValue({
      id: 'appt-2',
      scheduled_at: '2026-07-20T09:00:00.000Z',
      status: 'tentative',
    });

    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await bookingPOST(req);

    expect(res.status).toBe(201);
    // findOrCreatePatient returns existing id — no duplicate
    expect(mockBookingService.findOrCreatePatient).toHaveBeenCalledTimes(1);
    expect(mockBookingService.createBooking).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'existing-patient-1' })
    );
  });

  it('returns 409 when slot is no longer available (double booking)', async () => {
    mockBookingService.findOrCreatePatient.mockResolvedValue('patient-1');
    mockBookingService.createBooking.mockRejectedValue(new Error('Slot unavailable: overlap'));

    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await bookingPOST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toContain('no longer available');
  });

  it('returns 400 for invalid input', async () => {
    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...validBody, time: '25:99' }),
    });
    const res = await bookingPOST(req);

    expect(res.status).toBe(400);
    expect(mockBookingService.findOrCreatePatient).not.toHaveBeenCalled();
    expect(mockBookingService.createBooking).not.toHaveBeenCalled();
  });

  it('returns 400 for missing required fields', async () => {
    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clinic_id: '11111111-1111-1111-1111-111111111111' }),
    });
    const res = await bookingPOST(req);

    expect(res.status).toBe(400);
  });

  it('returns 404 when provider not found', async () => {
    mockBookingService.findOrCreatePatient.mockResolvedValue('patient-1');
    mockBookingService.createBooking.mockRejectedValue(new Error('Provider not found for this clinic'));

    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await bookingPOST(req);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Provider not found for this clinic');
  });

  it('returns 500 on internal error', async () => {
    mockBookingService.findOrCreatePatient.mockResolvedValue('patient-1');
    mockBookingService.createBooking.mockRejectedValue(new Error('DB down'));

    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await bookingPOST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('does not return sensitive patient data on success', async () => {
    mockBookingService.findOrCreatePatient.mockResolvedValue('patient-1');
    mockBookingService.createBooking.mockResolvedValue({
      id: 'appt-3',
      scheduled_at: '2026-07-20T09:00:00.000Z',
      status: 'tentative',
    });

    const req = makeRequest('http://localhost/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validBody),
    });
    const res = await bookingPOST(req);
    const body = await res.json();
    const raw = JSON.stringify(body);

    expect(raw).not.toContain('patient-1');
    expect(raw).not.toContain('John Doe');
    expect(raw).not.toContain('+15551234567');
    expect(raw).not.toContain('john@example.com');
  });
});