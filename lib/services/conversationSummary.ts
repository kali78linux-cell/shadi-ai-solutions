import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * CONVERSATION SUMMARY SERVICE
 *
 * Turns raw `conversations` rows into staff-readable summaries:
 *   "أحمد جمال — ألم في الطاحونة · عاجل — آخر نشاط قبل ٥ دقائق"
 * instead of the useless "جلسة مريض / public:1787089966904".
 *
 * Concepts kept strictly separate:
 *   Conversation Session ≠ Patient ≠ Appointment.
 * A session with no identity yet renders as "زائر جديد" — a fake Patient is
 * NEVER invented just because a chat was opened.
 *
 * All data comes from the live database (metadata.subject_analysis,
 * metadata.booking, linked patients/appointments). Nothing is hardcoded.
 */

export type ConversationLike = {
  id: string;
  clinic_id: string;
  patient_id?: string | null;
  session_id?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LinkedAppointment = {
  id: string;
  service: string | null;
  appointment_date: string | null;
  scheduled_at: string | null;
  status: string | null;
  provider_name: string | null;
  /** ROOT-CAUSE FIX: appointments link back to their Patient independently. */
  patient_id: string | null;
};

export type ConversationSummary = {
  id: string;
  clinic_id: string;
  session_id: string;
  status: string;
  started_at: string | null;
  updated_at: string | null;
  /** Resolved patient identity — null means "زائر جديد". */
  display_name: string | null;
  is_known_visitor: boolean;
  phone: string | null;
  patient_id: string | null;
  problem_summary: string | null;
  urgency: string | null;
  recommended_service: string | null;
  recommended_provider: string | null;
  booking: LinkedAppointment | null;
  has_booking: boolean;
  last_message_preview: string | null;
  last_message_at: string | null;
  needs_attention: boolean;
};

type SubjectAnalysisShape = Partial<{
  patient_name: string;
  phone: string;
  problem: string;
  requested_need: string;
  urgency: string;
  recommended_service: string;
  recommended_provider: string;
}>;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/** Truncates a preview line without breaking Arabic grapheme clusters badly. */
export function previewText(text: string | null | undefined, max = 120): string | null {
  const clean = nonEmpty(text)?.replace(/\s+/g, ' ');
  if (!clean) return null;
  return clean.length <= max ? clean : `${Array.from(clean).slice(0, max).join('')}…`;
}

/**
 * Pure aggregation — fully unit-testable without a database.
 */
export function buildConversationSummaries(input: {
  conversations: ConversationLike[];
  latestMessageByConversation: Record<string, { content: string | null; created_at: string | null }>;
  /** Latest message written BY THE PATIENT — used as the problem-summary fallback. */
  latestPatientMessageByConversation?: Record<string, { content: string | null; created_at: string | null }>;
  appointmentByConversation: Record<string, LinkedAppointment>;
  patientById: Record<string, { name: string | null; phone: string | null }>;
}): ConversationSummary[] {
  return input.conversations.map((conversation) => {
    const metadata = asRecord(conversation.metadata);
    const subject = asRecord(metadata.subject_analysis) as SubjectAnalysisShape;
    const bookingMeta = asRecord(metadata.booking);

    const booking = input.appointmentByConversation[conversation.id] ?? null;
    const lastMessage = input.latestMessageByConversation[conversation.id];
    const latestPatientMessage = input.latestPatientMessageByConversation?.[conversation.id];

    const linkedPatient = conversation.patient_id ? input.patientById[conversation.patient_id] : undefined;
    // ROOT-CAUSE FIX («زائر جديد» despite confirmed booking): the APPOINTMENT
    // carries its own patient_id even when conversations.patient_id is still
    // null — resolve identity through that link as well.
    const bookingLinkedPatient = booking?.patient_id ? input.patientById[booking.patient_id] : undefined;

    // Identity precedence: what the visitor said in-chat wins (freshest),
    // then the conversation's patient record, then the appointment's patient.
    // Nothing found ⇒ زائر جديد — never invented.
    const displayName =
      nonEmpty(bookingMeta.patient_name) ??
      nonEmpty(subject.patient_name) ??
      nonEmpty(linkedPatient?.name) ??
      nonEmpty(bookingLinkedPatient?.name);

    const phone =
      nonEmpty(bookingMeta.phone) ??
      nonEmpty(subject.phone) ??
      nonEmpty(linkedPatient?.phone) ??
      nonEmpty(bookingLinkedPatient?.phone);

    return {
      id: conversation.id,
      clinic_id: conversation.clinic_id,
      session_id: nonEmpty(conversation.session_id) ?? conversation.id,
      status: nonEmpty(conversation.status) ?? 'open',
      started_at: conversation.started_at ?? conversation.created_at ?? null,
      updated_at: conversation.updated_at ?? lastMessage?.created_at ?? null,
      display_name: displayName,
      is_known_visitor: Boolean(displayName),
      phone,
      patient_id: conversation.patient_id ?? null,
      // Fallback chain ends with what the patient ACTUALLY wrote, so a session
      // whose metadata analysis never populated still shows «طاحونتي بتجعني»
      // instead of the useless «لم تُذكر المشكلة بعد».
      problem_summary:
        nonEmpty(subject.problem) ??
        nonEmpty(subject.requested_need) ??
        previewText(latestPatientMessage?.content, 90),
      urgency: nonEmpty(subject.urgency),
      recommended_service: nonEmpty(subject.recommended_service),
      recommended_provider: nonEmpty(subject.recommended_provider),
      booking,
      has_booking: Boolean(booking),
      last_message_preview: previewText(lastMessage?.content),
      last_message_at: lastMessage?.created_at ?? null,
      // Staff attention = explicit handoff state only. "open" chats are NOT alarms.
      needs_attention: conversation.status === 'awaiting_human',
    };
  });
}

function normalizeProviderName(embedded: unknown): string | null {
  if (!embedded) return null;
  if (typeof embedded === 'string') return nonEmpty(embedded);
  if (Array.isArray(embedded)) return normalizeProviderName(embedded[0]);
  if (typeof embedded === 'object') return nonEmpty((embedded as Record<string, unknown>).name);
  return null;
}

/**
 * Loads every auxiliary dataset in a handful of batched queries (never N+1),
 * all constrained to the caller-provided conversation set.
 */
export async function loadConversationSummaries(
  conversations: ConversationLike[]
): Promise<ConversationSummary[]> {
  if (conversations.length === 0) return [];

  const ids = conversations.map((c) => c.id);

  // Latest message per conversation (single ordered query, first hit wins),
  // plus the latest message written BY THE PATIENT for the problem-summary
  // fallback («طاحونتي بتجعني» must surface even when metadata analysis
  // never populated).
  const latestMessageByConversation: Record<string, { content: string | null; created_at: string | null }> = {};
  const latestPatientMessageByConversation: Record<string, { content: string | null; created_at: string | null }> = {};
  const { data: messageRows } = await supabaseAdmin
    .from('messages')
    .select('conversation_id, role, content, created_at')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false })
    .limit(1000);
  for (const row of messageRows ?? []) {
    const r = row as { conversation_id?: string; role?: string; content?: string | null; created_at?: string | null };
    const key = r.conversation_id;
    if (!key) continue;
    if (!latestMessageByConversation[key]) {
      latestMessageByConversation[key] = { content: r.content ?? null, created_at: r.created_at ?? null };
    }
    if (r.role === 'patient' && !latestPatientMessageByConversation[key]) {
      latestPatientMessageByConversation[key] = { content: r.content ?? null, created_at: r.created_at ?? null };
    }
  }

  // Bookings linked through appointments.conversation_id (booking integrity
  // migration). patient_id is fetched because the APPOINTMENT carries its own
  // Patient link even when conversations.patient_id is still null.
  const appointmentByConversation: Record<string, LinkedAppointment> = {};
  const { data: appointmentRows } = await supabaseAdmin
    .from('appointments')
    .select('id, conversation_id, patient_id, service, appointment_date, scheduled_at, status, created_at, providers(name)')
    .in('conversation_id', ids)
    .order('created_at', { ascending: false });
  for (const row of appointmentRows ?? []) {
    const r = row as Record<string, unknown>;
    const key = typeof r.conversation_id === 'string' ? r.conversation_id : null;
    if (key && !appointmentByConversation[key]) {
      appointmentByConversation[key] = {
        id: String(r.id),
        patient_id: typeof r.patient_id === 'string' ? r.patient_id : null,
        service: nonEmpty(r.service),
        appointment_date: nonEmpty(r.appointment_date),
        scheduled_at: nonEmpty(r.scheduled_at),
        status: nonEmpty(r.status),
        provider_name: normalizeProviderName(r.providers),
      };
    }
  }

  // Real patient records — from BOTH conversations.patient_id AND the
  // appointment linkage (identity resolution chain Conversation → Appointment → Patient).
  const patientIds = Array.from(
    new Set(
      [
        ...conversations.map((c) => c.patient_id),
        ...Object.values(appointmentByConversation).map((a) => a.patient_id),
      ].filter((v): v is string => Boolean(v))
    )
  );
  const patientById: Record<string, { name: string | null; phone: string | null }> = {};
  if (patientIds.length > 0) {
    const { data: patientRows } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone')
      .in('id', patientIds);
    for (const row of patientRows ?? []) {
      const r = row as Record<string, unknown>;
      if (typeof r.id === 'string') {
        patientById[r.id] = { name: nonEmpty(r.name), phone: nonEmpty(r.phone) };
      }
    }
  }

  return buildConversationSummaries({
    conversations,
    latestMessageByConversation,
    latestPatientMessageByConversation,
    appointmentByConversation,
    patientById,
  });
}

