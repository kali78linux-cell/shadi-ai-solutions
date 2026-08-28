import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * STEP 1 — Conversation Context (understanding layer state)
 *
 * This is a structured, Zod-validated extension of the receptionist's
 * conversation memory. It is stored in `conversations.metadata.reception_context`
 * and NEVER replaces the existing booking state / `metadata.booking`.
 *
 * Architectural rules enforced here:
 *  - patient_location is PATIENT-side info only. It must never be treated as,
 *    or written into, the clinic's location (which lives in `clinics`).
 *  - patient_reported_symptoms is a faithful record of what the patient said.
 *    It is NOT a diagnosis and carries no medical interpretation.
 *  - Every field is OPTIONAL → conversations created before this feature load
 *    cleanly (backward compatible).
 */

const timeString = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/);

export const conversationContextSchema = z.object({
  patient_location: z
    .object({
      city: z.string().max(120).optional(),
      region: z.string().max(120).optional(),
      // Matches the existing PatientLocationSource enum in lib/ai/patientLocation.ts
      // (conversation | user_selected | shared_location).
      source: z.enum(['conversation', 'user_selected', 'shared_location']).optional(),
    })
    .optional(),
  requested_service: z.string().max(200).optional(),
  preferred_provider: z.string().max(200).optional(),
  /** Faithful record of the patient's own words — NOT a medical diagnosis. */
  patient_reported_symptoms: z.string().max(2000).optional(),
  preferred_date: z.string().max(20).optional(),
  preferred_time_range: z
    .object({
      from: timeString.optional(),
      to: timeString.optional(),
    })
    .optional(),
  /** Explicit time preferences like "1 أو 4" → ["13:00","16:00"]. Constraints only — never invented slots. */
  preferred_time_options: z.array(timeString).optional(),
  selected_clinic: z
    .object({ id: z.string().min(1), slug: z.string().min(1), name: z.string().min(1) })
    .optional(),
  network_discovery_agreed: z.boolean().optional(),
  booking_intent: z.boolean().optional(),
});

export type ConversationContext = z.infer<typeof conversationContextSchema>;

export const EMPTY_CONVERSATION_CONTEXT: ConversationContext = {};

/** Validates + sanitises raw metadata into a safe ConversationContext. */
export function normalizeConversationContext(raw: unknown): ConversationContext {
  const parsed = conversationContextSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

/**
 * Incremental merge: NEVER clears existing values unless the patch explicitly
 * provides a new value. Nested objects (patient_location, time_range,
 * selected_clinic) are merged field-by-field so e.g. adding `region` later
 * doesn't wipe an earlier `city`.
 */
export function mergeConversationContext(
  current: ConversationContext,
  patch: ConversationContext
): ConversationContext {
  const merged: ConversationContext = { ...current, ...patch };

  if (patch.patient_location) {
    merged.patient_location = { ...current.patient_location, ...patch.patient_location };
  }
  if (patch.preferred_time_range) {
    merged.preferred_time_range = { ...current.preferred_time_range, ...patch.preferred_time_range };
  }
  if (patch.selected_clinic) {
    merged.selected_clinic = { ...current.selected_clinic, ...patch.selected_clinic };
  }
  if (patch.patient_reported_symptoms && current.patient_reported_symptoms) {
    // Keep a faithful running record of what the patient reported (append),
    // still without any diagnosis interpretation.
    const combined = `${current.patient_reported_symptoms} / ${patch.patient_reported_symptoms}`;
    merged.patient_reported_symptoms = combined.slice(0, 2000);
  }

  return normalizeConversationContext(merged);
}

/**
 * Reads the conversation context from `conversations.metadata.reception_context`.
 * Falls back to `metadata.patient_location` (written by lib/ai/patientLocation.ts)
 * so older conversations keep their patient location.
 */
export async function loadConversationContext(
  clinicId: string,
  conversationId: string
): Promise<ConversationContext> {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error || !data) return {};

    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const context = normalizeConversationContext(meta.reception_context);

    // Backward compatibility with the dedicated patient_location namespace.
    if (!context.patient_location && meta.patient_location) {
      const pl = (meta.patient_location ?? {}) as { area?: string | null; source?: string };
      if (pl?.area) {
        const source: 'conversation' | 'user_selected' | 'shared_location' =
          pl.source === 'user_selected' || pl.source === 'shared_location' ? pl.source : 'conversation';
        context.patient_location = { city: pl.area, source };
      }
    }

    return context;
  } catch {
    return {};
  }
}

/**
 * Incrementally persists the context under `metadata.reception_context`,
 * preserving `metadata.booking` and every other metadata key. Returns false
 * (gracefully) when the conversation is missing or the write fails.
 */
export async function saveConversationContext(
  clinicId: string,
  conversationId: string,
  patch: ConversationContext
): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error || !data) return false;

    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const current = normalizeConversationContext(meta.reception_context);
    const merged = mergeConversationContext(current, patch);

    const { error: updateError } = await supabaseAdmin
      .from('conversations')
      .update({ metadata: { ...meta, reception_context: merged } })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId);

    return !updateError;
  } catch {
    return false;
  }
}
