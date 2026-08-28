/**
 * STEP 3 — service/provider NAME resolution against real operating data.
 * No match or ambiguous match → null (the assistant must ask for clarification,
 * never pick the first candidate blindly).
 */
import { describe, expect, it } from 'vitest';
import { resolveServiceByName, resolveProviderByName } from '@/lib/ai/availabilityTool';
import type { ClinicOperatingData } from '@/lib/ai/clinicDataContext';

function data(overrides: Partial<ClinicOperatingData> = {}): ClinicOperatingData {
  return {
    services: [
      { id: 'svc-exam', name: 'فحص أسنان', description: null, duration_minutes: 30, pricing_type: 'fixed', price_min: 50, price_max: 50, price_visible_to_patients: true, active: true },
      { id: 'svc-clean', name: 'تنظيف أسنان', description: null, duration_minutes: 30, pricing_type: 'fixed', price_min: 100, price_max: 100, price_visible_to_patients: true, active: true },
      { id: 'svc-xray', name: 'أشعة أسنان', description: null, duration_minutes: 15, pricing_type: 'unspecified', price_min: null, price_max: null, price_visible_to_patients: true, active: true },
    ],
    providers: [
      { id: 'prov-sara', name: 'د. سارة محمود', title: 'أخصائية تقويم', provider_type: 'dentist' },
      { id: 'prov-ahmad', name: 'د. أحمد خالد', title: 'طبيب أسنان عام', provider_type: 'dentist' },
    ],
    providerServiceIds: [],
    hasServices: true,
    hasProviders: true,
    usable: true,
    ...overrides,
  };
}

describe('resolveServiceByName', () => {
  it('resolves a unique service by name', () => {
    expect(resolveServiceByName('فحص أسنان', data())).toEqual({ id: 'svc-exam', name: 'فحص أسنان' });
    expect(resolveServiceByName('بدي تنظيف', data())).toEqual({ id: 'svc-clean', name: 'تنظيف أسنان' });
  });

  it('returns null when there is no match (no invented service)', () => {
    expect(resolveServiceByName('زراعة أسنان', data())).toBeNull();
  });

  it('returns null when the match is ambiguous (never picks first blindly)', () => {
    const d = data({ services: [
      { id: 's1', name: 'تنظيف أسنان', description: null, duration_minutes: 30, pricing_type: 'fixed', price_min: 1, price_max: 1, price_visible_to_patients: true, active: true },
      { id: 's2', name: 'تنظيف أسنان شامل', description: null, duration_minutes: 45, pricing_type: 'fixed', price_min: 2, price_max: 2, price_visible_to_patients: true, active: true },
    ], hasServices: true });
    expect(resolveServiceByName('تنظيف', d)).toBeNull();
  });
});

describe('resolveProviderByName', () => {
  it('resolves a unique provider by first name', () => {
    expect(resolveProviderByName('سارة', data())).toEqual({ id: 'prov-sara', name: 'د. سارة محمود' });
  });

  it('returns null when there is no match (no invented doctor)', () => {
    expect(resolveProviderByName('د. خالد غريب', data())).toBeNull();
  });

  it('returns null when multiple providers share the name (ambiguous)', () => {
    const d = data({ providers: [
      { id: 'p1', name: 'د. سارة محمود', title: null, provider_type: 'dentist' },
      { id: 'p2', name: 'د. سارة خالد', title: null, provider_type: 'dentist' },
    ], hasProviders: true });
    expect(resolveProviderByName('سارة', d)).toBeNull();
  });
});
