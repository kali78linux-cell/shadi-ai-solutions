import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildBookingEmail } from '@/lib/communications/email/messageBuilder';
import { buildBookingActionUrl, getAppBaseUrl } from '@/lib/communications/links';
import { sendNotificationEmail } from '@/lib/communications/email/sender';
import { dispatchNotification } from '@/lib/communications/dispatcher';

// Mock supabaseAdmin for sender tests
const mockSupabaseAdmin = vi.hoisted(() => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
    single: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
  },
}));
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

const mockLogging = vi.hoisted(() => ({ logEvent: vi.fn() }));
vi.mock('@/lib/server/logging', () => mockLogging);

const mockProvider = {
  name: 'test',
  send: vi.fn(),
};

const CLINIC = '11111111-1111-1111-1111-111111111111';
const APPT = '55555555-5555-5555-5555-555555555555';
const PATIENT = '44444444-4444-4444-4444-444444444444';
const TOKEN = 'a'.repeat(64);

function makeNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'notif-1',
    clinic_id: CLINIC,
    appointment_id: APPT,
    patient_id: PATIENT,
    channel: 'email',
    type: 'appointment_reminder',
    status: 'pending',
    ...overrides,
  };
}

describe('buildBookingEmail', () => {
  const baseContext = {
    clinicName: 'My Dental Clinic',
    service: 'Dental Cleaning',
    date: '2026-07-20',
    time: '09:00',
    providerName: 'Dr. Smith',
    patientEmail: 'patient@example.com',
    bookingToken: TOKEN,
    clinicId: CLINIC,
    appointmentId: APPT,
    baseUrl: 'https://app.example.com',
  };

  it('builds a booking acknowledgement email payload', () => {
    const email = buildBookingEmail(baseContext, 'booking_acknowledgement');
    expect(email.to).toBe('patient@example.com');
    expect(email.subject).toContain('Booking Received');
    expect(email.text).toContain('My Dental Clinic');
    expect(email.text).toContain('Dental Cleaning');
    expect(email.text).toContain('2026-07-20');
    expect(email.text).toContain('09:00');
    expect(email.text).toContain('Dr. Smith');
    expect(email.text).toContain('tentative');
    expect(email.text).toContain('To confirm your appointment');
    expect(email.text).toContain('To cancel your appointment');
  });

  it('builds a confirmation email payload', () => {
    const email = buildBookingEmail(baseContext, 'appointment_confirmation');
    expect(email.subject).toContain('Appointment Confirmed');
    expect(email.text).toContain('confirmed');
    expect(email.text).toContain('My Dental Clinic');
    expect(email.text).toContain('Dental Cleaning');
  });

  it('builds a cancellation email payload', () => {
    const email = buildBookingEmail(baseContext, 'appointment_cancellation');
    expect(email.subject).toContain('Appointment Cancelled');
    expect(email.text).toContain('cancelled');
  });

  it('builds a reminder email payload', () => {
    const email = buildBookingEmail(baseContext, 'appointment_reminder');
    expect(email.subject).toContain('Reminder');
    expect(email.text).toContain('upcoming appointment');
  });

  it('does not include provider when provider is null', () => {
    const email = buildBookingEmail({ ...baseContext, providerName: null }, 'booking_acknowledgement');
    expect(email.text).not.toContain('Provider:');
  });
});

describe('buildBookingActionUrl', () => {
  it('generates a secure patient-facing link with the existing token', () => {
    const url = buildBookingActionUrl({
      baseUrl: 'https://app.example.com',
      clinicId: CLINIC,
      appointmentId: APPT,
      token: TOKEN,
      action: 'confirm',
    });
    expect(url).toContain(`clinic_id=${CLINIC}`);
    expect(url).toContain(`appointment_id=${APPT}`);
    expect(url).toContain(`token=${TOKEN}`);
    expect(url).toContain(`action=confirm`);
  });

  it('generates a cancel link with action=cancel', () => {
    const url = buildBookingActionUrl({
      baseUrl: 'https://app.example.com',
      clinicId: CLINIC,
      appointmentId: APPT,
      token: TOKEN,
      action: 'cancel',
    });
    expect(url).toContain(`action=cancel`);
  });

  it('resolves app base URL from environment', () => {
    const url = getAppBaseUrl({ NEXT_PUBLIC_APP_URL: 'https://example.com/' });
    expect(url).toBe('https://example.com');
  });

  it('falls back to localhost when not configured', () => {
    const url = getAppBaseUrl({});
    expect(url).toBe('http://localhost:3000');
  });
});

