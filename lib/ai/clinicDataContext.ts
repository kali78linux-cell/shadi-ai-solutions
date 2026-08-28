import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

/**
 * Clinic Operating Data — the SINGLE source of truth for the AI receptionist
 * about what the clinic actually offers (services, providers, assignments).
 *
 * Knowledge Base is NOT required for this data: it is read directly from the
 * operational tables (clinic-scoped, deleted-at-filtered) so the AI can:
 *  - understand "بدي تقويم" → orthodontics service → assigned provider
 *  - understand "طاحونتي بتوجعني" → solve service → recommend
 *  - never invent a service/provider that does not exist in THIS clinic
 *  - never leak a Demo/other-clinic provider/service (every query is clinic_id-scoped)
 */

export type ClinicServiceForAI = {
  id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  pricing_type: 'unspecified' | 'fixed' | 'estimate' | 'range' | 'case_by_case' | null;
  price_min: number | null;
  price_max: number | null;
  price_visible_to_patients: boolean;
  active: boolean;
};

export type ClinicProviderForAI = {
  id: string;
  name: string;
  title: string | null;
  provider_type: string | null;
};

export type ClinicOperatingData = {
  services: ClinicServiceForAI[];
  providers: ClinicProviderForAI[];
  providerServiceIds: Array<{ provider_id: string; service_id: string }>;
  hasServices: boolean;
  hasProviders: boolean;
  /** True when the clinic has at least one service OR one provider to reason about. */
  usable: boolean;
};

export const EMPTY_OPERATING_DATA: ClinicOperatingData = {
  services: [],
  providers: [],
  providerServiceIds: [],
  hasServices: false,
  hasProviders: false,
  usable: false,
};
export async function loadClinicOperatingData(clinicId: string): Promise<ClinicOperatingData> {
  try {
    const [servicesRes, providersRes, assignmentsRes] = await Promise.all([
      supabaseAdmin
        .from('clinic_services')
        .select(
          'id, name, description, duration_minutes, pricing_type, price_min, price_max, price_visible_to_patients, active'
        )
        .eq('clinic_id', clinicId)
        .eq('active', true)
        .is('deleted_at', null),
      supabaseAdmin
        .from('providers')
        .select('id, name, title, provider_type')
        .eq('clinic_id', clinicId)
        .is('deleted_at', null),
      supabaseAdmin
        .from('provider_services')
        .select('provider_id, service_id')
        .eq('clinic_id', clinicId),
    ]);

    const services = (servicesRes.data ?? []) as ClinicServiceForAI[];
    const providers = (providersRes.data ?? []) as ClinicProviderForAI[];
    const providerServiceIds = (assignmentsRes.data ?? []) as Array<{ provider_id: string; service_id: string }>;

    if (servicesRes.error) logEvent('clinic_data_services_error', { clinic_id: clinicId, error: servicesRes.error.message }, 'error');
    if (providersRes.error) logEvent('clinic_data_providers_error', { clinic_id: clinicId, error: providersRes.error.message }, 'error');
    if (assignmentsRes.error) logEvent('clinic_data_assignments_error', { clinic_id: clinicId, error: assignmentsRes.error.message }, 'error');

    return {
      services,
      providers,
      providerServiceIds,
      hasServices: services.length > 0,
      hasProviders: providers.length > 0,
      usable: services.length > 0 || providers.length > 0,
    };
  } catch (err) {
    logEvent('clinic_data_load_failed', { clinic_id: clinicId, error: err instanceof Error ? err.message : String(err) }, 'error');
    return { ...EMPTY_OPERATING_DATA };
  }
}

/**
 * Returns a patient-facing price description honoring the flexible pricing
 * model. NEVER returns "free" for price=0, and NEVER exposes a hidden price.
 */
export function describeServicePrice(service: ClinicServiceForAI): string | null {
  const hidden = service.price_visible_to_patients === false;
  if (hidden) return null;
  switch (service.pricing_type) {
    case 'fixed':
      return service.price_min != null && Number(service.price_min) > 0 ? String(service.price_min) : null;
    case 'range':
      if (service.price_min != null && service.price_max != null && Number(service.price_min) > 0 && Number(service.price_max) >= Number(service.price_min)) {
        return `${service.price_min}–${service.price_max}`;
      }
      return null;
    case 'estimate':
      return service.price_min != null && Number(service.price_min) > 0 ? `≈${service.price_min}` : null;
    case 'case_by_case':
    case 'unspecified':
    default:
      return null; // decided after examination — the AI must not invent a figure
  }
}

