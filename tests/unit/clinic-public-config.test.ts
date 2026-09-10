import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  defaultPublicPageSections,
  readPublicProfile,
  updatePublicPageConfig,
} from '@/lib/services/clinicPublicConfig';

// CLINIC PUBLIC PAGE OWNER EXPERIENCE — service tests.
// Covers: activity-aware default templates, profile reading with defaults,
// and the tenant-scoped update (sections merge, empty-string deletes, and that
// hidden services/providers are purely presentation-level).

const CID = '22222222-2222-2222-2222-222222222222';

const mockState = vi.hoisted(() => ({
  row: null as any,
  error: null as any,
  updateCall: null as any,
  eqCalls: [] as string[],
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'clinics') {
        const chain: any = {};
        chain.select = () => chain;
        chain.is = () => chain;
        chain.eq = (col: string, val: unknown) => {
          mockState.eqCalls.push(`${col}:${String(val)}`);
          return chain;
        };
        chain.maybeSingle = () => ({ data: mockState.row, error: mockState.error });
        chain.single = () => ({ data: mockState.row, error: mockState.error });
        chain.update = (patch: any) => {
          mockState.updateCall = patch;
          return chain;
        };
        chain.then = (res: (x: unknown) => void) => res({ data: mockState.row, error: mockState.error });
        return chain;
      }
      const chain: any = {};
      chain.select = () => chain;
      chain.eq = () => chain;
      chain.is = () => chain;
      chain.limit = () => chain;
      chain.order = () => chain;
      chain.maybeSingle = () => ({ data: null, error: mockState.error });
      return chain;
    }),
  },
}));

describe('defaultPublicPageSections — activity-aware ready-made templates', () => {
  it('clinic gets the full set of sections', () => {
    const s = defaultPublicPageSections('clinic');
    expect(s.hero).toBe(true);
    expect(s.about).toBe(true);
    expect(s.services).toBe(true);
    expect(s.providers).toBe(true);
    expect(s.hours).toBe(true);
    expect(s.bookingCta).toBe(true);
    expect(s.aiCta).toBe(true);
    expect(s.qrShare).toBe(true);
  });

  it('imaging_center hides providers and offers', () => {
    const s = defaultPublicPageSections('imaging_center');
    expect(s.providers).toBe(false);
    expect(s.services).toBe(true);
    expect(s.hours).toBe(true);
    expect(s.contact).toBe(true);
    expect(s.hero).toBe(true);
  });

  it('dental_lab hides providers and shows services + hours', () => {
    const s = defaultPublicPageSections('dental_lab');
    expect(s.providers).toBe(false);
    expect(s.services).toBe(true);
    expect(s.about).toBe(true);
  });
});

describe('readPublicProfile — defaults + stored values', () => {
  it('returns defaults when settings are empty', () => {
    const p = readPublicProfile({}, 'clinic');
    expect(p.show_phone).toBe(false);
    expect(p.show_prices).toBe(false);
    expect(p.show_providers).toBe(true);
    expect(p.sections?.hero).toBe(true);
    expect(p.hidden_services).toEqual([]);
    expect(p.hidden_providers).toEqual([]);
  });

  it('preserves stored section overrides on top of defaults', () => {
    const p = readPublicProfile(
      { public_profile: { sections: { services: false } } },
      'clinic'
    );
    expect(p.sections?.services).toBe(false);
    expect(p.sections?.hero).toBe(true);
  });

  it('string values surfaced; non-strings ignored', () => {
    const p = readPublicProfile(
      { public_profile: { description: 'مركز طبي حديث', about: 123 } },
      'clinic'
    );
    expect(p.description).toBe('مركز طبي حديث');
    expect(p.about).toBeUndefined();
  });
});

describe('updatePublicPageConfig — tenant-scoped save', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.error = null;
    mockState.eqCalls = [];
    mockState.updateCall = null;
    mockState.row = null;
  });

  it('writes into clinics.settings.public_profile keyed by clinicId', async () => {
    mockState.row = { id: CID, activity_type: 'clinic', settings: {} };
    const res = await updatePublicPageConfig(CID, { description: 'مركز حديث', show_phone: true });
    expect(res.ok).toBe(true);
    expect(mockState.updateCall.settings.public_profile.description).toBe('مركز حديث');
    expect(mockState.updateCall.settings.public_profile.show_phone).toBe(true);
    expect(mockState.eqCalls).toContain(`id:${CID}`);
  });

  it('empty string deletes a field instead of storing it', async () => {
    mockState.row = { id: CID, activity_type: 'clinic', settings: { public_profile: { description: 'old' } } };
    await updatePublicPageConfig(CID, { description: '' });
    expect(mockState.updateCall.settings.public_profile.description).toBeUndefined();
  });

  it('merges sections with activity-aware defaults, not dropping unset ones', async () => {
    mockState.row = { id: CID, activity_type: 'imaging_center', settings: { public_profile: { sections: { services: false } } } };
    await updatePublicPageConfig(CID, { sections: { about: false } });
    const sec = mockState.updateCall.settings.public_profile.sections;
    expect(sec.services).toBe(false);
    expect(sec.about).toBe(false);
    expect(sec.hero).toBe(true);
  });

  it('replaces hidden services/providers arrays wholesale', async () => {
    mockState.row = { id: CID, activity_type: 'clinic', settings: { public_profile: { hidden_services: ['a'] } } };
    await updatePublicPageConfig(CID, { hidden_services: ['svc-1', 'svc-2'] });
    expect(mockState.updateCall.settings.public_profile.hidden_services).toEqual(['svc-1', 'svc-2']);
  });

  it('returns failure for missing clinic (tenant guard)', async () => {
    mockState.row = null;
    const res = await updatePublicPageConfig(CID, { description: 'x' });
    expect(res.ok).toBe(false);
    expect(res.message).toBe('Clinic not found');
    expect(mockState.updateCall).toBeNull();
  });
});
