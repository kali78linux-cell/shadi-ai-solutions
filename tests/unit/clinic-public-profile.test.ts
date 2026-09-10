import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPublicClinicProfile, publicClinicUrl } from '@/lib/services/clinicPublicProfile';
import { clinicQrDestination } from '@/lib/qr/clinicQr';

// STEP 15D — Public Clinic Profile projection tests (deny-by-default).

const CID = '11111111-1111-1111-1111-111111111111';

const mockState = vi.hoisted(() => ({
  results: {} as Record<string, any>,
  error: null as any,
  eqCalls: {} as Record<string, Array<[string, unknown]>>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {};
      const resolved = () => ({ data: mockState.results[table] ?? null, error: mockState.error });
      for (const m of ['select', 'is', 'order', 'limit', 'lte', 'gte', 'lt', 'gt']) chain[m] = () => chain;
      chain.eq = (col: string, val: unknown) => {
        (mockState.eqCalls[table] ??= []).push([col, val]);
        return chain;
      };
      chain.maybeSingle = () => resolved();
      chain.single = () => resolved();
      chain.then = (res: (x: unknown) => void) => res(resolved());
      return chain;
    }),
  },
}));

function baseClinicRow(overrides: Record<string, unknown> = {}) {
  return {
    id: CID,
    slug: 'demo-clinic',
    name: 'Demo Clinic',
    logo: null,
    city: 'عمّان',
    area: 'وسط البلد',
    address_detail: 'شارع المدينة الطبي',
    phone: '0791234567',
    settings: {},
    ...overrides,
  };
}

