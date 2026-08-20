import { logEvent } from '@/lib/server/logging';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getConversationById } from './conversationService';

/**
 * Notifies clinic staff that a conversation requires their attention.
 * This function now creates a persistent notification record in the database.
 * @param clinicId The ID of the clinic.
 * @param conversationId The ID of the conversation requiring handoff.
 */
export async function notifyStaffForHandoff(clinicId: string, conversationId: string): Promise<void> {
  console.log(`[NotificationService] Staff notification triggered for clinic ${clinicId}, conversation ${conversationId}`);

  // Fetch conversation details to get patient_id for the notification
  const conversation = await getConversationById(conversationId);

  // Create a persistent notification record
  const { error } = await supabaseAdmin.from('notifications').insert({
    clinic_id: clinicId,
    user_id: null, // For now, we don't know which specific staff to notify. This can be extended.
    patient_id: conversation.patient_id,
    channel: 'email', // Default channel for handoff, can be configurable
    type: 'system', // notification_type enum only allows appointment_reminder, billing, system
    payload: { conversation_id: conversationId, reason: 'human_handoff_requested' },
    status: 'pending', // Status for the notification delivery
  });

  if (error) {
    logEvent('notification_persistence_error', { clinic_id: clinicId, conversation_id: conversationId, error: error.message }, 'error');
    throw new Error(`Failed to persist handoff notification: ${error.message}`);
  }

  logEvent('staff_notification_triggered', {
    clinic_id: clinicId,
    conversation_id: conversationId,
    reason: 'human_handoff_requested',
  });
}