export type ConversationDetailExtras = {
  summary: ConversationSummary | null;
  appointment: LinkedAppointment | null;
  patient: { id: string; name: string | null; phone: string | null; email: string | null } | null;
};

/** Detail-page variant for ONE conversation (same data discipline, deeper fields). */
export async function loadConversationDetailExtras(
  conversation: ConversationLike
): Promise<ConversationDetailExtras> {
  const [summary] = await loadConversationSummaries([conversation]);

  let appointment: LinkedAppointment | null = null;
  const { data: appointmentRows } = await supabaseAdmin
    .from('appointments')
    .select('id, conversation_id, patient_id, service, appointment_date, scheduled_at, status, created_at, providers(name)')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: false })
    .limit(1);
  const apptRow = (appointmentRows ?? [])[0] as Record<string, unknown> | undefined;
  if (apptRow) {
    appointment = {
      id: String(apptRow.id),
      patient_id: typeof apptRow.patient_id === 'string' ? apptRow.patient_id : null,
      service: nonEmpty(apptRow.service),
      appointment_date: nonEmpty(apptRow.appointment_date),
      scheduled_at: nonEmpty(apptRow.scheduled_at),
      status: nonEmpty(apptRow.status),
      provider_name: normalizeProviderName(apptRow.providers),
    };
  }

  // Patient panel resolves through BOTH links: the conversation's own
  // patient_id first, then the appointment's (Conversation → Appointment → Patient).
  const effectivePatientId = conversation.patient_id ?? appointment?.patient_id ?? null;
  let patient: ConversationDetailExtras['patient'] = null;
  if (effectivePatientId) {
    const { data: patientRow } = await supabaseAdmin
      .from('patients')
      .select('id, name, phone, email')
      .eq('id', effectivePatientId)
      .maybeSingle();
    if (patientRow) {
      const p = patientRow as Record<string, unknown>;
      patient = {
        id: String(p.id),
        name: nonEmpty(p.name),
        phone: nonEmpty(p.phone),
        email: nonEmpty(p.email),
      };
    }
  }

  return { summary, appointment, patient };
}
