import { supabaseAdmin } from '@/lib/supabase/admin';
import { logEvent } from '@/lib/server/logging';
import type { PatientContext } from './patientContext';

export type ProviderMatch = {
  id: string;
  name: string;
  title: string | null;
  matchedServiceId: string | null;
  matchedServiceName: string | null;
};

export type ReasoningResult = {
  recommendedServiceId: string | null;
  recommendedServiceName: string | null;
  recommendedProviderId: string | null;
  recommendedProviderName: string | null;
  candidates: ProviderMatch[];
  multipleProviders: boolean;
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

  const { data: assignments, error: assignmentError } = await supabaseAdmin
    .from('provider_services')
    .select('provider_id, service_id')
    .eq('clinic_id', clinicId);
  // If the link table errors (missing), fall back to all-providers-match-all services.
  const assignmentRows = !assignmentError && assignments ? assignments : null;

  // 1. Pick the clinic service that best matches the patient's need/specialty
  const need = (context.requested_need + ' ' + context.likely_specialty + ' ' + context.problem).toLowerCase();

  function serviceScore(service: { name: string; description: string | null }): number {
    const hay = (service.name + ' ' + (service.description ?? '')).toLowerCase();
    let score = 0;
    const keywords: Array<[RegExp, number]> = [
      [/زراع|implant/i, 5],
      [/تقويم|orthodont|braces/i, 5],
      [/عصب|root canal|root|crown|لب/i, 4],
      [/تبييض|whitening/i, 4],
      [/حشوة|filling/i, 4],
      [/خلع|extract/i, 3],
      [/تنظيف|clean/i, 3],
      [/فحص|exam|check/i, 2],
      [/أشعة|ray|x-ray|صورة|panorama/i, 4],
    ];
    for (const [re, w] of keywords) {
      if (re.test(hay) || re.test(need)) score += w;
    }
    return score;
  }

  const rankedServices = services
    .map((s) => ({ service: s, score: serviceScore(s) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // If no specialty keyword matched, prefer a general "فحص الأسنان" (examination)
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

  const candidates: ProviderMatch[] = matchingProviders.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title ?? null,
    matchedServiceId: matchedService.id,
    matchedServiceName: matchedService.name,
  }));

  const recommended = candidates[0] ?? null;

  return {
    recommendedServiceId: matchedService.id,
    recommendedServiceName: matchedService.name,
    recommendedProviderId: recommended?.id ?? null,
    recommendedProviderName: recommended?.name ?? null,
    candidates,
    multipleProviders: candidates.length > 1,
  };
}