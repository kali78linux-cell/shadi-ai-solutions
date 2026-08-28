import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import type { PatientContext } from './patientContext';

export type ProviderMatch = {
  id: string;
  name: string;
  title: string | null;
  matchedServiceId: string | null;
  matchedServiceName: string | null;
  /** True when this provider was ranked up because their REAL title/name/type matches the requested specialty. */
  specialtyMatched?: boolean;
};

export type ReasoningResult = {
  recommendedServiceId: string | null;
  recommendedServiceName: string | null;
  recommendedProviderId: string | null;
  recommendedProviderName: string | null;
  candidates: ProviderMatch[];
  multipleProviders: boolean;
  /**
   * ROOT-CAUSE FIX («بدي اعمل تقويم» with no orthodontics service): set when
   * the patient's need names a specialty that THIS clinic has no service for.
   * The AI must then say the service needs reception confirmation instead of
   * inventing a price/slot — while still being able to suggest a REAL
   * specialist provider from the clinic's provider records.
   */
  specialtyWithoutService: string | null;
};

/**
 * Deterministic service/provider reasoning within ONE clinic.
 * Uses patient need / likely specialty to select the best clinic service,
 * then matches providers via provider-service assignments.
 *
 * This is intentionally deterministic so it can be tested without an AI model.
 * The LLM sets `patientContext.likely_specialty` / `requested_need`; this
 * layer turns that into concrete clinic resources.
 */
export async function reasonServiceProvider(
  clinicId: string,
  context: PatientContext
): Promise<ReasoningResult> {
  const empty: ReasoningResult = {
    recommendedServiceId: null,
    recommendedServiceName: null,
    recommendedProviderId: null,
    recommendedProviderName: null,
    candidates: [],
    multipleProviders: false,
    specialtyWithoutService: null,
  };

  // Load the clinic's active services
  const { data: services, error: servicesError } = await supabaseAdmin
    .from('clinic_services')
    .select('id, name, description, active')
    .eq('clinic_id', clinicId)
    .eq('active', true)
    .is('deleted_at', null);
  if (servicesError || !services?.length) {
    return empty;
  }

  // Load providers and their service assignments
  const { data: providers, error: providersError } = await supabaseAdmin
    .from('providers')
    .select('id, name, title')
    .eq('clinic_id', clinicId)
    .is('deleted_at', null);
  if (providersError) {
    return empty;
  }

  // A booking recommendation is only valid when the clinic has at least one
  // currently available provider. Returning a service without a provider would
  // let the state machine present a booking path that cannot be completed.
  if (!providers?.length) {
    return empty;
  }

  const { data: assignments, error: assignmentError } = await supabaseAdmin
    .from('provider_services')
    .select('provider_id, service_id')
    .eq('clinic_id', clinicId);
  // If the link table errors (missing), fall back to all-providers-match-all services.
  const assignmentRows = !assignmentError && assignments ? assignments : null;

  // Clinical term table: [pattern, weight, Arabic specialty label].
  // Used for TWO distinct jobs: (a) scoring SERVICES by their OWN name/
  // description, (b) detecting which specialty the patient's NEED names so
  // PROVIDERS can be ranked by their real records. The need-side detection is
  // downstream of LLM semantic extraction — this layer never parses chat.
  const CLINICAL_TERMS: Array<[RegExp, number, string]> = [
    [/زراع|implant/i, 5, 'زراعة الأسنان'],
    [/تقويم|orthodont|braces/i, 5, 'التقويم'],
    [/عصب|root canal|root|crown|لب/i, 4, 'علاج العصب'],
    [/تبييض|whitening/i, 4, 'تبييض الأسنان'],
    [/حشوة|filling/i, 4, 'الحشوات'],
    [/أشعة|ray|x-ray|صورة|panorama/i, 4, 'الأشعة'],
    [/خلع|extract/i, 3, 'الخلع'],
    [/تنظيف|clean/i, 3, 'التنظيف'],
    [/فحص|exam|check/i, 2, 'الفحص العام'],
  ];

  function serviceScore(service: { name: string; description: string | null }): number {
    // FIX: score ONLY what the service itself is. The old code also tested the
    // patient's need here, which made EVERY service tie whenever the need
    // mentioned a specialty («بدي تقويم» ranked تنظيف equal to anything else).
    const hay = (service.name + ' ' + (service.description ?? '')).toLowerCase();
    let score = 0;
    for (const [re, w] of CLINICAL_TERMS) {
      if (re.test(hay)) score += w;
    }
    return score;
  }

  const rankedServices = services
    .map((s) => ({ service: s, score: serviceScore(s) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Which specialties does the patient's need actually name?
  // The need text comes from LLM semantic extraction (requested_need/problem).
  const need = `${context.requested_need ?? ''} ${context.problem ?? ''}`.trim();
  const needTerms = CLINICAL_TERMS.filter(([re]) => re.test(need));

  // A specialty named by the patient but ABSENT from this clinic's services:
  // surfaced so the AI asks reception instead of inventing price/slots.
  let specialtyWithoutService: string | null = null;
  for (const [re, , label] of [...needTerms].sort((a, b) => b[1] - a[1])) {
    const served = rankedServices.some((r) => re.test((r.service.name + ' ' + (r.service.description ?? '')).toLowerCase()));
    if (!served && !specialtyWithoutService) specialtyWithoutService = label;
  }

  // If no specialty-specific service exists, prefer a general "فحص الأسنان"
  // (examination) so the booking path can still continue safely.
  let matchedService = rankedServices.length ? rankedServices[0].service : null;
  if (!matchedService) {
    matchedService = services.find((s) => /فحص|exam|check/i.test(s.name)) ?? services[0];
  }

  // 2. Find providers assigned to this service
  const providerPool = providers ?? [];
  let matchingProviders = providerPool;
  if (assignmentRows) {
    const assignedProviderIds = new Set(
      assignmentRows.filter((a) => a.service_id === matchedService.id).map((a) => a.provider_id)
    );
    matchingProviders = providerPool.filter((p) => assignedProviderIds.has(p.id));
  }
  // If no provider is assigned to the matched service but providers exist, allow all
  if (matchingProviders.length === 0) {
    matchingProviders = providerPool;
  }

  // 3. ROOT-CAUSE FIX («د. سارة محمود — أخصائية تقويم» must win «بدي تقويم»):
  // rank providers by their REAL structured records (name/title) against the
  // specialty the need names. Real-data specialist alignment — the first-row
  // pick previously ignored titles entirely.
  function providerSpecialtyScore(p: { name?: string; title?: string | null }): number {
    const identity = `${p.name ?? ''} ${p.title ?? ''}`;
    return needTerms.reduce((score, [re, w]) => (re.test(identity) ? score + w : score), 0);
  }
  matchingProviders = [...matchingProviders].sort(
    (a, b) => providerSpecialtyScore(b) - providerSpecialtyScore(a)
  );

  const candidates: ProviderMatch[] = matchingProviders.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title ?? null,
    matchedServiceId: matchedService.id,
    matchedServiceName: matchedService.name,
    specialtyMatched: providerSpecialtyScore(p) > 0,
  }));

  const recommended = candidates[0] ?? null;

  return {
    recommendedServiceId: matchedService.id,
    recommendedServiceName: matchedService.name,
    recommendedProviderId: recommended?.id ?? null,
    recommendedProviderName: recommended?.name ?? null,
    candidates,
    multipleProviders: candidates.length > 1,
    specialtyWithoutService,
  };
}
