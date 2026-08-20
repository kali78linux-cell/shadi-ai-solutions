import { supabaseAdmin } from '@/lib/supabase/admin';
import { ChannelType, NotificationType } from './channels/types';

/**
 * Clinic communication settings — DB-backed, clinic-scoped, RLS protected.
 * No provider secrets are stored in the DB.
 */

export interface ClinicCommunicationSettings {
  clinicId: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  whatsappEnabled: boolean;
  telegramEnabled: boolean;
  reminderChannels: ChannelType[];
  confirmationChannels: ChannelType[];
  cancellationChannels: ChannelType[];
  defaultChannel: ChannelType;
  remindersEnabled: boolean;
  reminderOffsetMinutes1: number;
  reminderOffsetMinutes2: number | null;
  confirmationNotifications: boolean;
  cancellationNotifications: boolean;
  reschedulingNotifications: boolean;
  notificationLanguage: string;
}

const DEFAULT_SETTINGS: Omit<ClinicCommunicationSettings, 'clinicId'> = {
  emailEnabled: true,
  smsEnabled: false,
  whatsappEnabled: false,
  telegramEnabled: false,
  reminderChannels: ['email'],
  confirmationChannels: ['email'],
  cancellationChannels: ['email'],
  defaultChannel: 'email',
  remindersEnabled: true,
  reminderOffsetMinutes1: 1440,
  reminderOffsetMinutes2: 120,
  confirmationNotifications: true,
  cancellationNotifications: true,
  reschedulingNotifications: true,
  notificationLanguage: 'ar',
};

const VALID_CHANNELS: ChannelType[] = ['email', 'sms', 'whatsapp', 'telegram'];

function normalizeChannels(value: unknown): ChannelType[] {
  if (!Array.isArray(value)) return ['email'];
  return (value as string[])
    .filter((c): c is ChannelType => VALID_CHANNELS.includes(c as ChannelType))
    .filter((c, i, arr) => arr.indexOf(c) === i);
}

function normalizeChannel(value: unknown): ChannelType {
  return VALID_CHANNELS.includes(value as ChannelType) ? (value as ChannelType) : 'email';
}

/**
 * Loads a clinic's communication settings from the DB.
 * Falls back to safe defaults if no row exists.
 * Clinic-scoped — never returns another clinic's settings.
 */
export async function getClinicCommunicationSettings(clinicId: string): Promise<ClinicCommunicationSettings> {
  const { data, error } = await supabaseAdmin
    .from('clinic_communication_settings')
    .select('*')
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (error || !data) {
    return { clinicId, ...DEFAULT_SETTINGS };
  }

  return {
    clinicId,
    emailEnabled: data.email_enabled ?? true,
    smsEnabled: data.sms_enabled ?? false,
    whatsappEnabled: data.whatsapp_enabled ?? false,
    telegramEnabled: data.telegram_enabled ?? false,
    reminderChannels: normalizeChannels(data.reminder_channels),
    confirmationChannels: normalizeChannels(data.confirmation_channels),
    cancellationChannels: normalizeChannels(data.cancellation_channels),
    defaultChannel: normalizeChannel(data.default_channel),
    remindersEnabled: data.reminders_enabled ?? true,
    reminderOffsetMinutes1: data.reminder_offset_minutes_1 ?? 1440,
    reminderOffsetMinutes2: data.reminder_offset_minutes_2 ?? 120,
    confirmationNotifications: data.confirmation_notifications ?? true,
    cancellationNotifications: data.cancellation_notifications ?? true,
    reschedulingNotifications: data.rescheduling_notifications ?? true,
    notificationLanguage: data.notification_language ?? 'ar',
  };
}

/**
 * Validates and normalizes a partial settings payload into a full settings object.
 * Throws on invalid channel values or an invalid default channel.
 */
export function validateAndNormalizeSettings(
  clinicId: string,
  input: Partial<ClinicCommunicationSettings>
): ClinicCommunicationSettings {
  const base = { clinicId, ...DEFAULT_SETTINGS };

  const emailEnabled = typeof input.emailEnabled === 'boolean' ? input.emailEnabled : base.emailEnabled;
  const smsEnabled = typeof input.smsEnabled === 'boolean' ? input.smsEnabled : base.smsEnabled;
  const whatsappEnabled = typeof input.whatsappEnabled === 'boolean' ? input.whatsappEnabled : base.whatsappEnabled;
  const telegramEnabled = typeof input.telegramEnabled === 'boolean' ? input.telegramEnabled : base.telegramEnabled;

  const reminderChannels = normalizeChannels(input.reminderChannels ?? base.reminderChannels);
  const confirmationChannels = normalizeChannels(input.confirmationChannels ?? base.confirmationChannels);
  const cancellationChannels = normalizeChannels(input.cancellationChannels ?? base.cancellationChannels);

  const defaultChannel = normalizeChannel(input.defaultChannel ?? base.defaultChannel);

  const remindersEnabled = typeof input.remindersEnabled === 'boolean' ? input.remindersEnabled : base.remindersEnabled;
  const reminderOffsetMinutes1 = typeof input.reminderOffsetMinutes1 === 'number' && input.reminderOffsetMinutes1 > 0 ? input.reminderOffsetMinutes1 : base.reminderOffsetMinutes1;
  const reminderOffsetMinutes2 = typeof input.reminderOffsetMinutes2 === 'number' && input.reminderOffsetMinutes2 > 0 ? input.reminderOffsetMinutes2 : null;
  const confirmationNotifications = typeof input.confirmationNotifications === 'boolean' ? input.confirmationNotifications : base.confirmationNotifications;
  const cancellationNotifications = typeof input.cancellationNotifications === 'boolean' ? input.cancellationNotifications : base.cancellationNotifications;
  const reschedulingNotifications = typeof input.reschedulingNotifications === 'boolean' ? input.reschedulingNotifications : base.reschedulingNotifications;
  const notificationLanguage = typeof input.notificationLanguage === 'string' && ['ar', 'en'].includes(input.notificationLanguage) ? input.notificationLanguage : base.notificationLanguage;

  return {
    clinicId,
    emailEnabled,
    smsEnabled,
    whatsappEnabled,
    telegramEnabled,
    reminderChannels,
    confirmationChannels,
    cancellationChannels,
    defaultChannel,
    remindersEnabled,
    reminderOffsetMinutes1,
    reminderOffsetMinutes2,
    confirmationNotifications,
    cancellationNotifications,
    reschedulingNotifications,
    notificationLanguage,
  };
}

