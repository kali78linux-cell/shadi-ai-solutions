import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ensureProviderSlug,
  updateProviderPublicProfile,
  PUBLISHABLE_PROVIDER_TYPES,
} from '@/lib/services/providerVisibility';

/**
 * PP-8B-i — Public profile fields + stable slug (service tests).
 * Owner-approved contract: slug generated ONCE (opaque, stable across
 * rename/deactivation), publishable types = dentist/specialist/hygienist,
 * everything scoped by (clinic_id, id).
 */

const CID = '11111111-1111-1111-1111-111111111111';
const PID = '22222222-2222-2222-2222-222222222222';

const mockState = vi.hoisted(() => ({
  results: {} as Record<string, any>,
  errors: {} as Record<string, any>,
  chains: {} as Record<string, any>,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const chain: any = {};
      const result = () => {
        const base = mockState.results[table] ?? null;
        // Simulate the DB applying a pending update before .select().single().
        const data = chain._update && base ? { ...base, ...chain._update } : base;
        return { data, error: mockState.errors[table] ?? null };
      };
      chain.select = () => chain;
      chain.eq = (col: string, val: unknown) => {
        chain._eq = [...(chain._eq ?? []), [col, val]];
        return chain;
      };
      chain.is = (col: string, val: unknown) => {
        chain._is = [...(chain._is ?? []), [col, val]];
        return chain;
      };
      chain.order = () => chain;
      chain.maybeSingle = () => Promise.resolve(result());
      chain.single = () => Promise.resolve(result());
      chain.update = (values: unknown) => {
        chain._update = values;
        return chain;
      };
      chain.then = (res: (x: unknown) => void) => res(result());
      mockState.chains[table] = chain;
      return chain;
    }),
  },
}));

function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PID,
    name: 'د. حلا',
    provider_type: 'dentist',
    public_slug: null,
    specialty: null,
    bio: null,
    photo_url: null,
    deleted_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.results = {};
  mockState.errors = {};
});

describe('PP-8B-i — publishable types whitelist', () => {
  it('publishes dentist/specialist/hygienist only', () => {
    expect([...PUBLISHABLE_PROVIDER_TYPES]).toEqual(['dentist', 'specialist', 'hygienist']);
  });
});

describe('PP-8B-i — ensureProviderSlug (generated once, stable)', () => {
  it('generates dr-<12hex> when absent, scoped by (id, clinic_id), conditional on null slug', async () => {
    mockState.results['providers'] = providerRow();
    const { slug } = (await ensureProviderSlug(CID, PID))!;
    expect(slug).toMatch(/^dr-[a-z0-9]{12}$/);
    const chain = mockState.chains['providers'];
    expect(chain._update.public_slug).toBe(slug);
    expect(chain._eq).toContainEqual(['id', PID]);
    expect(chain._eq).toContainEqual(['clinic_id', CID]);
    expect(chain._is).toContainEqual(['public_slug', null]);
  });

  it('returns the existing slug WITHOUT any update (stable across calls)', async () => {
    mockState.results['providers'] = providerRow({ public_slug: 'dr-abc123def456' });
    const { slug } = (await ensureProviderSlug(CID, PID))!;
    expect(slug).toBe('dr-abc123def456');
    expect(mockState.chains['providers']?._update).toBeUndefined();
  });

  it('refuses non-publishable types (staff) with no write', async () => {
    mockState.results['providers'] = providerRow({ provider_type: 'staff' });
    await expect(ensureProviderSlug(CID, PID)).rejects.toThrow('PROVIDER_NOT_PUBLISHABLE');
    expect(mockState.chains['providers']?._update).toBeUndefined();
  });

  it('returns null for unknown/cross-tenant/soft-deleted provider', async () => {
    mockState.results['providers'] = null;
    expect(await ensureProviderSlug(CID, PID)).toBeNull();
    mockState.results['providers'] = providerRow({ deleted_at: '2026-09-01T00:00:00Z' });
    expect(await ensureProviderSlug(CID, PID)).toBeNull();
  });
});

describe('PP-8B-i — updateProviderPublicProfile', () => {
  it('updates marketing fields scoped by (id, clinic_id); trims and clears empties', async () => {
    mockState.results['providers'] = providerRow({ specialty: 'تقويم', bio: 'نبذة', photo_url: 'https://x/dr.jpg' });
    const row = await updateProviderPublicProfile(CID, PID, {
      specialty: '  تقويم الأسنان  ',
      bio: '   ',
      photo_url: 'https://cdn.example.com/dr.jpg',
    });
    expect(row).not.toBeNull();
    const chain = mockState.chains['providers'];
    expect(chain._update.specialty).toBe('تقويم الأسنان');
    expect(chain._update.bio).toBeNull();
    expect(chain._update.photo_url).toBe('https://cdn.example.com/dr.jpg');
  });

  it('400-path: throws NOTHING_TO_UPDATE for an empty patch (no write)', async () => {
    mockState.results['providers'] = providerRow();
    await expect(updateProviderPublicProfile(CID, PID, {})).rejects.toThrow('NOTHING_TO_UPDATE');
    expect(mockState.chains['providers']?._update).toBeUndefined();
  });

  it('refuses non-publishable types (receptionist) with no write', async () => {
    mockState.results['providers'] = providerRow({ provider_type: 'receptionist' });
    await expect(
      updateProviderPublicProfile(CID, PID, { specialty: 'x' })
    ).rejects.toThrow('PROVIDER_NOT_PUBLISHABLE');
    expect(mockState.chains['providers']?._update).toBeUndefined();
  });

  it('returns null for unknown/soft-deleted provider', async () => {
    mockState.results['providers'] = null;
    expect(await updateProviderPublicProfile(CID, PID, { bio: 'x' })).toBeNull();
  });
});
