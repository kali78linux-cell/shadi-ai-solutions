import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabase = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mockSupabase }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { reasonServiceProvider } from '@/lib/services/receptionistReasoning';
import { EMPTY_PATIENT_CONTEXT } from '@/lib/services/patientContext';

type Dataset = {
  services: Array<Record<string, unknown>>;
  providers: Array<Record<string, unknown>>;
  assignments: Array<Record<string, unknown>>;
};

function configureQueries(dataset: Dataset) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  mockSupabase.from.mockImplementation((table: string) => {
    const filters: Array<[string, unknown]> = [];
    const rows = table === 'clinic_services'
      ? dataset.services
      : table === 'providers'
        ? dataset.providers
        : dataset.assignments;
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return query; }),
      is: vi.fn((column: string, value: unknown) => { filters.push([column, value]); return Promise.resolve({ data: rows, error: null }); }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
    };
    calls.push({ table, filters });
    return query;
  });
  return calls;
}

const clinicId = 'clinic-a';
const context = { ...EMPTY_PATIENT_CONTEXT, problem: 'ألم في ضرس', likely_specialty: 'root canal' };

describe('reasonServiceProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns service and provider IDs only from the requested clinic', async () => {
    const calls = configureQueries({
      services: [{ id: 'service-a', name: 'علاج عصب', description: null, active: true }],
      providers: [{ id: 'provider-a', name: 'د. أ', title: 'Dentist' }],
      assignments: [{ service_id: 'service-a', provider_id: 'provider-a' }],
    });

    const result = await reasonServiceProvider(clinicId, context);

    expect(result).toMatchObject({ recommendedServiceId: 'service-a', recommendedProviderId: 'provider-a' });
    expect(calls).toHaveLength(3);
    for (const call of calls) expect(call.filters).toContainEqual(['clinic_id', clinicId]);
  });


  // FIX B regression (manual-user-test Finding B): pain/sensitivity needs that
  // name NO specialty must fall back to the general exam — never the highest
  // static service score (which ranked «أشعة أسنان» over a proper exam).
  it('falls back to the general exam for unspecific pain needs instead of the top static score', async () => {
    configureQueries({
      services: [
        { id: 'svc-xray', name: 'أشعة أسنان', description: null, active: true },
        { id: 'svc-clean', name: 'تنظيف أسنان', description: null, active: true },
        { id: 'svc-exam', name: 'فحص أسنان', description: null, active: true },
      ],
      providers: [{ id: 'prov-a', name: 'د. أ', title: 'Dentist' }],
      assignments: [],
    });

    const result = await reasonServiceProvider(clinicId, {
      ...EMPTY_PATIENT_CONTEXT,
      requested_need: 'طاحونتي بتجعني لمن بشرب بارد',
      problem: 'حساسية ووجع بالضرس',
    });

    expect(result.recommendedServiceId).toBe('svc-exam');
  });

  // FIX B regression: a specialty the need actually names still wins when the
  // clinic offers it (normal recommendation path is preserved).
  it('still recommends the specialty service when the need names it', async () => {
    configureQueries({
      services: [
        { id: 'svc-xray', name: 'أشعة أسنان', description: null, active: true },
        { id: 'svc-canal', name: 'علاج عصب', description: null, active: true },
        { id: 'svc-exam', name: 'فحص أسنان', description: null, active: true },
      ],
      providers: [{ id: 'prov-a', name: 'د. أ', title: 'Dentist' }],
      assignments: [],
    });

    const result = await reasonServiceProvider(clinicId, {
      ...EMPTY_PATIENT_CONTEXT,
      requested_need: 'بدي علاج عصب للضرس',
      problem: null,
    });

    expect(result.recommendedServiceId).toBe('svc-canal');
  });

  it('returns no recommendation when the clinic has no active services', async () => {
    configureQueries({ services: [], providers: [{ id: 'provider-a', name: 'د. أ', title: null }], assignments: [] });

    await expect(reasonServiceProvider(clinicId, context)).resolves.toMatchObject({
      recommendedServiceId: null,
      recommendedProviderId: null,
    });
  });

  it('returns no recommendation when the clinic has no active provider', async () => {
    configureQueries({ services: [{ id: 'service-a', name: 'علاج عصب', description: null, active: true }], providers: [], assignments: [] });

    await expect(reasonServiceProvider(clinicId, context)).resolves.toMatchObject({
      recommendedServiceId: null,
      recommendedProviderId: null,
    });
  });

  it('does not select an assignment provider outside the clinic provider pool', async () => {
    configureQueries({
      services: [{ id: 'service-a', name: 'علاج عصب', description: null, active: true }],
      providers: [{ id: 'provider-a', name: 'د. أ', title: null }],
      assignments: [{ service_id: 'service-a', provider_id: 'provider-other-clinic' }],
    });

    const result = await reasonServiceProvider(clinicId, context);

    // Existing fallback policy: no valid in-clinic assignment means any
    // in-clinic provider may serve the matched service.
    expect(result).toMatchObject({ recommendedServiceId: 'service-a', recommendedProviderId: 'provider-a' });
    expect(result.recommendedProviderId).not.toBe('provider-other-clinic');
  });

  it('uses the documented all-in-clinic-providers fallback when assignments are absent', async () => {
    configureQueries({
      services: [{ id: 'service-a', name: 'علاج عصب', description: null, active: true }],
      providers: [{ id: 'provider-a', name: 'د. أ', title: null }],
      assignments: [],
    });

    await expect(reasonServiceProvider(clinicId, context)).resolves.toMatchObject({
      recommendedServiceId: 'service-a',
      recommendedProviderId: 'provider-a',
    });
  });
});
