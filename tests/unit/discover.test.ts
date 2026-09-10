import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDiscoveryEntries, DISCOVERY_PAGE_SIZE } from '@/lib/services/doctorPublicProfile';

/**
 * PP-8D — Discovery V1 service tests (eligibility contract + search + pagination).
 * Eligibility = discovery_enabled(opt-in) + indexable + publishable type +
 * not deleted (provider & clinic) + public_slug present + subscription
 * active|trialing (latest non-deleted row wins — mirrors 15C semantics).
 */

const CID_OK = '11111111-1111-1111-1111-111111111111';
const CID_NO_SUB = '22222222-2222-2222-2222-222222222222';
const CID_PAST_DUE = '33333333-3333-3333-3333-333333333333';
const CID_TRIALING = '44444444-4444-4444-4444-444444444444';
const CID_CANCELED = '55555555-5555-5555-5555-555555555555';

const mockState = vi.hoisted(() => ({
  providerRows: [] as any[],
  subscriptionRows: [] as any[],
  errors: {} as Record<string, any>,
  chains: {} as Record<string, any>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {};
      const rowsFor = () =>
        table === 'providers' ? mockState.providerRows : mockState.subscriptionRows;
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        (chain._eq ??= []).push([col, val]);
        return chain;
      };
      chain.in = (col: string, vals: unknown[]) => {
        (chain._in ??= []).push([col, vals]);
        return chain;
      };
      chain.is = (col: string, val: unknown) => {
        (chain._is ??= []).push([col, val]);
        return chain;
      };
      chain.not = (col: string, op: string, val: unknown) => {
        (chain._not ??= []).push([col, op, val]);
        return chain;
      };
      chain.ilike = (col: string, val: string) => {
        (chain._ilike ??= []).push([col, val]);
        return chain;
      };
      chain.or = (val: string, opts?: unknown) => {
        (chain._or ??= []).push([val, opts]);
        return chain;
      };
      chain.order = () => chain;
      chain.range = () => chain;
      chain.limit = () => chain;
      chain.then = (res: (x: unknown) => void) => res({ data: rowsFor(), error: mockState.errors[table] ?? null });
      mockState.chains[table] = chain;
      return chain;
    }),
  },
}));

vi.mock('@/lib/communications/links', () => ({ getAppBaseUrl: () => 'https://clinics.example.com' }));

function clinicSettings(discoveryEnabled: boolean) {
  return { public_profile: { discovery_enabled: discoveryEnabled } };
}

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    public_slug: 'dr-ok',
    name: 'Dr. Eligible',
    specialty: 'تقويم',
    title: null,
    photo_url: null,
    provider_type: 'dentist',
    clinic_id: CID_OK,
    clinics: { slug: 'demo-dental-clinic', name: 'Demo Dental Clinic', city: 'عمّان', area: null, settings: clinicSettings(true), deleted_at: null },
    ...overrides,
  };
}

function subRow(clinicId: string, status: string, updatedSeq = 0) {
  return { clinic_id: clinicId, status, _seq: updatedSeq };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.providerRows = [providerRow()];
  mockState.subscriptionRows = [subRow(CID_OK, 'active')];
  mockState.errors = {};
});

