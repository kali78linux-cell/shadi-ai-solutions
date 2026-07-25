import { supabase } from '@/lib/supabase';
import { logEvent } from '@/lib/server/logging';

export const REMINDER_OFFSETS_MINUTES = [24 * 60, 2 * 60, 30] as const;
export const NOTIFICATION_CHANNELS = ['whatsapp', 'telegram', 'sms', 'email'] as const;

export async function createAppointmentReminders(params: { clinicId: string; appointmentId: string; scheduledAt: string; channels: string[]; patientId?: string | null; customOffsets?: number[] }) {
  const scheduled = new Date(params.scheduledAt).getTime();
  const offsets = (params.customOffsets?.length ? params.customOffsets : [...REMINDER_OFFSETS_MINUTES]).filter((offset, index, array) => array.indexOf(offset) === index);
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
  const { data, error } = await supabase.from('notification_queue').insert(rows).select('*');
  if (error) {
    logEvent('reminder_dispatch_failure', { clinic_id: params.clinicId, appointment_id: params.appointmentId, error: error.message }, 'error');
    throw error;
  }
  return data ?? [];
}

export async function processNotificationQueue(params: { limit?: number; sender: (notification: any) => Promise<void> }) {
  const limit = params.limit ?? 50;
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('notification_queue').select('*').in('status', ['pending', 'failed']).lte('scheduled_for', now).lt('attempt_count', 5).order('scheduled_for', { ascending: true }).limit(limit);
  if (error) throw error;
  const results = [];
  for (const notification of data ?? []) {
    try {
      await params.sender(notification);
      const { data: sent, error: updateError } = await supabase.from('notification_queue').update({ status: 'sent', sent_at: new Date().toISOString(), attempt_count: notification.attempt_count + 1 }).eq('id', notification.id).select('*').single();
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
      const { data: failed, error: updateError } = await supabase.from('notification_queue').update({ status: attemptCount >= 5 ? 'failed' : 'retried', failed_at: new Date().toISOString(), attempt_count: attemptCount, last_error: sendError instanceof Error ? sendError.message : String(sendError) }).eq('id', notification.id).select('*').single();
      if (updateError) throw updateError;
      results.push(failed);
    }
  }
  return results;
}
