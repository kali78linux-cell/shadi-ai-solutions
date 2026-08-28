/**
 * STEP 5 — Network Discovery Mode guidance layer.
 *
 * Contract under test:
 * - Clinic Reception Mode is the default: no explicit per-turn ask → null
 *   (the AI never leaves its own clinic silently and never lists others).
 * - Without a known area the honest next step is ASKING for the area —
 *   listing arbitrary clinics would be invention.
 * - The clinic list comes ONLY from the real clinic directory
 *   (lib/services/clinicDirectory, mocked here); failures degrade to normal
 *   reception mode — never "AI unavailable", never fabricated results.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockFindNearbyClinics = vi.hoisted(() => vi.fn());

vi.mock('@/lib/services/clinicDirectory', () => ({
  findNearbyClinics: mockFindNearbyClinics,
}));

import {
  buildDiscoveryGuidance,
  formatDiscoveryGuidance,
} from '@/lib/ai/discoveryGuidance';

beforeEach(() => {
  mockFindNearbyClinics.mockReset();
});

describe('formatDiscoveryGuidance (pure)', () => {
  /** Completes required ClinicDirectoryEntry fields for fixtures. */
  const entry = (partial: { name: string; city?: string | null; distance_km?: number | null }) => ({
    id: `id-${partial.name}`,
    slug: `slug-${partial.name}`,
    name: partial.name,
    city: partial.city ?? null,
    address: null,
    distance_km: partial.distance_km ?? null,
  });

  it('returns an honest "no other clinics" note for an empty directory (no invention)', () => {
    const note = formatDiscoveryGuidance([], 'عيادتي');
    expect(note).toContain('NO other listed clinics matched');
    expect(note).toContain('do NOT invent');
  });

  it('lists only real directory matches with name/city/distance exactly as given', () => {
    const note = formatDiscoveryGuidance(
      [
        entry({ name: 'عيادة النور', city: 'نابلس', distance_km: 12.34 }),
        entry({ name: 'عيادة السلام', city: 'رام الله', distance_km: 3.5 }),
      ],
      'عيادتي'
    );
    expect(note).toContain('عيادة النور');
    expect(note).toContain('نابلس');
    expect(note).toContain('12.3 km');
    expect(note).toContain('عيادة السلام');
    expect(note).toContain('Never invent');
  });

  it('excludes the current clinic from the alternatives', () => {
    const note = formatDiscoveryGuidance(
      [
        entry({ name: 'عيادتي', city: 'رام الله', distance_km: 0 }),
        entry({ name: 'عيادة النور', city: 'نابلس', distance_km: 9.9 }),
      ],
      'عيادتي'
    );
    expect(note).not.toContain('عيادتي (');
    expect(note).toContain('عيادة النور');
  });

  it('never states a distance the directory did not provide', () => {
    const note = formatDiscoveryGuidance([entry({ name: 'عيادة النور', city: 'نابلس' })], 'عيادتي');
    expect(note).toContain('عيادة النور');
    expect(note).not.toContain('km');
  });
});

describe('buildDiscoveryGuidance (mode gating)', () => {
  it('stays in Clinic Reception Mode when the patient did not ask (agreed=false)', async () => {
    await expect(buildDiscoveryGuidance({ agreed: false })).resolves.toBeNull();
    expect(mockFindNearbyClinics).not.toHaveBeenCalled();
  });

  it('stays in Clinic Reception Mode when the flag is absent (null)', async () => {
    await expect(buildDiscoveryGuidance({ agreed: null })).resolves.toBeNull();
    expect(mockFindNearbyClinics).not.toHaveBeenCalled();
  });

  it('asks for the area instead of inventing a list when no location is known', async () => {
    const note = await buildDiscoveryGuidance({ agreed: true, patientCity: null });
    expect(note).toContain('Ask the patient for their city/area');
    expect(note).not.toContain('km');
    expect(mockFindNearbyClinics).not.toHaveBeenCalled();
  });

  it('queries the REAL directory with the patient area (+service) when explicitly asked', async () => {
    mockFindNearbyClinics.mockResolvedValue([{ name: 'عيادة النور', city: 'نابلس', distance_km: 12.34 }]);
    const note = await buildDiscoveryGuidance({
      agreed: true,
      patientCity: 'رام الله',
      requestedService: 'تنظيف أسنان',
      currentClinicName: 'عيادتي',
    });
    expect(mockFindNearbyClinics).toHaveBeenCalledWith({
      area: 'رام الله',
      service: 'تنظيف أسنان',
      limit: 5,
    });
    expect(note).toContain('عيادة النور');
  });

  it('falls back to normal reception mode (null, no crash) when the directory fails', async () => {
    mockFindNearbyClinics.mockRejectedValue(new Error('db down'));
    await expect(
      buildDiscoveryGuidance({ agreed: true, patientCity: 'رام الله' })
    ).resolves.toBeNull();
  });
});
