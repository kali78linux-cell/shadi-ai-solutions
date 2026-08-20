import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createBooking, confirmPublicBooking, cancelPublicBooking } from '@/lib/services/bookingService';

// Mock dependencies
const mockSupabaseAdmin = vi.hoisted(() => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
  },
}));
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockReminderEngine = vi.hoisted(() => ({
  createAppointmentReminders: vi.fn(),
  cancelAppointmentReminders: vi.fn(),
}));
vi.mock('@/lib/services/reminderEngine', () => mockReminderEngine);

const mockScheduling = vi.hoisted(() => ({
  checkSlotAvailability: vi.fn(),
  suggestFreeSlots: vi.fn(),
}));
vi.mock('@/lib/services/scheduling', () => mockScheduling);

const CLINIC = '11111111-1111-1111-1111-111111111111';
const PROVIDER = '33333333-3333-3333-3333-333333333333';
const PATIENT = '44444444-4444-4444-4444-444444444444';
const APPT = '55555555-5555-5555-5555-555555555555';
const TOKEN = 'a'.repeat(64);

function mockAppointmentRow(overrides: Record<string, unknown> = {}) {
  return { id: APPT, scheduled_at: '2026-07-20T09:00:00.000Z', status: 'tentative', ...overrides };
}

describe('Booking communications integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScheduling.checkSlotAvailability.mockReturnValue({ available: true, reason: null });
    mockScheduling.suggestFreeSlots.mockReturnValue(['2026-07-20T09:00:00.000Z']);
    mockSupabaseAdmin.supabaseAdmin.from.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.select.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({ data: mockAppointmentRow(), error: null });
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({ data: null, error: null });
    mockSupabaseAdmin.supabaseAdmin.insert.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.update.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.eq.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.ilike.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.limit.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.order.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.in.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
  });

  it('schedules appointment reminders on successful booking (acknowledgement)', async () => {
    mockReminderEngine.createAppointmentReminders.mockResolvedValue([{ id: 'rem-1' }]);

    const result = await createBooking({
      clinicId: CLINIC,
      providerId: PROVIDER,
      service: 'Cleaning',
      date: '2026-07-20',
      time: '09:00',
      patientId: PATIENT,
    });

    expect(result.status).toBe('tentative');
    expect(mockReminderEngine.createAppointmentReminders).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: CLINIC,
      appointmentId: APPT,
      scheduledAt: '2026-07-20T09:00:00.000Z',
      channels: ['email', 'sms'],
      patientId: PATIENT,
    }));
    expect(mockLogging.logEvent).toHaveBeenCalledWith('booking_acknowledgement_scheduled', expect.any(Object));
  });

  it('does not fail the booking when reminder scheduling fails', async () => {
    mockReminderEngine.createAppointmentReminders.mockRejectedValue(new Error('SMS provider down'));

    const result = await createBooking({
      clinicId: CLINIC,
      providerId: PROVIDER,
      service: 'Cleaning',
      date: '2026-07-20',
      time: '09:00',
      patientId: PATIENT,
    });

    expect(result.status).toBe('tentative');
    expect(mockLogging.logEvent).toHaveBeenCalledWith('booking_acknowledgement_failure', expect.objectContaining({
      clinic_id: CLINIC,
      appointment_id: APPT,
    }), 'error');
  });

  it('does not create duplicate reminders (dedupe by appointment)', async () => {
    mockReminderEngine.createAppointmentReminders.mockResolvedValue([]);

    await createBooking({
      clinicId: CLINIC,
      providerId: PROVIDER,
      service: 'Cleaning',
      date: '2026-07-20',
      time: '09:00',
      patientId: PATIENT,
    });

    expect(mockReminderEngine.createAppointmentReminders).toHaveBeenCalledTimes(1);
  });

  it('triggers confirmation communication on confirm', async () => {
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({
      data: { id: APPT, status: 'tentative' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({
      data: { id: APPT, status: 'confirmed' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.insert.mockResolvedValue({ data: null, error: null });

    const result = await confirmPublicBooking({ clinicId: CLINIC, appointmentId: APPT, token: TOKEN });

    expect(result.status).toBe('confirmed');
    expect(mockSupabaseAdmin.supabaseAdmin.from).toHaveBeenCalledWith('notifications');
    expect(mockLogging.logEvent).toHaveBeenCalledWith('booking_confirmation_communication_scheduled', expect.any(Object));
  });

  it('does not fail confirmation when communication fails', async () => {
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({
      data: { id: APPT, status: 'tentative' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({
      data: { id: APPT, status: 'confirmed' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.insert.mockRejectedValue(new Error('Email provider down'));

    const result = await confirmPublicBooking({ clinicId: CLINIC, appointmentId: APPT, token: TOKEN });

    expect(result.status).toBe('confirmed');
    expect(mockLogging.logEvent).toHaveBeenCalledWith('booking_confirmation_communication_failure', expect.any(Object), 'error');
  });

  it('cancels pending reminders on cancellation', async () => {
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({
      data: { id: APPT, status: 'confirmed' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({
      data: { id: APPT, status: 'cancelled' },
      error: null,
    });
    mockReminderEngine.cancelAppointmentReminders.mockResolvedValue([{ id: 'rem-1' }]);

    const result = await cancelPublicBooking({ clinicId: CLINIC, appointmentId: APPT, token: TOKEN });

    expect(result.status).toBe('cancelled');
    expect(mockReminderEngine.cancelAppointmentReminders).toHaveBeenCalledWith(expect.objectContaining({
      clinicId: CLINIC,
      appointmentId: APPT,
    }));
    expect(mockLogging.logEvent).toHaveBeenCalledWith('booking_cancellation_reminders_cancelled', expect.any(Object));
  });

  it('does not fail cancellation when reminder cancellation fails', async () => {
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({
      data: { id: APPT, status: 'confirmed' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({
      data: { id: APPT, status: 'cancelled' },
      error: null,
    });
    mockReminderEngine.cancelAppointmentReminders.mockRejectedValue(new Error('DB down'));

    const result = await cancelPublicBooking({ clinicId: CLINIC, appointmentId: APPT, token: TOKEN });

    expect(result.status).toBe('cancelled');
    expect(mockLogging.logEvent).toHaveBeenCalledWith('booking_cancellation_reminder_cancel_failure', expect.any(Object), 'error');
  });

  it('keeps communications clinic-scoped (tenant isolation)', async () => {
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({
      data: { id: APPT, status: 'tentative' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({
      data: { id: APPT, status: 'confirmed' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.insert.mockResolvedValue({ data: null, error: null });

    await confirmPublicBooking({ clinicId: CLINIC, appointmentId: APPT, token: TOKEN });

    // The notification insert must be scoped to the clinic
    const insertCall = mockSupabaseAdmin.supabaseAdmin.insert.mock.calls[0][0];
    expect(insertCall.clinic_id).toBe(CLINIC);
    expect(insertCall.appointment_id).toBe(APPT);
  });

  it('does not leak booking token in communication payloads', async () => {
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({
      data: { id: APPT, status: 'tentative' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({
      data: { id: APPT, status: 'confirmed' },
      error: null,
    });
    mockSupabaseAdmin.supabaseAdmin.insert.mockResolvedValue({ data: null, error: null });

    await confirmPublicBooking({ clinicId: CLINIC, appointmentId: APPT, token: TOKEN });

    const insertCall = mockSupabaseAdmin.supabaseAdmin.insert.mock.calls[0][0];
    const raw = JSON.stringify(insertCall);
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain('booking_token');
  });
});

describe('Provider/Service assignment enforcement in booking', () => {
  const SERVICE = '66666666-6666-6666-6666-666666666666';

  beforeEach(() => {
    vi.clearAllMocks();
    mockScheduling.checkSlotAvailability.mockReturnValue({ available: true, reason: null });
    mockScheduling.suggestFreeSlots.mockReturnValue(['2026-07-20T09:00:00.000Z']);
    mockSupabaseAdmin.supabaseAdmin.from.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.select.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValue({ data: mockAppointmentRow(), error: null });
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({ data: null, error: null });
    mockSupabaseAdmin.supabaseAdmin.insert.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.update.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.eq.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.ilike.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.limit.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.order.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
    mockSupabaseAdmin.supabaseAdmin.in.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
  });

  it('rejects booking when provider is not assigned to the service', async () => {
    // provider_services query returns no row (not assigned)
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(createBooking({
      clinicId: CLINIC,
      providerId: PROVIDER,
      service: 'Cleaning',
      serviceId: SERVICE,
      date: '2026-07-20',
      time: '09:00',
      patientId: PATIENT,
    })).rejects.toThrow('Provider is not assigned to this service');
  });

  it('allows booking when provider is assigned to the service', async () => {
    // provider_services query returns a row (assigned)
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({ data: { id: 'link-1' }, error: null });

    const result = await createBooking({
      clinicId: CLINIC,
      providerId: PROVIDER,
      service: 'Cleaning',
      serviceId: SERVICE,
      date: '2026-07-20',
      time: '09:00',
      patientId: PATIENT,
    });

    expect(result.status).toBe('tentative');
  });

  it('falls back to allowing booking when provider_services table does not exist', async () => {
    // provider_services query errors (table missing) — fall back to allowing
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({ data: null, error: { message: 'relation does not exist' } });

    const result = await createBooking({
      clinicId: CLINIC,
      providerId: PROVIDER,
      service: 'Cleaning',
      serviceId: SERVICE,
      date: '2026-07-20',
      time: '09:00',
      patientId: PATIENT,
    });

    expect(result.status).toBe('tentative');
  });

  it('handles unique constraint violation (concurrent booking race condition)', async () => {
    // provider_services query returns a row (assigned)
    mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockResolvedValue({ data: { id: 'link-1' }, error: null });
    // Provider lookup succeeds (first single call)
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValueOnce({ data: { id: PROVIDER, name: 'Dr. Smith' }, error: null });
    // Service lookup succeeds (second single call)
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValueOnce({ data: { id: SERVICE, name: 'Cleaning', duration_minutes: 30 }, error: null });
    // Insert fails with unique constraint violation (code 23505) — third single call
    mockSupabaseAdmin.supabaseAdmin.single.mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });

    await expect(createBooking({
      clinicId: CLINIC,
      providerId: PROVIDER,
      service: 'Cleaning',
      serviceId: SERVICE,
      date: '2026-07-20',
      time: '09:00',
      patientId: PATIENT,
    })).rejects.toThrow('Slot unavailable: concurrent booking');
  });
});