/**
 * Authoritative clinic profile read straight from the `clinics` table — the
 * SINGLE source of truth for clinic name/address/phone/website. This is what
 * stops the AI from hallucinating a clinic identity (e.g. inventing "ديمة" or
 * inferring the location from the patient's city). Fields are returned as null
 * when absent so the prompt can honestly say "not available" instead of guessing.
 */
export type ClinicProfile = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  timezone: string | null;
  hasProfile: boolean;
};

export const EMPTY_CLINIC_PROFILE: ClinicProfile = {
  id: '',
  slug: '',
  name: '',
  address: null,
  phone: null,
  website: null,
  timezone: null,
  hasProfile: false,
};

export async function loadClinicProfile(clinicId: string): Promise<ClinicProfile> {
  try {
    const { data, error } = await supabaseAdmin
      .from('clinics')
      .select('id, slug, name, address, phone, website, settings')
      .eq('id', clinicId)
      .maybeSingle();
    if (error || !data) {
      return { ...EMPTY_CLINIC_PROFILE, id: clinicId };
    }
    const settings = (data.settings ?? {}) as Record<string, unknown>;
    return {
      id: data.id,
      slug: data.slug,
      name: data.name,
      address: (data.address as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      website: (data.website as string | null) ?? null,
      timezone: (settings.timezone as string | null) ?? null,
      hasProfile: true,
    };
  } catch {
    return { ...EMPTY_CLINIC_PROFILE, id: clinicId };
  }
}

/**
 * Persists a REAL resolved availability slot into the conversation metadata so
 * follow-up turns ("أي ساعة؟", booking confirmation) reuse the exact same slot
 * instead of the AI guessing a new one. Clinic-scoped and idempotent — never
 * overwrites an existing slot unless explicitly passed.
 */
export async function persistReceptionistSlot(
  clinicId: string,
  conversationId: string,
  fields: {
    slot?: string;
    slot_start?: string;
    slot_end?: string;
    provider_id?: string;
    service_id?: string;
    patient_name?: string | null;
    phone?: string | null;
    email?: string | null;
  }
): Promise<void> {
  try {
    const { data: existing, error } = await supabaseAdmin
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error || !existing) return;
    const meta = (existing.metadata ?? {}) as Record<string, unknown>;
    const booking = { ...((meta.booking ?? {}) as Record<string, unknown>) };
    if (fields.slot !== undefined) booking.slot = fields.slot;
    if (fields.slot_start !== undefined) booking.slot_start = fields.slot_start;
    if (fields.slot_end !== undefined) booking.slot_end = fields.slot_end;
    if (fields.provider_id !== undefined) booking.provider_id = fields.provider_id;
    if (fields.service_id !== undefined) booking.service_id = fields.service_id;
    if (fields.patient_name !== undefined) booking.patient_name = fields.patient_name;
    if (fields.phone !== undefined) booking.phone = fields.phone;
    if (fields.email !== undefined) booking.email = fields.email;
    await supabaseAdmin
      .from('conversations')
      .update({ metadata: { ...meta, booking } })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId);
  } catch {
    // non-fatal — the in-memory slot still drives the current turn
  }
}


/**
 * Receptionist Conversation State — a serializable, prompt-safe subset of the
 * full state machine so the AI can drive the conversation (ask only what's
 * missing, never repeat known info, recommend real clinic resources).
 */
export type ReceptionistConversationState = {
  state: string;
  recommended_service_id: string | null;
  recommended_provider_id: string | null;
  patient_confirmed_booking: boolean;
  pending_question: string;
  /** Operational note for the current turn (e.g. slot became unavailable, booking completed). */
  booking_issue?: string | null;
  /**
   * Set when the patient names a specialty this clinic has NO service for
   * («بدي تقويم» in a clinic without orthodontics). The AI must ask reception
   * instead of inventing price/slots, and may still name a REAL specialist.
   */
  specialty_guidance?: string | null;
  /**
   * STEP 5 — Network Discovery note for this turn (computed from the REAL
   * clinic directory; never persisted, never invented). Absent = Clinic
   * Reception Mode (this clinic only).
   */
  discovery_guidance?: string | null;
  booking: {
    service_id: string | null;
    provider_id: string | null;
    slot: string | null;
    patient_name: string | null;
    phone: string | null;
    email: string | null;
    /** Real appointment created for this conversation (Phase 20 follow-ups). */
    appointment_id?: string | null;
    appointment_status?: string | null;
    scheduled_at?: string | null;
  };
  // ─── STEP 1: Understanding/context fields (all optional → backward compatible) ───
  /** Patient-side location as the patient described it — NEVER clinic location. */
  patient_location?: {
    city?: string | null;
    region?: string | null;
    source?: 'conversation' | 'user_selected' | 'shared_location' | null;
  } | null;
  requested_service?: string | null;
  preferred_provider?: string | null;
  /** Faithful record of the patient's own words — NOT a diagnosis. */
  patient_reported_symptoms?: string | null;
  preferred_date?: string | null;
  preferred_time_range?: { from?: string | null; to?: string | null } | null;
  /** Explicit time preferences ("1 أو 4" → ["13:00","16:00"]) — constraints, never invented slots. */
  preferred_time_options?: string[] | null;
  selected_clinic?: { id: string; slug: string; name: string } | null;
  network_discovery_agreed?: boolean | null;
  booking_intent?: boolean | null;
};

