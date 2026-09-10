import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDoctorPublicProfile, doctorPublicUrl } from '@/lib/services/doctorPublicProfile';

/**
 * PP-8B-ii — Public Doctor Profile projection tests (deny-by-default).
 * THE single projection for /d/{slug} — 8C/8D must reuse it, never re-query.
 */

const CID = '11111111-1111-1111-1111-111111111111';
const CLINIC_SLUG = 'demo-dental-clinic';

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
      for (const m of ['select', 'order', 'limit']) chain[m] = () => chain;
      chain.is = (col: string, val: unknown) => {
        (mockState.eqCalls[table] ??= []).push([col + ':is', val]);
        return chain;
      };
      chain.eq = (col: string, val: unknown) => {
        (mockState.eqCalls[table] ??= []).push([col, val]);
        return chain;
      };
      chain.neq = (col: string, val: unknown) => {
        (mockState.eqCalls[table] ??= []).push([col + '!', val]);
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve(resolved());
      chain.single = () => Promise.resolve(resolved());
      chain.then = (res: (x: unknown) => void) => res(resolved());
      return chain;
    }),
  },
}));

vi.mock('@/lib/services/clinics', () => ({
  resolvePublicClinic: vi.fn(async ({ id }: { id?: string }) =>
    mockState.results['__clinic_active'] ? { id, slug: CLINIC_SLUG, name: 'Demo Dental Clinic' } : null
  ),
}));

vi.mock('@/lib/communications/links', () => ({
  getAppBaseUrl: () => 'https://clinics.example.com',
}));

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Dr. Ahmad Hassan',
    title: 'Dentist (Demo)',
    specialty: 'طب الأسنان العام',
    bio: 'نبذة تجريبية',
    photo_url: null,
    public_slug: 'dr-ahmadhassan',
    public_visibility: 'noindex',
    provider_type: 'dentist',
    clinic_id: CID,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.results = {};
  mockState.error = null;
});

describe('PP-8B-ii — getDoctorPublicProfile (allow-list projection)', () => {
  it('resolves the full allow-listed profile with clinic, services, hours and URLs', async () => {
    mockState.results = {
      providers: providerRow(),
      __clinic_active: true,
      clinics: {
        id: CID,
        slug: CLINIC_SLUG,
        name: 'Demo Dental Clinic',
        city: 'عمّان',
        area: 'وسط البلد',
        address_detail: 'شارع المدينة',
        phone: '+970-555-0001',
        settings: { show_phone: true, show_prices: true },
      },
      clinic_services: [
        { name: 'Dental Exam', description: 'فحص شامل', duration_minutes: 30, price: 50, price_min: null, price_max: null, price_visible_to_patients: true },
      ],
      provider_schedules: [
        { weekday: 1, start_time: '09:00', end_time: '17:00' },
      ],
    };
    const profile = await getDoctorPublicProfile({ slug: 'dr-ahmadhassan' });
    expect(profile).not.toBeNull();
    expect(profile!.slug).toBe('dr-ahmadhassan');
    expect(profile!.name).toBe('Dr. Ahmad Hassan');
    expect(profile!.visibility).toBe('noindex');
    expect(profile!.clinic.phone).toBe('+970-555-0001');
    expect(profile!.services[0].price).toBe(50);
    expect(profile!.workingHours[0].weekday).toBe(1);
    expect(profile!.bookingUrl).toBe(`/book?slug=${CLINIC_SLUG}`);
    expect(profile!.chatUrl).toBe(`/chat?clinic=${CLINIC_SLUG}`);
    expect(profile!.pageUrl).toBe('https://clinics.example.com/d/dr-ahmadhassan');
    expect(profile!.clinic.pageUrl).toBe('https://clinics.example.com/c/demo-dental-clinic');
    // allow-list: no internal identities leak
    const json = JSON.stringify(profile);
    expect(json).not.toMatch(/user_id|"email"|demo\.dentist/i);
    // resolved strictly by public slug, public visibility, not deleted
    const pcalls = mockState.eqCalls['providers'];
    expect(pcalls).toContainEqual(['public_slug', 'dr-ahmadhassan']);
    expect(pcalls).toContainEqual(['public_visibility!', 'private']);
    expect(pcalls).toContainEqual(['deleted_at:is', null]);
  });

  it('private visibility never resolves (deny-by-default)', async () => {
    mockState.results['providers'] = null;
    expect(await getDoctorPublicProfile({ slug: 'dr-anything' })).toBeNull();
  });

  it('non-publishable provider types never resolve', async () => {
    mockState.results['providers'] = providerRow({ provider_type: 'staff' });
    expect(await getDoctorPublicProfile({ slug: 'dr-staff' })).toBeNull();
  });

  it('inactive clinic → null (no orphan doctor pages)', async () => {
    mockState.results['providers'] = providerRow();
    mockState.results['__clinic_active'] = false;
    expect(await getDoctorPublicProfile({ slug: 'dr-ahmadhassan' })).toBeNull();
  });

  it('prices/phone stay hidden unless clinic opt-in flags are on', async () => {
    mockState.results = {
      providers: providerRow(),
      __clinic_active: true,
      clinics: {
        id: CID, slug: CLINIC_SLUG, name: 'Demo Dental Clinic', city: null, area: null,
        address_detail: null, phone: '+970-555-0001', settings: { show_prices: false },
      },
      clinic_services: [
        { name: 'Dental Exam', description: null, duration_minutes: 30, price: 50, price_min: null, price_max: null, price_visible_to_patients: true },
      ],
      provider_schedules: [],
    };
    const profile = await getDoctorPublicProfile({ slug: 'dr-ahmadhassan' });
    expect(profile!.services[0].price).toBeNull();
    expect(profile!.clinic.phone).toBeNull();
  });

  it('doctorPublicUrl builds the canonical /d/ URL', () => {
    expect(doctorPublicUrl('dr-ahmadhassan')).toBe('https://clinics.example.com/d/dr-ahmadhassan');
  });
});

