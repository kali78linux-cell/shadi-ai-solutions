/**
 * Growth Layer Foundation — Recall / No-show Recovery / Waitlist
 * (D-G1, D-G2, D-G3 — owner-approved).
 *
 * - Recall: per-service rules with clinic-wide fallback; recall created when an
 *   appointment is completed; one active recall per (clinic, patient, service,
 *   due period) enforced by a DB partial unique index (idempotency).
 * - No-show recovery: when an appointment is marked no_show, a recovery
 *   notification is queued once per appointment (DB partial unique index on
 *   notification_queue.type='no_show_recovery' + appointment_id).
 * - Waitlist: entries are matched on-demand when a slot is released
 *   (cancellation), not by any cron/worker. One offer per released appointment
 *   (DB partial unique index on type='waitlist_offer' + appointment_id).
 *
 * All writes are server-side via supabaseAdmin (RLS default-deny, consistent
 * with the financial phases). No ledger kinds are added (not a financial phase).
 */
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import { writeAuditLog } from '@/lib/services/auditService';

// ---------------------------------------------------------------------------
// Recall — rules (D-G1)
// ---------------------------------------------------------------------------

export type RecallRule = {
  id: string;
  clinic_id: string;
  service_id: string | null;
  recall_after_days: number;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export async function listRecallRules(clinicId: string): Promise<RecallRule[]> {
  const { data, error } = await supabaseAdmin
    .from('clinic_recall_rules')
    .select('id, clinic_id, service_id, recall_after_days, enabled, created_at, updated_at')
    .eq('clinic_id', clinicId)
    .order('created_at', { ascending: true });
  if (error) {
    logEvent('growth_recall_rules_list_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return (data ?? []) as RecallRule[];
}

export async function createRecallRule(params: {
  clinicId: string;
  serviceId?: string | null;
  recallAfterDays: number;
  enabled?: boolean;
  actorUserId?: string | null;
}): Promise<RecallRule> {
  const { data, error } = await supabaseAdmin
    .from('clinic_recall_rules')
    .insert({
      clinic_id: params.clinicId,
      service_id: params.serviceId ?? null,
      recall_after_days: params.recallAfterDays,
      enabled: params.enabled ?? true,
    })
    .select('*')
    .single();
  if (error) {
    logEvent('growth_recall_rule_create_error', { clinic_id: params.clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: params.actorUserId ?? null,
    action: 'recall_rule_created',
    resourceType: 'clinic_recall_rules',
    resourceId: data.id,
    metadata: { service_id: params.serviceId ?? null, recall_after_days: params.recallAfterDays },
  });
  return data as RecallRule;
}

export async function updateRecallRule(params: {
  clinicId: string;
  ruleId: string;
  recallAfterDays?: number;
  enabled?: boolean;
  actorUserId?: string | null;
}): Promise<RecallRule> {
  const patch: Record<string, unknown> = {};
  if (params.recallAfterDays !== undefined) patch.recall_after_days = params.recallAfterDays;
  if (params.enabled !== undefined) patch.enabled = params.enabled;
  const { data, error } = await supabaseAdmin
    .from('clinic_recall_rules')
    .update(patch)
    .eq('id', params.ruleId)
    .eq('clinic_id', params.clinicId)
    .select('*')
    .single();
  if (error) {
    logEvent('growth_recall_rule_update_error', { clinic_id: params.clinicId, rule_id: params.ruleId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: params.actorUserId ?? null,
    action: 'recall_rule_updated',
    resourceType: 'clinic_recall_rules',
    resourceId: data.id,
    metadata: patch,
  });
  return data as RecallRule;
}

export async function deleteRecallRule(params: { clinicId: string; ruleId: string }): Promise<void> {
  const { error } = await supabaseAdmin
    .from('clinic_recall_rules')
    .delete()
    .eq('id', params.ruleId)
    .eq('clinic_id', params.clinicId);
  if (error) {
    logEvent('growth_recall_rule_delete_error', { clinic_id: params.clinicId, rule_id: params.ruleId, error: error.message }, 'error');
    throw new Error(error.message);
  }
}

// ---------------------------------------------------------------------------
// Recall — read/dismiss
// ---------------------------------------------------------------------------

export type Recall = {
  id: string;
  clinic_id: string;
  patient_id: string;
  service_id: string | null;
  due_at: string;
  status: 'open' | 'notified' | 'scheduled' | 'dismissed';
  linked_appointment_id: string | null;
  created_at: string;
};

export async function listRecalls(clinicId: string, status?: string): Promise<Recall[]> {
  let query = supabaseAdmin
    .from('clinic_recalls')
    .select('id, clinic_id, patient_id, service_id, due_at, status, linked_appointment_id, created_at')
    .eq('clinic_id', clinicId)
    .order('due_at', { ascending: true });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    logEvent('growth_recalls_list_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return (data ?? []) as Recall[];
}


/**
 * Generates a recall when an appointment is completed (D-G1).
 * Rule resolution: per-service rule first, else the clinic-wide fallback rule.
 * Returns the new recall, or null when no rule applies / a duplicate active
 * recall already exists for the same (clinic, patient, service, due period).
 * Idempotency relies on the DB partial unique index uq_recalls_active_period.
 */
export async function generateRecallForCompletedAppointment(params: {
  clinicId: string;
  patientId: string | null;
  serviceId?: string | null;
  completedAt: string;
  linkedAppointmentId: string;
  actorUserId?: string | null;
}): Promise<Recall | null> {
  if (!params.patientId) return null;
  const rules = await listRecallRules(params.clinicId);
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return null;

  const serviceRule = params.serviceId ? enabled.find((r) => r.service_id === params.serviceId) : undefined;
  const fallbackRule = enabled.find((r) => r.service_id === null);
  const rule = serviceRule ?? fallbackRule;
  if (!rule) return null;

  const due = addDays(params.completedAt, rule.recall_after_days);
  const { data, error } = await supabaseAdmin
    .from('clinic_recalls')
    .insert({
      clinic_id: params.clinicId,
      patient_id: params.patientId,
      service_id: params.serviceId ?? null,
      due_at: due,
      status: 'open',
      linked_appointment_id: params.linkedAppointmentId,
      created_by: params.actorUserId ?? null,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      logEvent('growth_recall_duplicate_skipped', { clinic_id: params.clinicId, patient_id: params.patientId });
      return null;
    }
    logEvent('growth_recall_create_error', { clinic_id: params.clinicId, patient_id: params.patientId, error: error.message }, 'error');
    throw new Error(error.message);
  }

  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: params.actorUserId ?? null,
    action: 'recall_created',
    resourceType: 'clinic_recalls',
    resourceId: data.id,
    metadata: { patient_id: params.patientId, service_id: params.serviceId ?? null, due_at: due },
  });

  try {
    await queueRecallNotification({ clinicId: params.clinicId, recall: data as Recall });
  } catch (queueError) {
    logEvent('growth_recall_notify_queue_error', { clinic_id: params.clinicId, recall_id: data.id, error: queueError instanceof Error ? queueError.message : String(queueError) }, 'error');
  }
  return data as Recall;
}

function addDays(isoOrDate: string, days: number): string {
  const d = new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) {
    const [y, m, day] = isoOrDate.slice(0, 10).split('-').map(Number);
    const dt = new Date(Date.UTC(y, (m ?? 1) - 1, day ?? 1, 12, 0, 0));
    dt.setUTCDate(dt.getUTCDate() + days);
    return dt.toISOString().slice(0, 10);
  }
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function queueRecallNotification(params: { clinicId: string; recall: Recall }) {
  const { data, error } = await supabaseAdmin
    .from('notification_queue')
    .insert({
      clinic_id: params.clinicId,
      patient_id: params.recall.patient_id,
      channel: 'email',
      type: 'recall',
      status: 'pending',
      scheduled_for: `${params.recall.due_at}T08:00:00Z`,
      payload: { recall_id: params.recall.id, service_id: params.recall.service_id },
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      logEvent('growth_recall_notification_duplicate_skipped', { clinic_id: params.clinicId, recall_id: params.recall.id });
      return null;
    }
    throw new Error(error.message);
  }
  return data;
}

export async function dismissRecall(params: { clinicId: string; recallId: string; actorUserId?: string | null }): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('clinic_recalls')
    .update({ status: 'dismissed', updated_at: new Date().toISOString() })
    .eq('id', params.recallId)
    .eq('clinic_id', params.clinicId)
    .select('id')
    .single();
  if (error) {
    logEvent('growth_recall_dismiss_error', { clinic_id: params.clinicId, recall_id: params.recallId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: params.actorUserId ?? null,
    action: 'recall_dismissed',
    resourceType: 'clinic_recalls',
    resourceId: params.recallId,
    metadata: {},
  });
}
// ---------------------------------------------------------------------------
// No-show recovery (D-G2) — no new table; queues a recovery notification once
// per appointment (DB partial unique index on notification_queue).
// ---------------------------------------------------------------------------

export async function queueNoShowRecovery(params: {
  clinicId: string;
  appointmentId: string;
  patientId?: string | null;
}): Promise<{ id: string } | null> {
  const { data, error } = await supabaseAdmin
    .from('notification_queue')
    .insert({
      clinic_id: params.clinicId,
      appointment_id: params.appointmentId,
      patient_id: params.patientId ?? null,
      channel: 'email',
      type: 'no_show_recovery',
      status: 'pending',
      scheduled_for: new Date().toISOString(),
      payload: { appointment_id: params.appointmentId },
    })
    .select('id')
    .single();
  if (error) {
    if (error.code === '23505' || /duplicate key/i.test(error.message)) {
      logEvent('growth_no_show_recovery_duplicate_skipped', { clinic_id: params.clinicId, appointment_id: params.appointmentId });
      return null;
    }
    logEvent('growth_no_show_recovery_queue_error', { clinic_id: params.clinicId, appointment_id: params.appointmentId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Waitlist (D-G3) — on-demand matching when a slot is released (cancellation).
// One offer per released appointment (DB partial unique index).
// ---------------------------------------------------------------------------

export type WaitlistEntry = {
  id: string;
  clinic_id: string;
  patient_id: string;
  provider_id: string | null;
  service_id: string | null;
  preferred_from: string | null;
  preferred_to: string | null;
  priority: number;
  expires_at: string;
  status: 'active' | 'notified' | 'booked' | 'expired' | 'cancelled';
  created_at: string;
};

export async function listWaitlistEntries(clinicId: string, status?: string): Promise<WaitlistEntry[]> {
  let query = supabaseAdmin
    .from('clinic_waitlist_entries')
    .select('id, clinic_id, patient_id, provider_id, service_id, preferred_from, preferred_to, priority, expires_at, status, created_at')
    .eq('clinic_id', clinicId)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) {
    logEvent('growth_waitlist_list_error', { clinic_id: clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  return (data ?? []) as WaitlistEntry[];
}

export async function addWaitlistEntry(params: {
  clinicId: string;
  patientId: string;
  providerId?: string | null;
  serviceId?: string | null;
  preferredFrom?: string | null;
  preferredTo?: string | null;
  priority?: number;
  expiresAt: string;
  actorUserId?: string | null;
}): Promise<WaitlistEntry> {
  const { data, error } = await supabaseAdmin
    .from('clinic_waitlist_entries')
    .insert({
      clinic_id: params.clinicId,
      patient_id: params.patientId,
      provider_id: params.providerId ?? null,
      service_id: params.serviceId ?? null,
      preferred_from: params.preferredFrom ?? null,
      preferred_to: params.preferredTo ?? null,
      priority: params.priority ?? 0,
      expires_at: params.expiresAt,
      status: 'active',
    })
    .select('*')
    .single();
  if (error) {
    logEvent('growth_waitlist_add_error', { clinic_id: params.clinicId, patient_id: params.patientId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: params.actorUserId ?? null,
    action: 'waitlist_entry_created',
    resourceType: 'clinic_waitlist_entries',
    resourceId: data.id,
    metadata: { patient_id: params.patientId, provider_id: params.providerId ?? null, service_id: params.serviceId ?? null },
  });
  return data as WaitlistEntry;
}

export async function updateWaitlistEntry(params: {
  clinicId: string;
  entryId: string;
  patch: {
    providerId?: string | null;
    serviceId?: string | null;
    preferredFrom?: string | null;
    preferredTo?: string | null;
    priority?: number;
    expiresAt?: string;
    status?: WaitlistEntry['status'];
  };
  actorUserId?: string | null;
}): Promise<WaitlistEntry> {
  const dbPatch: Record<string, unknown> = {};
  if (params.patch.providerId !== undefined) dbPatch.provider_id = params.patch.providerId;
  if (params.patch.serviceId !== undefined) dbPatch.service_id = params.patch.serviceId;
  if (params.patch.preferredFrom !== undefined) dbPatch.preferred_from = params.patch.preferredFrom;
  if (params.patch.preferredTo !== undefined) dbPatch.preferred_to = params.patch.preferredTo;
  if (params.patch.priority !== undefined) dbPatch.priority = params.patch.priority;
  if (params.patch.expiresAt !== undefined) dbPatch.expires_at = params.patch.expiresAt;
  if (params.patch.status !== undefined) dbPatch.status = params.patch.status;
  dbPatch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from('clinic_waitlist_entries')
    .update(dbPatch)
    .eq('id', params.entryId)
    .eq('clinic_id', params.clinicId)
    .select('*')
    .single();
  if (error) {
    logEvent('growth_waitlist_update_error', { clinic_id: params.clinicId, entry_id: params.entryId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: params.actorUserId ?? null,
    action: 'waitlist_entry_updated',
    resourceType: 'clinic_waitlist_entries',
    resourceId: params.entryId,
    metadata: dbPatch,
  });
  return data as WaitlistEntry;
}

export async function cancelWaitlistEntry(params: { clinicId: string; entryId: string; actorUserId?: string | null }): Promise<void> {
  await updateWaitlistEntry({ clinicId: params.clinicId, entryId: params.entryId, patch: { status: 'cancelled' as const }, actorUserId: params.actorUserId });
}

/**
 * On-demand matching when a slot is released (e.g. appointment cancelled).
 * Deterministic: filters active entries for the released appointment's
 * provider/service (null = any), then takes the highest priority (then oldest).
 * Claimed entry is atomically moved to 'notified' — a second call for the same
 * released appointment creates no duplicate offer (status guard + DB index).
 * Offers are idempotent at the DB level (uq_nq_waitlist_offer_once).
 */
export async function matchWaitlistForReleasedSlot(params: {
  clinicId: string;
  appointmentId: string;
  providerId: string | null;
  serviceId: string | null;
  releasedAt: string;
  durationMinutes?: number | null;
}): Promise<WaitlistEntry | null> {
  const nowIso = new Date().toISOString();
  const { data: candidates, error } = await supabaseAdmin
    .from('clinic_waitlist_entries')
    .select('*')
    .eq('clinic_id', params.clinicId)
    .eq('status', 'active')
    .gt('expires_at', nowIso)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) {
    logEvent('growth_waitlist_match_query_error', { clinic_id: params.clinicId, error: error.message }, 'error');
    throw new Error(error.message);
  }
  const rows = (candidates ?? []) as WaitlistEntry[];

  const match =
    rows.find((e) => (e.provider_id === null || e.provider_id === params.providerId) &&
      (e.service_id === null || e.service_id === params.serviceId)) ?? null;
  if (!match) return null;

  // Atomic claim: only 'active' entries can be claimed → idempotent per entry.
  const { data: claimed, error: claimError } = await supabaseAdmin
    .from('clinic_waitlist_entries')
    .update({ status: 'notified', updated_at: nowIso })
    .eq('id', match.id)
    .eq('clinic_id', params.clinicId)
    .eq('status', 'active')
    .select('*')
    .single();
  if (claimError) {
    logEvent('growth_waitlist_claim_error', { clinic_id: params.clinicId, entry_id: match.id, error: claimError.message }, 'error');
    throw new Error(claimError.message);
  }
  if (!claimed) return null;

  const releaseDate = params.releasedAt.slice(0, 10);
  const { data: offer, error: offerError } = await supabaseAdmin
    .from('notification_queue')
    .insert({
      clinic_id: params.clinicId,
      appointment_id: params.appointmentId,
      patient_id: claimed.patient_id,
      channel: 'email',
      type: 'waitlist_offer',
      status: 'pending',
      scheduled_for: nowIso,
      payload: { entry_id: claimed.id, released_at: params.releasedAt, appointment_date: releaseDate },
    })
    .select('id')
    .single();
  if (offerError) {
    if (offerError.code === '23505' || /duplicate key/i.test(offerError.message)) {
      logEvent('growth_waitlist_offer_duplicate_skipped', { clinic_id: params.clinicId, appointment_id: params.appointmentId });
      return claimed as WaitlistEntry;
    }
    logEvent('growth_waitlist_offer_queue_error', { clinic_id: params.clinicId, appointment_id: params.appointmentId, error: offerError.message }, 'error');
    throw new Error(offerError.message);
  }

  await writeAuditLog({
    clinicId: params.clinicId,
    actorUserId: null,
    action: 'waitlist_offer_sent',
    resourceType: 'clinic_waitlist_entries',
    resourceId: claimed.id,
    metadata: { appointment_id: params.appointmentId, released_at: params.releasedAt },
  });
  return claimed as WaitlistEntry;
}