/**
 * Saves a clinic's communication settings (upsert).
 * Clinic-scoped — the clinic_id is always forced from the authenticated caller,
 * so a clinic can never write to another clinic's settings.
 * No provider secrets are stored.
 */
export async function saveClinicCommunicationSettings(settings: ClinicCommunicationSettings): Promise<ClinicCommunicationSettings> {
  const { clinicId, ...rest } = settings;

  const { data, error } = await supabaseAdmin
    .from('clinic_communication_settings')
    .upsert(
      {
        clinic_id: clinicId,
        email_enabled: rest.emailEnabled,
        sms_enabled: rest.smsEnabled,
        whatsapp_enabled: rest.whatsappEnabled,
        telegram_enabled: rest.telegramEnabled,
        reminder_channels: rest.reminderChannels,
        confirmation_channels: rest.confirmationChannels,
        cancellation_channels: rest.cancellationChannels,
        default_channel: rest.defaultChannel,
        reminders_enabled: rest.remindersEnabled,
        reminder_offset_minutes_1: rest.reminderOffsetMinutes1,
        reminder_offset_minutes_2: rest.reminderOffsetMinutes2,
        confirmation_notifications: rest.confirmationNotifications,
        cancellation_notifications: rest.cancellationNotifications,
        rescheduling_notifications: rest.reschedulingNotifications,
        notification_language: rest.notificationLanguage,
      },
      { onConflict: 'clinic_id' }
    )
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to save communication settings: ${error.message}`);
  }

  return {
    clinicId,
    emailEnabled: data.email_enabled,
    smsEnabled: data.sms_enabled,
    whatsappEnabled: data.whatsapp_enabled,
    telegramEnabled: data.telegram_enabled,
    reminderChannels: normalizeChannels(data.reminder_channels),
    confirmationChannels: normalizeChannels(data.confirmation_channels),
    cancellationChannels: normalizeChannels(data.cancellation_channels),
    defaultChannel: normalizeChannel(data.default_channel),
    remindersEnabled: data.reminders_enabled ?? true,
    reminderOffsetMinutes1: data.reminder_offset_minutes_1 ?? 1440,
    reminderOffsetMinutes2: data.reminder_offset_minutes_2 ?? 120,
    confirmationNotifications: data.confirmation_notifications ?? true,
    cancellationNotifications: data.cancellation_notifications ?? true,
    reschedulingNotifications: data.rescheduling_notifications ?? true,
    notificationLanguage: data.notification_language ?? 'ar',
  };
}

/**
 * Returns the channels configured for a given notification type.
 * Falls back to the default channel if the type has no explicit routing.
 */
export function channelsForNotificationType(settings: ClinicCommunicationSettings, type: NotificationType): ChannelType[] {
  switch (type) {
    case 'appointment_reminder':
      return settings.reminderChannels.length ? settings.reminderChannels : [settings.defaultChannel];
    case 'appointment_confirmation':
      return settings.confirmationChannels.length ? settings.confirmationChannels : [settings.defaultChannel];
    case 'appointment_cancellation':
      return settings.cancellationChannels.length ? settings.cancellationChannels : [settings.defaultChannel];
    case 'booking_acknowledgement':
      return settings.confirmationChannels.length ? settings.confirmationChannels : [settings.defaultChannel];
    default:
      return [settings.defaultChannel];
  }
}

/**
 * Returns only the enabled channels from a list.
 */
export function filterEnabledChannels(settings: ClinicCommunicationSettings, channels: ChannelType[]): ChannelType[] {
  return channels.filter((c) => {
    switch (c) {
      case 'email': return settings.emailEnabled;
      case 'sms': return settings.smsEnabled;
      case 'whatsapp': return settings.whatsappEnabled;
      case 'telegram': return settings.telegramEnabled;
      default: return false;
    }
  });
}