import { findNearbyClinics, type ClinicDirectoryEntry } from '@/lib/services/clinicDirectory';

/**
 * STEP 5 — Network Discovery Mode.
 *
 * Turns an EXPLICIT patient request for alternative clinics («بدي عيادة ثانية»،
 * «وين أقرب عيادة؟») into a per-turn guidance note built ONLY from the real
 * clinic directory (lib/services/clinicDirectory — read-only, public-safe).
 *
 * Guarantees:
 * - Returns null unless the patient explicitly agreed → Clinic Reception Mode
 *   (this clinic only) is the default and is never left silently.
 * - NEVER invents clinics/addresses/distances: an empty directory yields an
 *   honest "no other clinics listed" note, and a failed lookup falls back to
 *   normal reception mode instead of surfacing an error.
 * - The note is PROMPT-ONLY: it is never persisted and never replaces
 *   metadata.booking / metadata.reception_context.
 */

export type DiscoveryInput = {
  agreed?: boolean | null;
  patientCity?: string | null;
  requestedService?: string | null;
  currentClinicName?: string | null;
};

/** Pure formatter — exported for deterministic unit tests. */
export function formatDiscoveryGuidance(
  entries: ClinicDirectoryEntry[],
  currentClinicName: string | null | undefined
): string {
  const others = entries.filter((e) => !currentClinicName || e.name !== currentClinicName);
  if (others.length === 0) {
    return 'Network Discovery Mode (this turn only): the patient asked for other/nearby clinics. You searched the REAL clinic directory and NO other listed clinics matched. Say honestly that no other clinics are available in the directory right now; do NOT invent clinic names, cities, addresses, or distances. This clinic remains the default.';
  }
  const listed = others
    .map((e) => {
      const city = e.city ? ` (${e.city})` : '';
      const dist = e.distance_km != null ? ` — ${e.distance_km.toFixed(1)} km` : '';
      return `${e.name}${city}${dist}`;
    })
    .join('، ');
  return `Network Discovery Mode (this turn only): the patient asked for other/nearby clinics. REAL directory matches: ${listed}. Mention ONLY these clinics, with name/city/distance exactly as shown (if no distance is shown, do not state one). Never invent other clinics, addresses, phone numbers, or availability for them. This clinic remains the default unless the patient explicitly chooses one of the listed alternatives.`;
}

/** Main entry: null = stay in Clinic Reception Mode (no discovery this turn). */
export async function buildDiscoveryGuidance(input: DiscoveryInput): Promise<string | null> {
  if (!input.agreed) return null;
  try {
    if (!input.patientCity) {
      // No area known → asking for one is the honest next step; listing
      // arbitrary clinics would effectively be invention.
      return 'Network Discovery Mode (this turn only): the patient asked for other/nearby clinics but no area is known yet. Do NOT list or invent any clinic. Ask the patient for their city/area first; this clinic remains the default meanwhile.';
    }
    const entries = await findNearbyClinics({
      area: input.patientCity,
      service: input.requestedService ?? undefined,
      limit: 5,
    });
    return formatDiscoveryGuidance(entries, input.currentClinicName);
  } catch {
    // Directory failure must never become "AI unavailable" and must never
    // fabricate results — fall back to normal Clinic Reception Mode.
    console.warn('[discovery] clinic directory lookup failed; falling back to reception mode');
    return null;
  }
}