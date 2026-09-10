import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ACTIVITY_TYPES,
  isActivityType,
  normalizeActivityType,
  RESERVED_PUBLIC_SLUGS,
} from '@/lib/services/activityTypes';
import { getActivityPublicSpace, getTenantActivityType } from '@/lib/services/activityPublicSpace';

/**
 * Digital Healthcare Space — Phase A/C tests.
 * Activity model integrity + activity public-space resolution.
 */

const CID = '11111111-1111-1111-1111-111111111111';

const mockState = vi.hoisted(() => ({
  clinic: null as { id: string; slug: string; name: string } | null,
  activityRow: null as { activity_type: string } | null,
  profile: null as Record<string, unknown> | null,
  imaging: [] as unknown[],
  lab: [] as unknown[],
}));

vi.mock('@/lib/services/clinics', () => ({
  resolvePublicClinic: vi.fn(async () => mockState.clinic),
}));
vi.mock('@/lib/services/clinicPublicProfile', () => ({
  getPublicClinicProfile: vi.fn(async () => mockState.profile),
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {};
      const result = () => {
        if (table === 'clinics') return { data: mockState.activityRow, error: null };
        if (table === 'imaging_services') return { data: mockState.imaging, error: null };
        if (table === 'lab_services') return { data: mockState.lab, error: null };
        return { data: null, error: null };
      };
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      chain.maybeSingle = () => Promise.resolve(result());
      chain.then = (res: (x: unknown) => void) => res(result());
      return chain;
    }),
  },
}));
vi.mock('@/lib/communications/links', () => ({ getAppBaseUrl: () => 'https://clinics.example.com' }));

beforeEach(() => {
  vi.clearAllMocks();
  mockState.clinic = { id: CID, slug: 'demo-clinic', name: 'Demo Clinic' };
  mockState.activityRow = { activity_type: 'clinic' };
  mockState.profile = {
    slug: 'demo-clinic',
    name: 'Demo Clinic',
    logo: null,
    description: null,
    city: 'عمّان',
    area: null,
    address: null,
    phone: null,
    bookingUrl: '/book?slug=demo-clinic',
    chatUrl: '/chat?clinic=demo-clinic',
    pageUrl: 'https://clinics.example.com/c/demo-clinic',
    services: [],
    workingHours: [],
  };
  mockState.imaging = [];
  mockState.lab = [];
});

describe('Phase A — activity model', () => {
  it('has exactly the three official activity types (no medical_lab)', () => {
    expect([...ACTIVITY_TYPES]).toEqual(['clinic', 'imaging_center', 'dental_lab']);
    expect(ACTIVITY_TYPES).not.toContain('medical_lab');
  });

  it('normalizeActivityType falls back to clinic for unknown/legacy values', () => {
    expect(normalizeActivityType('clinic')).toBe('clinic');
    expect(normalizeActivityType('imaging_center')).toBe('imaging_center');
    expect(normalizeActivityType('dental_lab')).toBe('dental_lab');
    expect(normalizeActivityType('radiology_center')).toBe('clinic');
    expect(normalizeActivityType(undefined)).toBe('clinic');
    expect(isActivityType('clinic')).toBe(true);
    expect(isActivityType('medical_lab')).toBe(false);
  });

  it('reserves top-level slugs that would collide with static routes', () => {
    for (const s of ['api', 'auth', 'dashboard', 'book', 'chat', 'c', 'd', 'discover', 'portal', 'q', 'setup', 'login', 'register']) {
      expect(RESERVED_PUBLIC_SLUGS.has(s)).toBe(true);
    }
  });
});

describe('Phase C — activity public space', () => {
  it('resolves a clinic space with shared clinic projection', async () => {
    const space = await getActivityPublicSpace('demo-clinic');
    expect(space).not.toBeNull();
    expect(space!.activityType).toBe('clinic');
    expect(space!.pageUrl).toBe('https://clinics.example.com/demo-clinic');
    expect(space!.legacyPageUrl).toBe('https://clinics.example.com/c/demo-clinic');
    expect(space!.imagingServices).toEqual([]);
    expect(space!.labServices).toEqual([]);
  });

  it('resolves an imaging space with imaging domain catalog only', async () => {
    mockState.activityRow = { activity_type: 'imaging_center' };
    mockState.imaging = [
      { name: 'أشعة بانوراما', description: null, duration_minutes: 25, turnaround_hours: null, modality: 'panoramic', price: 85 },
    ];
    const space = await getActivityPublicSpace('noura-dental-imaging');
    expect(space!.activityType).toBe('imaging_center');
    expect(space!.imagingServices).toHaveLength(1);
    expect(space!.imagingServices[0].modality).toBe('panoramic');
    expect(space!.labServices).toEqual([]);
  });

  it('resolves a dental lab space with lab domain catalog only', async () => {
    mockState.activityRow = { activity_type: 'dental_lab' };
    mockState.lab = [
      { name: 'تيجان', description: null, duration_minutes: null, turnaround_hours: 48, modality: null, price: 200 },
    ];
    const space = await getActivityPublicSpace('my-lab');
    expect(space!.activityType).toBe('dental_lab');
    expect(space!.labServices).toHaveLength(1);
    expect(space!.labServices[0].turnaround_hours).toBe(48);
    expect(space!.imagingServices).toEqual([]);
  });

  it('returns null for unknown tenant', async () => {
    mockState.clinic = null;
    expect(await getActivityPublicSpace('nope')).toBeNull();
  });

  it('getTenantActivityType resolves the authoritative type', async () => {
    mockState.activityRow = { activity_type: 'dental_lab' };
    expect(await getTenantActivityType('my-lab')).toBe('dental_lab');
  });
});