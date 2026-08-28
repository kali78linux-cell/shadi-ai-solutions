import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * PATIENT LOCATION — intentionally a SEPARATE concept from ClinicLocation.
 *
 * Architectural rule (post-mortem of the "عيادة ديمة تقع في رام الله" bug):
 * the patient mentioning their city/area is information about THE PATIENT.
 * It must NEVER mutate, infer, or decorate the clinic's own location fields,
 * and it never feeds the AI prompt as if it were clinic data.
 *
 * Stored as conversation metadata: conversations.metadata.patient_location
 * = { area?, source }, where source documents how we learned it:
 *   user_selected   — patient picked it in UI
 *   shared_location — patient shared device location (backend-derived area)
 *   conversation    — extracted from what the patient wrote
 */

export const PATIENT_LOCATION_SOURCES = ['user_selected', 'shared_location', 'conversation'] as const;

export type PatientLocationSource = (typeof PATIENT_LOCATION_SOURCES)[number];

export type PatientLocation = {
  /** Free-text area/city name as known by the patient ("رام الله"). */
  area?: string | null;
  source: PatientLocationSource;
  captured_at: string;
};

export const patientLocationSchema = z.object({
  area: z.string().max(120).nullish(),
  source: z.enum(PATIENT_LOCATION_SOURCES),
});

/**
 * STEP 6 — Location Flow: validated builder for a MANUALLY / SHARED patient
 * location (chosen in UI or derived server-side from opt-in device location).
 * This is the one path NOT covered by `extractPatientLocation` (which only
 * yields `source: 'conversation'`). It returns the shared conversation-context
 * shape `{ city, region?, source }` so it flows straight into
 * `ConversationContext`/`ReceptionistConversationState` without a second shape.
 *
 * Privacy + separation guarantees (enforced here):
 *  - Returns PATIENT-side info only; never touches `clinics`.
 *  - Never emits raw GPS; a `shared_location` is represented solely by an
 *    area/city name and its provenance tag.
 *  - Rejects anything with no city and unknown sources → `undefined`.
 */
export function buildManualPatientLocation(input: {
  city: string;
  region?: string | null;
  source?: 'user_selected' | 'shared_location';
}): {
  city: string;
  region?: string;
  source: 'user_selected' | 'shared_location';
} | undefined {
  const city = (input.city ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!city) return undefined;
  const region = input.region && input.region.trim() ? input.region.trim().replace(/\s+/g, ' ').slice(0, 120) : undefined;
  const source = input.source ?? 'user_selected';
  if (source !== 'user_selected' && source !== 'shared_location') return undefined;
  return { city, ...(region ? { region } : {}), source };
}

/**
 * Persists patient-side location onto ONE conversation row, strictly scoped
 * by (clinic_id, conversation_id). Never touches `clinics` — enforced by only
 * ever issuing this single update target here (covered by unit test).
 */
export async function persistPatientLocation(
  clinicId: string,
  conversationId: string,
  input: z.input<typeof patientLocationSchema>
): Promise<boolean> {
  const parsed = patientLocationSchema.safeParse(input);
  if (!parsed.success) return false;

  try {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('metadata')
      .eq('id', conversationId)
      .eq('clinic_id', clinicId)
      .maybeSingle();
    if (error || !data) return false;

    const meta = (data.metadata ?? {}) as Record<string, unknown>;
    const location: PatientLocation = {
      area: parsed.data.area ?? null,
      source: parsed.data.source,
      captured_at: new Date().toISOString(),
    };
    meta.patient_location = location;

    const { error: updateError } = await supabaseAdmin
      .from('conversations')
      .update({ metadata: meta })
      .eq('id', conversationId)
      .eq('clinic_id', clinicId);
    return !updateError;
  } catch {
    return false;
  }
}
