import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as confirmPOST } from '@/app/api/booking/confirm/route';
import { POST as cancelPOST } from '@/app/api/booking/cancel/route';

// Mock bookingService
const mockBookingService = vi.hoisted(() => ({
  confirmPublicBooking: vi.fn(),
  cancelPublicBooking: vi.fn(),
}));
vi.mock('@/lib/services/bookingService', () => mockBookingService);

// Mock logging
const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

function makeRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const CLINIC = '11111111-1111-1111-1111-111111111111';
const OTHER_CLINIC = '22222222-2222-2222-2222-222222222222';
const APPT = '33333333-3333-3333-3333-333333333333';
const TOKEN = 'a'.repeat(64);

const validBody = { clinic_id: CLINIC, appointment_id: APPT, token: TOKEN };

describe('POST /api/booking/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('confirms a tentative booking with a valid token', async () => {
    mockBookingService.confirmPublicBooking.mockResolvedValue({ id: APPT, status: 'confirmed' });

    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: APPT, status: 'confirmed' });
    expect(mockBookingService.confirmPublicBooking).toHaveBeenCalledWith({
      clinicId: CLINIC,
      appointmentId: APPT,
      token: TOKEN,
    });
  });

  it('returns 404 for invalid token (appointment not found)', async () => {
    mockBookingService.confirmPublicBooking.mockRejectedValue(new Error('Appointment not found'));

    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', validBody));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Appointment not found');
  });

  it('returns 409 when already confirmed', async () => {
    mockBookingService.confirmPublicBooking.mockRejectedValue(new Error('Appointment already confirmed'));

    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', validBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Appointment already confirmed');
  });

  it('returns 409 when appointment cannot be confirmed (e.g. cancelled)', async () => {
    mockBookingService.confirmPublicBooking.mockRejectedValue(new Error('Appointment cannot be confirmed'));

    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', validBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Appointment cannot be confirmed');
  });

  it('returns 400 for missing token', async () => {
    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', { clinic_id: CLINIC, appointment_id: APPT }));
    expect(res.status).toBe(400);
    expect(mockBookingService.confirmPublicBooking).not.toHaveBeenCalled();
  });

  it('returns 400 for short token', async () => {
    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', { ...validBody, token: 'short' }));
    expect(res.status).toBe(400);
    expect(mockBookingService.confirmPublicBooking).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid clinic_id', async () => {
    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', { ...validBody, clinic_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(mockBookingService.confirmPublicBooking).not.toHaveBeenCalled();
  });

  it('returns 500 on internal error', async () => {
    mockBookingService.confirmPublicBooking.mockRejectedValue(new Error('DB down'));

    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', validBody));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('does not expose sensitive data on success', async () => {
    mockBookingService.confirmPublicBooking.mockResolvedValue({ id: APPT, status: 'confirmed' });

    const res = await confirmPOST(makeRequest('http://localhost/api/booking/confirm', validBody));
    const body = await res.json();
    const raw = JSON.stringify(body);

    expect(raw).not.toContain('patient');
    expect(raw).not.toContain('phone');
    expect(raw).not.toContain('email');
    expect(raw).not.toContain('booking_token');
  });
});

describe('POST /api/booking/cancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('cancels a tentative booking with a valid token', async () => {
    mockBookingService.cancelPublicBooking.mockResolvedValue({ id: APPT, status: 'cancelled' });

    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual({ id: APPT, status: 'cancelled' });
    expect(mockBookingService.cancelPublicBooking).toHaveBeenCalledWith({
      clinicId: CLINIC,
      appointmentId: APPT,
      token: TOKEN,
    });
  });

  it('cancels a confirmed booking with a valid token', async () => {
    mockBookingService.cancelPublicBooking.mockResolvedValue({ id: APPT, status: 'cancelled' });

    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', validBody));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('cancelled');
  });

  it('returns 404 for invalid token (appointment not found)', async () => {
    mockBookingService.cancelPublicBooking.mockRejectedValue(new Error('Appointment not found'));

    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', validBody));
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe('Appointment not found');
  });

  it('returns 409 when already cancelled', async () => {
    mockBookingService.cancelPublicBooking.mockRejectedValue(new Error('Appointment already cancelled'));

    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', validBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Appointment already cancelled');
  });

  it('returns 409 when appointment cannot be cancelled', async () => {
    mockBookingService.cancelPublicBooking.mockRejectedValue(new Error('Appointment cannot be cancelled'));

    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', validBody));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe('Appointment cannot be cancelled');
  });

  it('returns 400 for missing token', async () => {
    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', { clinic_id: CLINIC, appointment_id: APPT }));
    expect(res.status).toBe(400);
    expect(mockBookingService.cancelPublicBooking).not.toHaveBeenCalled();
  });

  it('returns 400 for short token', async () => {
    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', { ...validBody, token: 'short' }));
    expect(res.status).toBe(400);
    expect(mockBookingService.cancelPublicBooking).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid appointment_id', async () => {
    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', { ...validBody, appointment_id: 'not-a-uuid' }));
    expect(res.status).toBe(400);
    expect(mockBookingService.cancelPublicBooking).not.toHaveBeenCalled();
  });

  it('returns 500 on internal error', async () => {
    mockBookingService.cancelPublicBooking.mockRejectedValue(new Error('DB down'));

    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', validBody));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe('Internal server error');
  });

  it('does not expose sensitive data on success', async () => {
    mockBookingService.cancelPublicBooking.mockResolvedValue({ id: APPT, status: 'cancelled' });

    const res = await cancelPOST(makeRequest('http://localhost/api/booking/cancel', validBody));
    const body = await res.json();
    const raw = JSON.stringify(body);

    expect(raw).not.toContain('patient');
    expect(raw).not.toContain('phone');
    expect(raw).not.toContain('email');
    expect(raw).not.toContain('booking_token');
  });
});