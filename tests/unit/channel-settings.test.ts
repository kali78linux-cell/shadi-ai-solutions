import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClinicCommunicationSettings, channelsForNotificationType, filterEnabledChannels } from '@/lib/communications/settings';
import { resolveChannelsForNotification } from '@/lib/communications/dispatcher';
import { NoopChannelProvider, ChannelType } from '@/lib/communications/channels/types';
import { SmsChannelAdapter, WhatsAppChannelAdapter, TelegramChannelAdapter } from '@/lib/communications/channels/adapters';

// Mock supabaseAdmin
const mockSupabaseAdmin = vi.hoisted(() => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockReturnThis(),
  },
}));
vi.mock('@/lib/supabase/admin', () => mockSupabaseAdmin);

vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

const CLINIC_A = '11111111-1111-1111-1111-111111111111';
const PATIENT = '44444444-4444-4444-4444-444444444444';

let mockCurrentTable: string = '';

function mockDb(settingsData: any, patientData: any) {
  mockSupabaseAdmin.supabaseAdmin.from.mockImplementation((table: string) => {
    mockCurrentTable = table;
    return mockSupabaseAdmin.supabaseAdmin;
  });
  mockSupabaseAdmin.supabaseAdmin.select.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
  mockSupabaseAdmin.supabaseAdmin.eq.mockReturnValue(mockSupabaseAdmin.supabaseAdmin);
  mockSupabaseAdmin.supabaseAdmin.maybeSingle.mockImplementation(() =>
    Promise.resolve({ data: mockCurrentTable === 'patients' ? patientData : settingsData, error: null })
  );
}

describe('Clinic communication settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns safe defaults when no settings row exists', async () => {
    mockDb(null, null);
    const settings = await getClinicCommunicationSettings(CLINIC_A);
    expect(settings.emailEnabled).toBe(true);
    expect(settings.smsEnabled).toBe(false);
    expect(settings.whatsappEnabled).toBe(false);
    expect(settings.telegramEnabled).toBe(false);
    expect(settings.reminderChannels).toEqual(['email']);
    expect(settings.confirmationChannels).toEqual(['email']);
    expect(settings.cancellationChannels).toEqual(['email']);
    expect(settings.defaultChannel).toBe('email');
  });

  it('is clinic-scoped (tenant isolation)', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true }, null);
    const settings = await getClinicCommunicationSettings(CLINIC_A);
    expect(settings.clinicId).toBe(CLINIC_A);
    expect(mockSupabaseAdmin.supabaseAdmin.eq).toHaveBeenCalledWith('clinic_id', CLINIC_A);
  });

  it('loads settings from the DB row', async () => {
    mockDb({
      clinic_id: CLINIC_A,
      email_enabled: true,
      sms_enabled: true,
      whatsapp_enabled: false,
      telegram_enabled: false,
      reminder_channels: ['email', 'sms'],
      confirmation_channels: ['email'],
      cancellation_channels: ['email'],
      default_channel: 'email',
    }, null);
    const settings = await getClinicCommunicationSettings(CLINIC_A);
    expect(settings.smsEnabled).toBe(true);
    expect(settings.reminderChannels).toEqual(['email', 'sms']);
  });

  it('routes channels by notification type', () => {
    const settings = {
      clinicId: CLINIC_A,
      emailEnabled: true,
      smsEnabled: true,
      whatsappEnabled: true,
      telegramEnabled: false,
      reminderChannels: ['email', 'sms'] as ChannelType[],
      confirmationChannels: ['whatsapp'] as ChannelType[],
      cancellationChannels: ['email'] as ChannelType[],
      defaultChannel: 'email' as ChannelType,
      remindersEnabled: true,
      reminderOffsetMinutes1: 1440,
      reminderOffsetMinutes2: 120,
      confirmationNotifications: true,
      cancellationNotifications: true,
      reschedulingNotifications: true,
      notificationLanguage: 'ar',
    };
    expect(channelsForNotificationType(settings, 'appointment_reminder')).toEqual(['email', 'sms']);
    expect(channelsForNotificationType(settings, 'appointment_confirmation')).toEqual(['whatsapp']);
    expect(channelsForNotificationType(settings, 'appointment_cancellation')).toEqual(['email']);
  });

  it('falls back to default channel when type has no explicit routing', () => {
    const settings = {
      clinicId: CLINIC_A,
      emailEnabled: true,
      smsEnabled: false,
      whatsappEnabled: false,
      telegramEnabled: false,
      reminderChannels: [] as ChannelType[],
      confirmationChannels: [] as ChannelType[],
      cancellationChannels: [] as ChannelType[],
      defaultChannel: 'email' as ChannelType,
      remindersEnabled: true,
      reminderOffsetMinutes1: 1440,
      reminderOffsetMinutes2: 120,
      confirmationNotifications: true,
      cancellationNotifications: true,
      reschedulingNotifications: true,
      notificationLanguage: 'ar',
    };
    expect(channelsForNotificationType(settings, 'appointment_reminder')).toEqual(['email']);
  });

  it('filters out disabled channels', () => {
    const settings = {
      clinicId: CLINIC_A,
      emailEnabled: true,
      smsEnabled: false,
      whatsappEnabled: true,
      telegramEnabled: false,
      reminderChannels: [] as ChannelType[],
      confirmationChannels: [] as ChannelType[],
      cancellationChannels: [] as ChannelType[],
      defaultChannel: 'email' as ChannelType,
      remindersEnabled: true,
      reminderOffsetMinutes1: 1440,
      reminderOffsetMinutes2: 120,
      confirmationNotifications: true,
      cancellationNotifications: true,
      reschedulingNotifications: true,
      notificationLanguage: 'ar',
    };
    expect(filterEnabledChannels(settings, ['email', 'sms', 'whatsapp'])).toEqual(['email', 'whatsapp']);
  });
});

