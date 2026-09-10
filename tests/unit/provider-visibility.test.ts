import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getPublicVisibilityState,
  setClinicDiscoveryEnabled,
  setProviderVisibility,
} from '@/lib/services/providerVisibility';

/**
 * PP-8A — Provider Visibility Foundation service tests.
 * Deny-by-default contract: absent flags / 'private' default must never make
 * anything publicly visible or discoverable. Zero 15D impact (this service
 * never touches the 15D read paths; only clinics.settings.public_profile and
 * providers.public_visibility).
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
      const result = () => ({
        data: mockState.results[table] ?? null,
        error: mockState.errors[table] ?? null,
      });
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

const PROVIDER_ROW = {
  id: PID,
  name: 'د. حلا',
  provider_type: 'dentist',
  public_visibility: 'private',
  deleted_at: null,
};

describe('PP-8A — getPublicVisibilityState (deny-by-default reads)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockState.results['clinics'];
    delete mockState.results['providers'];
    mockState.errors = {};
  });

  it('reads discovery_enabled=false when the flag is absent (deny-by-default)', async () => {
    mockState.results['clinics'] = { settings: {} };
    const state = await getPublicVisibilityState(CID);
    expect(state).not.toBeNull();
    expect(state!.clinic.discovery_enabled).toBe(false);
    expect(state!.providers).toEqual([]);
  });

  it('reads discovery_enabled=true only when the flag is exactly true', async () => {
    mockState.results['clinics'] = {
      settings: { public_profile: { discovery_enabled: true } },
    };
    const state = await getPublicVisibilityState(CID);
    expect(state!.clinic.discovery_enabled).toBe(true);
  });

  it('returns provider rows with visibility mapped and clinic scoping applied', async () => {
    mockState.results['clinics'] = { settings: {} };
    mockState.results['providers'] = [PROVIDER_ROW];
    const state = await getPublicVisibilityState(CID);
    expect(state!.providers).toHaveLength(1);
    expect(state!.providers[0].public_visibility).toBe('private');
    const chain = mockState.chains['providers'];
    expect(chain._eq).toContainEqual(['clinic_id', CID]);
    expect(chain._is).toContainEqual(['deleted_at', null]);
  });

  it('returns null for an unknown/soft-deleted clinic', async () => {
    mockState.results['clinics'] = null;
    expect(await getPublicVisibilityState(CID)).toBeNull();
  });
});

describe('PP-8A — setClinicDiscoveryEnabled (settings JSONB, additive only)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockState.results['clinics'];
    mockState.errors = {};
  });

  it('enables the flag while preserving existing public_profile keys', async () => {
    mockState.results['clinics'] = {
      settings: { public_profile: { description: 'عيادة تجريبية' }, show_phone: true },
    };
    const enabled = await setClinicDiscoveryEnabled(CID, true);
    expect(enabled).toBe(true);
    const chain = mockState.chains['clinics'];
    expect(chain._update.settings.public_profile).toEqual({
      description: 'عيادة تجريبية',
      discovery_enabled: true,
    });
    // show_phone untouched; 15D keys never modified
    expect(chain._update.settings.show_phone).toBe(true);
    expect(chain._eq).toContainEqual(['id', CID]);
  });

  it('disabling removes the flag entirely (absence = false)', async () => {
    mockState.results['clinics'] = {
      settings: { public_profile: { discovery_enabled: true, description: 'نص' } },
    };
    const enabled = await setClinicDiscoveryEnabled(CID, false);
    expect(enabled).toBe(false);
    const chain = mockState.chains['clinics'];
    expect(chain._update.settings.public_profile).toEqual({ description: 'نص' });
  });

  it('throws CLINIC_NOT_FOUND for unknown clinic and writes nothing', async () => {
    mockState.results['clinics'] = null;
    await expect(setClinicDiscoveryEnabled(CID, true)).rejects.toThrow('CLINIC_NOT_FOUND');
    expect(mockState.chains['clinics']?._update).toBeUndefined();
  });
});

describe('PP-8A — setProviderVisibility (scoped, staff-protected)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockState.results['providers'];
    mockState.errors = {};
  });

  it('updates one provider scoped strictly by (id, clinic_id)', async () => {
    mockState.results['providers'] = { id: PID, name: 'د. حلا', provider_type: 'dentist', deleted_at: null };
    const row = await setProviderVisibility(CID, PID, 'noindex');
    expect(row).not.toBeNull();
    const chain = mockState.chains['providers'];
    expect(chain._update).toEqual({ public_visibility: 'noindex' });
    expect(chain._eq).toContainEqual(['id', PID]);
    expect(chain._eq).toContainEqual(['clinic_id', CID]);
  });

  it('refuses staff providers (PROVIDER_NOT_PUBLISHABLE) and performs no update', async () => {
    mockState.results['providers'] = { id: PID, name: 'موظفة استقبال', provider_type: 'staff', deleted_at: null };
    await expect(setProviderVisibility(CID, PID, 'indexable')).rejects.toThrow(
      'PROVIDER_NOT_PUBLISHABLE'
    );
    expect(mockState.chains['providers']?._update).toBeUndefined();
  });

  it('returns null (no update) for a cross-tenant/unknown provider', async () => {
    mockState.results['providers'] = null;
    expect(await setProviderVisibility(CID, PID, 'indexable')).toBeNull();
    expect(mockState.chains['providers']?._update).toBeUndefined();
  });

  it('returns null (no update) for a soft-deleted provider', async () => {
    mockState.results['providers'] = { id: PID, name: 'قديم', provider_type: 'dentist', deleted_at: '2026-09-01T00:00:00Z' };
    expect(await setProviderVisibility(CID, PID, 'indexable')).toBeNull();
    expect(mockState.chains['providers']?._update).toBeUndefined();
  });
});