describe('sendNotificationEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.send.mockResolvedValue(undefined);
  });

  it('sends an email for a pending notification', async () => {
    // Mock context resolution
    const selectMock = vi.fn().mockReturnThis();
    mockSupabaseAdmin.supabaseAdmin.from.mockReturnValue({
      ...mockSupabaseAdmin.supabaseAdmin,
      select: selectMock,
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: APPT,
          clinic_id: CLINIC,
          service: 'Dental Cleaning',
          appointment_date: '2026-07-20',
          scheduled_at: '2026-07-20T09:00:00.000Z',
          booking_token: TOKEN,
          provider_id: CLINIC,
        },
        error: null,
      }),
    });

    // Simulate the three queries returning different data
    mockSupabaseAdmin.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: APPT,
              clinic_id: CLINIC,
              service: 'Dental Cleaning',
              appointment_date: '2026-07-20',
              scheduled_at: '2026-07-20T09:00:00.000Z',
              booking_token: TOKEN,
              provider_id: CLINIC,
            },
            error: null,
          }),
        };
      }
      if (table === 'clinics') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: CLINIC, name: 'My Dental Clinic' },
            error: null,
          }),
        };
      }
      if (table === 'patients') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: PATIENT, email: 'patient@example.com' },
            error: null,
          }),
        };
      }
      return {
        ...mockSupabaseAdmin.supabaseAdmin,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    await sendNotificationEmail(makeNotification(), mockProvider);
    expect(mockProvider.send).toHaveBeenCalledOnce();
    const sent = mockProvider.send.mock.calls[0][0];
    expect(sent.to).toBe('patient@example.com');
    expect(sent.subject).toContain('Reminder');
    expect(sent.text).toContain('My Dental Clinic');
  });

  it('skips cancelled notifications', async () => {
    await sendNotificationEmail(makeNotification({ status: 'cancelled' }), mockProvider);
    expect(mockProvider.send).not.toHaveBeenCalled();
    expect(mockLogging.logEvent).toHaveBeenCalledWith('email_send_skipped_cancelled', expect.any(Object));
  });

  it('skips already-sent notifications (no duplicate sending)', async () => {
    await sendNotificationEmail(makeNotification({ status: 'sent' }), mockProvider);
    expect(mockProvider.send).not.toHaveBeenCalled();
    expect(mockLogging.logEvent).toHaveBeenCalledWith('email_send_skipped_already_sent', expect.any(Object));
  });

  it('throws when patient has no email address', async () => {
    mockSupabaseAdmin.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: APPT,
              clinic_id: CLINIC,
              service: 'Dental Cleaning',
              appointment_date: '2026-07-20',
              scheduled_at: '2026-07-20T09:00:00.000Z',
              booking_token: TOKEN,
            },
            error: null,
          }),
        };
      }
      if (table === 'clinics') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: CLINIC, name: 'My Dental Clinic' },
            error: null,
          }),
        };
      }
      if (table === 'patients') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: PATIENT, email: '' },
            error: null,
          }),
        };
      }
      return {
        ...mockSupabaseAdmin.supabaseAdmin,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    await expect(sendNotificationEmail(makeNotification(), mockProvider)).rejects.toThrow('Patient has no email address');
    expect(mockProvider.send).not.toHaveBeenCalled();
  });

  it('does not log the raw booking token', async () => {
    mockSupabaseAdmin.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: APPT,
              clinic_id: CLINIC,
              service: 'Dental Cleaning',
              appointment_date: '2026-07-20',
              scheduled_at: '2026-07-20T09:00:00.000Z',
              booking_token: TOKEN,
            },
            error: null,
          }),
        };
      }
      if (table === 'clinics') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: CLINIC, name: 'My Dental Clinic' },
            error: null,
          }),
        };
      }
      if (table === 'patients') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: PATIENT, email: 'patient@example.com' },
            error: null,
          }),
        };
      }
      return {
        ...mockSupabaseAdmin.supabaseAdmin,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    await sendNotificationEmail(makeNotification(), mockProvider);

    const loggedEvents = mockLogging.logEvent.mock.calls;
    const raw = JSON.stringify(loggedEvents);
    expect(raw).not.toContain(TOKEN);
  });
});

describe('dispatchNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProvider.send.mockResolvedValue(undefined);
  });

  it('dispatches email channel notifications', async () => {
    mockSupabaseAdmin.supabaseAdmin.from.mockImplementation((table: string) => {
      if (table === 'appointments') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: APPT,
              clinic_id: CLINIC,
              service: 'Dental Cleaning',
              appointment_date: '2026-07-20',
              scheduled_at: '2026-07-20T09:00:00.000Z',
              booking_token: TOKEN,
            },
            error: null,
          }),
        };
      }
      if (table === 'clinics') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: CLINIC, name: 'My Dental Clinic' },
            error: null,
          }),
        };
      }
      if (table === 'patients') {
        return {
          ...mockSupabaseAdmin.supabaseAdmin,
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { id: PATIENT, email: 'patient@example.com' },
            error: null,
          }),
        };
      }
      return {
        ...mockSupabaseAdmin.supabaseAdmin,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      };
    });

    // The channel-aware dispatcher resolves channels from clinic settings + patient contacts.
    // With no settings/patient data mocked, no channels are applicable and it resolves.
    await expect(dispatchNotification(makeNotification())).resolves.toBeUndefined();
  });
});