export async function loadReceptionistConversationState(
  clinicId: string,
  conversationId: string
): Promise<ReceptionistConversationState | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error || !data?.metadata) return null;

    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const savedState = (meta.state as string) || (meta.conversation_state_machine as string) || '';
    const bookingRaw = (meta.booking ?? {}) as Record<string, unknown>;
    // PatientContext (incl. specialty_without_service) is persisted inside the
    // state machine detail under metadata.context by persistConversationState.
    const contextRaw = (meta.context ?? {}) as Record<string, unknown>;
    return {
      state: savedState || 'INITIAL',
      recommended_service_id: (meta.recommended_service_id as string) ?? null,
      recommended_provider_id: (meta.recommended_provider_id as string) ?? null,
      patient_confirmed_booking: Boolean(meta.patient_confirmed_booking),
      pending_question: (meta.pending_question as string) ?? '',
      specialty_guidance:
        (contextRaw.specialty_without_service as string) ??
        (meta.specialty_without_service as string) ??
        null,
      booking: {
        service_id: (bookingRaw.service_id as string) ?? null,
        provider_id: (bookingRaw.provider_id as string) ?? null,
        slot: (bookingRaw.slot as string) ?? null,
        patient_name: (bookingRaw.patient_name as string) ?? null,
        phone: (bookingRaw.phone as string) ?? null,
        email: (bookingRaw.email as string) ?? null,
        appointment_id: (bookingRaw.appointment_id as string) ?? null,
        appointment_status: (bookingRaw.status as string) ?? null,
        scheduled_at: (bookingRaw.scheduled_at as string) ?? null,
      },
      // ─── STEP 1: understanding context (reads metadata.reception_context) ───
      ...loadContextFields(meta),
    };
  } catch {
    return null;
  }
}

/**
 * Maps the stored understanding context (`metadata.reception_context`) onto the
 * receptionist state type. All fields are optional and default to null so older
 * conversations (without the field) stay fully valid.
 */
function loadContextFields(meta: Record<string, unknown>): Pick<
  ReceptionistConversationState,
  'patient_location' | 'requested_service' | 'preferred_provider' | 'patient_reported_symptoms' | 'preferred_date' | 'preferred_time_range' | 'preferred_time_options' | 'selected_clinic' | 'network_discovery_agreed' | 'booking_intent'
> {
  const ctx = (meta.reception_context ?? {}) as Record<string, unknown>;
  const pl = (ctx.patient_location ?? meta.patient_location ?? {}) as { city?: string | null; region?: string | null; area?: string | null; source?: string | null };
  return {
    patient_location: pl?.city || pl?.area || pl?.region
      ? {
          city: pl.city ?? pl.area ?? '',
          ...(pl.region ? { region: pl.region } : {}),
          source: (pl.source as 'conversation' | 'user_selected' | 'shared_location' | null) ?? 'conversation',
        }
      : null,
    requested_service: (ctx.requested_service as string) ?? null,
    preferred_provider: (ctx.preferred_provider as string) ?? null,
    patient_reported_symptoms: (ctx.patient_reported_symptoms as string) ?? null,
    preferred_date: (ctx.preferred_date as string) ?? null,
    preferred_time_range: (ctx.preferred_time_range as { from?: string | null; to?: string | null } | undefined) ?? null,
    preferred_time_options: Array.isArray(ctx.preferred_time_options) ? (ctx.preferred_time_options as string[]) : null,
    selected_clinic: (ctx.selected_clinic as { id: string; slug: string; name: string } | undefined) ?? null,
    network_discovery_agreed: (ctx.network_discovery_agreed as boolean | undefined) ?? null,
    booking_intent: (ctx.booking_intent as boolean | undefined) ?? null,
  };
}

/** Conversational intents that must NEVER be blocked by an empty Knowledge Base. */
export const OPERATIVE_CONVERSATION_INTENTS = new Set([
  'appointment_booking',
  'appointment_reschedule',
  'appointment_cancellation',
  'patient_complaint',
  'dental_general_question',
  'general_question',
  'greeting',
  'goodbye',
  'human_handoff',
  'unknown',
]);