describe('PP-8D — eligibility contract', () => {
  it('lists a fully eligible doctor with allow-listed fields only', async () => {
    const r = await getDiscoveryEntries({});
    expect(r.entries).toHaveLength(1);
    const e = r.entries[0];
    expect(e.kind).toBe('doctor'); // D9 entity_kind
    expect(e.slug).toBe('dr-ok');
    expect(e.name).toBe('Dr. Eligible');
    expect(e.clinicName).toBe('Demo Dental Clinic');
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/user_id|"email"|phone"|patient/i);
    // query contract: all DB-level eligibility filters present
    const c = mockState.chains['providers'];
    expect(c._eq).toContainEqual(['public_visibility', 'indexable']);
    expect(c._in).toContainEqual(['provider_type', ['dentist', 'specialist', 'hygienist']]);
    expect(c._is).toContainEqual(['deleted_at', null]);
    expect(c._is).toContainEqual(['clinics.deleted_at', null]);
    expect(c._not).toContainEqual(['public_slug', 'is', null]);
  });

  it('excludes doctors of clinics without discovery opt-in', async () => {
    mockState.providerRows = [providerRow({ clinics: providerRow().clinics && { ...providerRow().clinics, settings: clinicSettings(false) } })];
    const r = await getDiscoveryEntries({});
    expect(r.entries).toHaveLength(0);
  });

  it('excludes noindex visibility (query-level eq indexable)', async () => {
    const r = await getDiscoveryEntries({});
    expect(r.entries).toHaveLength(1);
    const c = mockState.chains['providers'];
    expect(c._eq).toContainEqual(['public_visibility', 'indexable']);
  });

  it('excludes non-publishable types (query-level in-list)', async () => {
    const r = await getDiscoveryEntries({});
    const c = mockState.chains['providers'];
    expect(c._in).toContainEqual(['provider_type', ['dentist', 'specialist', 'hygienist']]);
    expect(r.entries).toHaveLength(1);
  });

  it('subscription: active and trialing eligible, past_due/canceled/missing excluded', async () => {
    // trialing → included
    mockState.subscriptionRows = [subRow(CID_OK, 'trialing')];
    expect((await getDiscoveryEntries({})).entries).toHaveLength(1);
    // past_due → excluded
    mockState.subscriptionRows = [subRow(CID_OK, 'past_due')];
    expect((await getDiscoveryEntries({})).entries).toHaveLength(0);
    // canceled → excluded
    mockState.subscriptionRows = [subRow(CID_OK, 'canceled')];
    expect((await getDiscoveryEntries({})).entries).toHaveLength(0);
    // no subscription row at all → excluded
    mockState.subscriptionRows = [];
    expect((await getDiscoveryEntries({})).entries).toHaveLength(0);
    // multiple rows → LATEST (updated_at desc) wins: canceled old + active new = active
    mockState.subscriptionRows = [subRow(CID_OK, 'active', 1), subRow(CID_OK, 'canceled', 0)];
    expect((await getDiscoveryEntries({})).entries).toHaveLength(1);
  });

  it('subscription rows are fetched for candidate clinics only, non-deleted, latest first', async () => {
    await getDiscoveryEntries({});
    const s = mockState.chains['subscriptions'];
    expect(s._in).toContainEqual(['clinic_id', [CID_OK]]);
    expect(s._is).toContainEqual(['deleted_at', null]);
  });

  it('deleted provider / deleted clinic / missing slug never appear (query contract)', async () => {
    await getDiscoveryEntries({});
    const c = mockState.chains['providers'];
    expect(c._is).toContainEqual(['deleted_at', null]);
    expect(c._is).toContainEqual(['clinics.deleted_at', null]);
    expect(c._not).toContainEqual(['public_slug', 'is', null]);
  });
});

describe('PP-8D — search', () => {
  it('searches by doctor name (ILIKE contains)', async () => {
    await getDiscoveryEntries({ q: 'أحمد' });
    expect(mockState.chains['providers']._ilike).toContainEqual(['name', '%أحمد%']);
  });

  it('searches by specialty', async () => {
    await getDiscoveryEntries({ specialty: 'تقويم' });
    expect(mockState.chains['providers']._ilike).toContainEqual(['specialty', '%تقويم%']);
  });

  it('searches city/area on the clinic relation', async () => {
    await getDiscoveryEntries({ city: 'عمّان' });
    const [expr, opts] = mockState.chains['providers']._or[0];
    expect(expr).toContain('city.ilike.%عمّان%');
    expect(expr).toContain('area.ilike.%عمّان%');
    expect(opts).toEqual({ referencedTable: 'clinics' });
  });

  it('trims and skips empty filters', async () => {
    await getDiscoveryEntries({ q: '   ', specialty: '', city: undefined });
    expect(mockState.chains['providers']._ilike).toBeUndefined();
  });
});

describe('PP-8D — pagination (20/page, deterministic name order)', () => {
  it('pages 20-per-page with deterministic ordering and correct totals', async () => {
    mockState.providerRows = Array.from({ length: 25 }, (_, i) =>
      providerRow({ public_slug: `dr-doc${i}`, name: `Dr. ${String(i).padStart(2, '0')}` })
    );
    const page1 = await getDiscoveryEntries({ page: 1 });
    expect(DISCOVERY_PAGE_SIZE).toBe(20);
    expect(page1.total).toBe(25);
    expect(page1.totalPages).toBe(2);
    expect(page1.entries).toHaveLength(20);
    expect(page1.entries[0].name).toBe('Dr. 00');
    const page2 = await getDiscoveryEntries({ page: 2 });
    expect(page2.entries).toHaveLength(5);
    expect(page2.entries[0].name).toBe('Dr. 20');
  });

  it('clamps out-of-range pages to the last page', async () => {
    mockState.providerRows = [providerRow()];
    const r = await getDiscoveryEntries({ page: 99 });
    expect(r.page).toBe(1);
  });
});

describe('PP-8D — empty state', () => {
  it('returns zero entries honestly when nothing is eligible', async () => {
    mockState.providerRows = [];
    const r = await getDiscoveryEntries({});
    expect(r.entries).toEqual([]);
    expect(r.total).toBe(0);
    expect(r.totalPages).toBe(1);
  });
});

