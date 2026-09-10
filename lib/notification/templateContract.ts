/**
 * STEP 15E/G2 — Shared notification-template contract constants.
 *
 * Source of truth for the REAL live schema of `clinic_notification_templates`
 * (template_type / channel / language CHECK-constrained values). Kept OUT of
 * route.ts because Next.js Route files may only export handlers + allowed
 * route segments, not arbitrary values.
 */

export const NOTIFICATION_TEMPLATE_TYPES = [
  'appointment_confirmation',
  'appointment_reminder',
  'appointment_cancellation',
  'appointment_rescheduling',
] as const;

export type NotificationTemplateType = (typeof NOTIFICATION_TEMPLATE_TYPES)[number];

export const NOTIFICATION_CHANNELS = ['email', 'sms', 'whatsapp', 'telegram'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_LANGUAGES = ['ar', 'en'] as const;

export type NotificationLanguage = (typeof NOTIFICATION_LANGUAGES)[number];