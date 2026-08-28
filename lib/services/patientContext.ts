import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';

/**
 * Structured patient context accumulated across conversation turns.
 * Persisted per-conversation in the `conversations.metadata.subject_analysis`
 * field so nothing is lost between messages.
 */
export type PatientContext = {
  problem: string;
  location: string;
  specific_location: string;
  duration: string;
  severity: string;
  trigger: string;
  associated_symptoms: string[];
  swelling: boolean | null;
  fever: boolean | null;
  bleeding: boolean | null;
  trauma: boolean | null;
  urgency: '' | 'low' | 'normal' | 'high' | 'critical';
  requested_need: string;
  likely_specialty: string;
  /**
   * ROOT-CAUSE FIX («بدي اعمل تقويم» with no orthodontics service): Arabic
   * label of a specialty the patient named that THIS clinic has no service
   * for. Sticky for the conversation; blocks fake booking recommendations and
   * tells the AI to confirm availability with reception instead.
   */
  specialty_without_service: string;
  recommended_service: string;
  recommended_provider: string;
  informed_pricing_visible: boolean;
};

export const EMPTY_PATIENT_CONTEXT: PatientContext = {
  problem: '',
  location: '',
  specific_location: '',
  duration: '',
  severity: '',
  trigger: '',
  associated_symptoms: [],
  swelling: null,
  fever: null,
  bleeding: null,
  trauma: null,
  urgency: '',
  requested_need: '',
  likely_specialty: '',
  specialty_without_service: '',
  recommended_service: '',
  recommended_provider: '',
  informed_pricing_visible: false,
};

/**
 * Merges newly-extracted partial context into the existing accumulated context.
 * Preserves existing fields unless the new message provides a better value.
 */
export function mergePatientContext(
  existing: Partial<PatientContext>,
  incoming: Partial<PatientContext>
): PatientContext {
  const result: PatientContext = { ...EMPTY_PATIENT_CONTEXT, ...existing };

  // Simple heuristic: incoming non-empty value wins, but never lose existing info
  // for fields the new message has not addressed.
  (Object.keys(incoming) as Array<keyof PatientContext>).forEach((key) => {
    const val = (incoming as Record<keyof PatientContext, unknown>)[key];
    if (val === undefined || val === null || val === '' || val === false) return;

    if (Array.isArray(val)) {
      const current = (result[key] as unknown as string[]) || [];
      const set = new Set([...current, ...(val as string[])]);
      (result as Record<keyof PatientContext, unknown>)[key] = Array.from(set);
    } else if (typeof val === 'string') {
      const current = (result as Record<keyof PatientContext, unknown>)[key] as string | undefined;
      if (!current || current.length === 0) {
        (result as Record<keyof PatientContext, unknown>)[key] = val;
      }
    } else if (typeof val === 'boolean') {
      (result as Record<keyof PatientContext, unknown>)[key] = val as boolean;
    } else if (typeof val === 'number') {
      (result as Record<keyof PatientContext, unknown>)[key] = val as number;
    }
  });

  return result;
}

/**
 * Loads the current patient context for a conversation from its metadata.
 */
export async function loadPatientContext(conversationId: string, clinicId: string): Promise<PatientContext> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) {
    logEvent('patient_context_load_failed', { conversation_id: conversationId, error: error.message }, 'error');
    return { ...EMPTY_PATIENT_CONTEXT };
  }
  const ctx = data?.metadata?.subject_analysis as Partial<PatientContext> | undefined;
  return ctx ? { ...EMPTY_PATIENT_CONTEXT, ...ctx } : { ...EMPTY_PATIENT_CONTEXT };
}

/**
 * Persists the current patient context into the conversation metadata.
 */
export async function savePatientContext(
  conversationId: string,
  clinicId: string,
  context: PatientContext,
  extraMetadata: Record<string, unknown> = {}
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('conversations')
    .select('metadata')
    .eq('id', conversationId)
    .eq('clinic_id', clinicId)
    .maybeSingle();
  if (error) {
    logEvent('patient_context_save_failed', { conversation_id: conversationId, error: error.message }, 'error');
    return;
  }
  const metadata = data?.metadata ?? {};
  const newMetadata = {
    ...metadata,
    subject_analysis: context,
    ...extraMetadata,
  };
  await supabaseAdmin
    .from('conversations')
    .update({ metadata: newMetadata })
    .eq('id', conversationId)
    .eq('clinic_id', clinicId);
}