describe('15D — getPublicClinicProfile (public projection)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockState.results['clinics'];
    delete mockState.results['clinic_services'];
    delete mockState.results['provider_schedules'];
    delete mockState.results['providers'];
    delete mockState.results['clinic_ads'];
    mockState.error = null;
    mockState.eqCalls = {};
  });

  it('resolves a full public profile with allow-listed fields only', async () => {
    mockState.results = {
      clinics: baseClinicRow(),
      clinic_services: [
        {
          name: 'فحص شامل',
          description: 'تقييم عام',
          duration_minutes: 30,
          price: 25,
          price_min: null,
          price_max: null,
          price_visible_to_patients: true,
        },
      ],
      providers: [{ name: 'د. أحمد', title: 'طبيب', specialty: 'تقويم' }],
      clinic_ads: [],
      provider_schedules: [
        { weekday: 0, start_time: '09:00', end_time: '17:00', enabled: true },
        { weekday: 0, start_time: '10:00', end_time: '15:00', enabled: true },
        { weekday: 1, start_time: '09:00', end_time: '14:00', enabled: true },
      ],
    };

    const profile = await getPublicClinicProfile({ slug: 'demo-clinic' });
    expect(profile).not.toBeNull();
    expect(profile?.name).toBe('Demo Clinic');

    // Deny-by-default: the projection object may contain only these keys.
    const allowedProfileKeys = new Set([
      'id',
      'public_id',
      'slug',
      'name',
      'logo',
      'description',
      'city',
      'area',
      'address',
      'phone',
      'services',
      'providers',
      'ads',
      'workingHours',
      'bookingUrl',
      'chatUrl',
      'pageUrl',
      'tagline',
      'about',
      'cover_url',
      'social_links',
      'sections',
      'display',
      'theme',
    ]);
    for (const key of Object.keys(profile as Record<string, unknown>)) {
      expect(allowedProfileKeys.has(key)).toBe(true);
    }

    // phone hidden by default; prices hidden by default.
    expect(profile?.phone).toBeNull();
    expect(profile?.services[0].price).toBeNull();
    expect(profile?.services[0].price_min).toBeNull();
    expect(profile?.services[0].price_max).toBeNull();

    // Working hours aggregated across providers, minimal span kept.
    expect(profile?.workingHours).toEqual([
      { weekday: 0, start_time: '09:00', end_time: '17:00' },
      { weekday: 1, start_time: '09:00', end_time: '14:00' },
    ]);

    // CTAs reuse the existing public paths with the correct param shape.
    expect(profile?.bookingUrl).toBe('/book?slug=demo-clinic');
    expect(profile?.chatUrl).toBe('/chat?clinic=demo-clinic');
  });

  it('shows phone only when settings.show_phone is true', async () => {
    mockState.results = {
      clinics: baseClinicRow({ settings: { show_phone: true } }),
      clinic_services: [],
      providers: [],
      clinic_ads: [],
      provider_schedules: [],
    };
    const profile = await getPublicClinicProfile({ slug: 'demo-clinic' });
    expect(profile?.phone).toBe('0791234567');
  });

  it('shows prices only when show_prices AND per-service visibility are both on', async () => {
    mockState.results = {
      clinics: baseClinicRow({ settings: { show_prices: true } }),
      clinic_services: [
        { name: 'أ', description: null, duration_minutes: 15, price: 100, price_min: null, price_max: null, price_visible_to_patients: true },
        { name: 'ب', description: null, duration_minutes: 15, price: 200, price_min: null, price_max: null, price_visible_to_patients: false },
      ],
      providers: [],
      clinic_ads: [],
      provider_schedules: [],
    };
    const profile = await getPublicClinicProfile({ slug: 'demo-clinic' });
    expect(profile?.services[0].price).toBe(100);
    expect(profile?.services[1].price).toBeNull();
  });

  it('returns null when the clinic is missing/soft-deleted', async () => {
    mockState.results = { clinics: null, clinic_services: [], provider_schedules: [] };
    const profile = await getPublicClinicProfile({ slug: 'does-not-exist' });
    expect(profile).toBeNull();
  });

  it('exposes only public service fields', async () => {
    mockState.results = {
      clinics: baseClinicRow({ settings: { show_prices: true } }),
      clinic_services: [
        { name: 'أ', description: 'x', duration_minutes: 15, price: 100, price_min: 80, price_max: 120, price_visible_to_patients: true },
      ],
      providers: [],
      clinic_ads: [],
      provider_schedules: [],
    };
    const profile = await getPublicClinicProfile({ slug: 'demo-clinic' });
    const service = profile?.services[0] as Record<string, unknown>;
    expect(Object.keys(service).sort()).toEqual([
      'duration_minutes',
      'name',
      'price',
      'price_max',
      'price_min',
      'description',
    ].sort());
  });

  it('cross-tenant guard: services/schedules are queried ONLY with the resolved clinic id', async () => {
    mockState.results = {
      // Attacker passes clinic A slug; resolver returns clinic A's row.
      clinics: { ...baseClinicRow(), slug: 'clinic-a' },
      clinic_services: [
        { name: 'أ', description: null, duration_minutes: 10, price: 10, price_min: null, price_max: null, price_visible_to_patients: false },
      ],
      providers: [],
      clinic_ads: [],
      provider_schedules: [{ weekday: 0, start_time: '09:00', end_time: '18:00', enabled: true }],
    };

    await getPublicClinicProfile({ slug: 'clinic-a' });

    // The clinic-scoped queries must be filtered by the resolved uuid (the
    // tenant resolved server-side), never by any client-supplied value.
    const servicesEq = mockState.eqCalls['clinic_services'] ?? [];
    const schedulesEq = mockState.eqCalls['provider_schedules'] ?? [];
    expect(servicesEq.some(([col, val]) => col === 'clinic_id' && val === CID)).toBe(true);
    expect(schedulesEq.some(([col, val]) => col === 'clinic_id' && val === CID)).toBe(true);

    // No query was scoped to a foreign/attacker-supplied clinic id value.
    const providersEq = mockState.eqCalls['providers'] ?? [];
    const adsEq = mockState.eqCalls['clinic_ads'] ?? [];
    const allClinicScoped = [...servicesEq, ...schedulesEq, ...providersEq, ...adsEq].filter(([col]) => col === 'clinic_id');
    expect(allClinicScoped.length).toBe(4);
    for (const [, val] of allClinicScoped) {
      expect(val).toBe(CID);
    }
  });

  it('publicClinicUrl builds the canonical /c/{slug} URL from NEXT_PUBLIC_APP_URL', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://clinics.example.com';
    expect(publicClinicUrl('demo-clinic')).toBe('https://clinics.example.com/c/demo-clinic');
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
  it('clinicQrDestination encodes the stable /q/{publicId} target (never the slug)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://clinics.example.com';
    const dest = clinicQrDestination({ publicId: 'abc-123', slug: 'my-clinic' });
    expect(dest).toBe('https://clinics.example.com/q/abc-123');
    // The QR target must not embed the slug — printed codes survive slug changes.
    expect(dest).not.toContain('my-clinic');
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
});