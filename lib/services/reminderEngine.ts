import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

export const DEFAULT_REMINDER_OFFSETS_MINUTES = [24 * 60, 2 * 60] as const;
export const NOTIFICATION_CHANNELS = ['whatsapp', 'telegram', 'sms', 'email'] as const;

type ReminderClient = typeof supabase | typeof supabaseAdmin;

function resolveClient(client?: ReminderClient) {
  return client ?? supabase;
}

/**
 * Loads the clinic's configured reminder offsets from clinic_communication_settings.
 * Falls back to defaults (24h, 2h) if no config row exists.
 * Returns null when reminders are disabled.
 */
export async function getClinicReminderOffsets(clinicId: string): Promise<number[] | null> {
  const db = supabaseAdmin;
  const { data, error } = await db
    .from('clinic_communication_settings')
    .select('reminders_enabled, reminder_offset_minutes_1, reminder_offset_minutes_2')
    .eq('clinic_id', clinicId)
    .maybeSingle();

  if (error) {
    logEvent('reminder_config_load_failure', { clinic_id: clinicId, error: error.message }, 'error');
    return [...DEFAULT_REMINDER_OFFSETS_MINUTES];
  }

  if (!data || data.reminders_enabled === false) {
    return null;
  }

  const offsets = [data.reminder_offset_minutes_1 ?? DEFAULT_REMINDER_OFFSETS_MINUTES[0]];
  if (data.reminder_offset_minutes_2 != null) {
    offsets.push(data.reminder_offset_minutes_2);
  }

  return offsets.filter((offset, index, arr) => offset > 0 && arr.indexOf(offset) === index);
}

export async function createAppointmentReminders(params: {
  clinicId: string;
  appointmentId: string;
  scheduledAt: string;
  channels: string[];
  patientId?: string | null;
  customOffsets?: number[];
  client?: ReminderClient;
}) {
  const db = resolveClient(params.client);
  const scheduled = new Date(params.scheduledAt).getTime();
  // Use clinic-configured offsets when customOffsets is not provided.
  const configuredOffsets = await getClinicReminderOffsets(params.clinicId);
  if (configuredOffsets === null) {
    // Reminders disabled for this clinic
    return [];
  }
  const offsets = (params.customOffsets?.length ? params.customOffsets : configuredOffsets).filter((offset, index, array) => array.indexOf(offset) === index);
  const rows = offsets.flatMap((offset) => params.channels.map((channel) => ({
    clinic_id: params.clinicId,
    appointment_id: params.appointmentId,
    patient_id: params.patientId ?? null,
    channel,
    type: 'appointment_reminder',
    status: 'pending',
    scheduled_for: new Date(scheduled - offset * 60_000).toISOString(),
    attempt_count: 0,
    payload: { offset_minutes: offset },
  })));
  if (!rows.length) return [];
  const { data, error } = await db.from('notification_queue').insert(rows).select('*');
  if (error) {
    logEvent('reminder_dispatch_failure', { clinic_id: params.clinicId, appointment_id: params.appointmentId, error: error.message }, 'error');
    throw error;
  }
  return data ?? [];
}

/**
 * Cancels all pending reminders for an appointment when it is cancelled/rescheduled.
 *
 * Semantics: a pending (unsent) reminder is obsolete once the original slot is no
 * longer valid. We DELETE it rather than marking 'cancelled' because:
 *  - The live notification_queue CHECK constraint currently permits only
 *    (pending, sent, failed, retried) — a later migration may add 'cancelled'.
 *  - Removing the obsolete row is strictly more robust: no stale reminder can
 *    ever be dispatched by the queue worker.
 * Sent/failed (already processed) reminders are left untouched for audit.
 */
export async function cancelAppointmentReminders(params: {
  clinicId: string;
  appointmentId: string;
  client?: ReminderClient;
}) {
  const db = resolveClient(params.client);
  const { data, error } = await db
    .from('notification_queue')
    .delete()
    .eq('clinic_id', params.clinicId)
    .eq('appointment_id', params.appointmentId)
    .eq('status', 'pending')
    .select('id');
  if (error) {
    logEvent('reminder_cancel_failure', { clinic_id: params.clinicId, appointment_id: params.appointmentId, error: error.message }, 'error');
    throw error;
  }
  return data ?? [];
}

export async function processNotificationQueue(params: { limit?: number; sender: (notification: any) => Promise<void>; client?: ReminderClient }) {
  const db = resolveClient(params.client);
  const limit = params.limit ?? 50;
  const now = new Date().toISOString();
  const { data, error } = await db.from('notification_queue').select('*').in('status', ['pending', 'failed']).lte('scheduled_for', now).lt('attempt_count', 5).order('scheduled_for', { ascending: true }).limit(limit);
  if (error) throw error;
  const results = [];
  for (const notification of data ?? []) {
    try {
      await params.sender(notification);
      const { data: sent, error: updateError } = await db.from('notification_queue').update({ status: 'sent', sent_at: new Date().toISOString(), attempt_count: notification.attempt_count + 1 }).eq('id', notification.id).select('*').single();
      if (updateError) throw updateError;
      results.push(sent);
    } catch (sendError) {
      const attemptCount = notification.attempt_count + 1;
      logEvent('reminder_dispatch_failure', {
        clinic_id: notification.clinic_id,
        appointment_id: notification.appointment_id,
        notification_id: notification.id,
        attempt_count: attemptCount,
        error: sendError instanceof Error ? { name: sendError.name, message: sendError.message } : String(sendError),
      }, 'error');
      const { data: failed, error: updateError } = await db.from('notification_queue').update({ status: attemptCount >= 5 ? 'failed' : 'retried', failed_at: new Date().toISOString(), attempt_count: attemptCount, last_error: sendError instanceof Error ? sendError.message : String(sendError) }).eq('id', notification.id).select('*').single();
      if (updateError) throw updateError;
      results.push(failed);
    }
  }
  return results;
}