describe('resolveChannelsForNotification (dispatcher channel selection)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects email when email enabled + patient has email', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true, confirmation_channels: ['email'] }, { id: PATIENT, email: 'a@b.com', phone_number: '+123' });
    const channels = await resolveChannelsForNotification({ id: 'n1', clinic_id: CLINIC_A, patient_id: PATIENT, type: 'appointment_confirmation' });
    expect(channels).toEqual(['email']);
  });

  it('selects sms when sms enabled + patient has phone', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true, sms_enabled: true, confirmation_channels: ['email', 'sms'] }, { id: PATIENT, email: 'a@b.com', phone_number: '+123' });
    const channels = await resolveChannelsForNotification({ id: 'n1', clinic_id: CLINIC_A, patient_id: PATIENT, type: 'appointment_confirmation' });
    expect(channels).toEqual(['email', 'sms']);
  });

  it('excludes disabled channel', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true, sms_enabled: false, confirmation_channels: ['email', 'sms'] }, { id: PATIENT, email: 'a@b.com', phone_number: '+123' });
    const channels = await resolveChannelsForNotification({ id: 'n1', clinic_id: CLINIC_A, patient_id: PATIENT, type: 'appointment_confirmation' });
    expect(channels).toEqual(['email']);
  });

  it('excludes email when patient has no email', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true, confirmation_channels: ['email'] }, { id: PATIENT, email: '', phone_number: null });
    const channels = await resolveChannelsForNotification({ id: 'n1', clinic_id: CLINIC_A, patient_id: PATIENT, type: 'appointment_confirmation' });
    expect(channels).toEqual([]);
  });

  it('excludes telegram when no telegram identifier', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true, telegram_enabled: true, confirmation_channels: ['email', 'telegram'] }, { id: PATIENT, email: 'a@b.com', phone_number: '+123' });
    const channels = await resolveChannelsForNotification({ id: 'n1', clinic_id: CLINIC_A, patient_id: PATIENT, type: 'appointment_confirmation' });
    expect(channels).toEqual(['email']);
  });

  it('does not duplicate channels', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true, sms_enabled: true, whatsapp_enabled: true, confirmation_channels: ['email', 'sms', 'sms', 'whatsapp'] }, { id: PATIENT, email: 'a@b.com', phone_number: '+123' });
    const channels = await resolveChannelsForNotification({ id: 'n1', clinic_id: CLINIC_A, patient_id: PATIENT, type: 'appointment_confirmation' });
    expect(channels).toEqual(['email', 'sms', 'whatsapp']);
  });

  it('returns empty when patient not found', async () => {
    mockDb({ clinic_id: CLINIC_A, email_enabled: true, confirmation_channels: ['email'] }, null);
    const channels = await resolveChannelsForNotification({ id: 'n1', clinic_id: CLINIC_A, patient_id: PATIENT, type: 'appointment_confirmation' });
    expect(channels).toEqual([]);
  });
});

describe('Non-email channel adapters', () => {
  it('provide noop/console implementations without real credentials', async () => {
    expect(new NoopChannelProvider('sms').name).toBe('noop-sms');
    expect(new SmsChannelAdapter({}).name).toBe('sms');
    expect(new WhatsAppChannelAdapter({}).name).toBe('whatsapp');
    expect(new TelegramChannelAdapter({}).name).toBe('telegram');
  });
});