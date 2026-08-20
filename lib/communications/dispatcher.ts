import { processNotificationQueue } from '@/lib/services/reminderEngine';
import { getClinicCommunicationSettings, channelsForNotificationType, filterEnabledChannels } from './settings';
import { getChannelAdapter } from './channels/adapters';
import { ChannelType, NotificationType } from './channels/types';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

/**
 * Loads the patient contact identifiers available for a notification.
 * Returns null if the patient cannot be resolved.
 */
async function loadPatientContacts(notification: any): Promise<{ email: string | null; phone: string | null; telegramId: string | null } | null> {
  if (!notification.patient_id) return { email: null, phone: null, telegramId: null };

  const { data, error } = await supabaseAdmin
    .from('patients')
    .select('email, phone_number')
    .eq('id', notification.patient_id)
    .eq('clinic_id', notification.clinic_id)
    .maybeSingle();

  if (error || !data) return null;

  return {
    email: data.email || null,
    phone: data.phone_number || null,
    telegramId: null, // No telegram identifier column exists yet
  };
}

/**
 * Determines which channels should receive a notification based on:
 *   - clinic communication settings (enabled + type routing)
 *   - patient contact availability
 *
 * Returns a de-duplicated list of channels.
 */
export async function resolveChannelsForNotification(notification: any): Promise<ChannelType[]> {
  const settings = await getClinicCommunicationSettings(notification.clinic_id);
  const type = (notification.type || 'appointment_reminder') as NotificationType;

  // Channels configured for this notification type
  const configured = channelsForNotificationType(settings, type);

  // Only enabled channels
  const enabled = filterEnabledChannels(settings, configured);

  // Filter by patient contact availability
  const contacts = await loadPatientContacts(notification);
  if (!contacts) return [];

  const available = enabled.filter((channel) => {
    switch (channel) {
      case 'email':
        return Boolean(contacts.email);
      case 'sms':
        return Boolean(contacts.phone);
      case 'whatsapp':
        return Boolean(contacts.phone);
      case 'telegram':
        return Boolean(contacts.telegramId);
      default:
        return false;
    }
  });

  // De-duplicate
  return available.filter((c, i, arr) => arr.indexOf(c) === i);
}

/**
 * Dispatches a notification_queue item to the appropriate channel adapters.
 * The queue remains the source of truth — this function only knows how to
 * deliver a single item; it does not manage queue state.
 *
 * Each channel delivery is independent — a failure on one channel does not
 * affect the others. The queue's retry behavior handles failures.
 */
export async function dispatchNotification(notification: any): Promise<void> {
  const channels = await resolveChannelsForNotification(notification);

  if (channels.length === 0) {
    // No applicable channel — log and resolve so the queue marks it sent
    // (there is nothing to deliver to).
    logEvent('notification_no_channel', {
      notification_id: notification.id,
      clinic_id: notification.clinic_id,
      type: notification.type,
    });
    return;
  }

  // Send to each channel independently (failure isolation)
  const failures: string[] = [];
  for (const channel of channels) {
    try {
      const adapter = getChannelAdapter(channel);
      const contacts = await loadPatientContacts(notification);
      await adapter.send({
        to: channel === 'email' ? contacts?.email ?? '' : contacts?.phone ?? '',
        text: `Appointment notification for clinic ${notification.clinic_id}`,
        // Pass the full notification so the email adapter can build proper
        // booking emails with secure confirm/cancel links.
        notification,
      });
      logEvent('notification_channel_sent', {
        notification_id: notification.id,
        clinic_id: notification.clinic_id,
        channel,
      });
    } catch (err) {
      failures.push(channel);
      logEvent('notification_channel_failure', {
        notification_id: notification.id,
        clinic_id: notification.clinic_id,
        channel,
        error: err instanceof Error ? err.message : String(err),
      }, 'error');
    }
  }

  // If ALL channels failed, throw so the queue marks the notification as failed/retried.
  // If at least one channel succeeded, resolve so the queue marks it sent.
  if (failures.length === channels.length) {
    throw new Error(`All channels failed for notification ${notification.id}: ${failures.join(', ')}`);
  }
}

/**
 * Processes the notification queue using the channel dispatcher as the sender.
 * This is the integration point between the queue and the delivery layer.
 *
 * Usage:
 *   await processNotificationQueueWithDispatcher();
 */
export async function processNotificationQueueWithDispatcher(params?: { limit?: number; client?: any }) {
  return processNotificationQueue({
    limit: params?.limit,
    client: params?.client,
    sender: dispatchNotification,
  });
}