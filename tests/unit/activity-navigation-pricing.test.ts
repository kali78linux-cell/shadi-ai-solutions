import { describe, it, expect } from 'vitest';
import { getActivityNavigation } from '@/components/dashboard/DashboardNav';
import { describeServicePrice } from '@/lib/ai/clinicDataContext';
import { describePriceForPrompt } from '@/lib/ai/promptManager';
import type { ClinicOperatingData } from '@/lib/ai/clinicDataContext';

describe('ACTIVITY-AWARE navigation (imaging center is not a dental clinic)', () => {
  it('imaging center navigation REMOVES dental-clinic-only modules', () => {
    const mods = getActivityNavigation('imaging_center').map((l) => l.module);
    expect(mods).not.toContain('leads');
    expect(mods).not.toContain('growth');
  });
  it('imaging center navigation ADDS its workflow modules', () => {
    const mods = getActivityNavigation('imaging_center').map((l) => l.module);
    expect(mods).toContain('imaging-requests');
    expect(mods).toContain('referring-clinics');
  });
  it('ordering: imaging-requests directly after overview; referring-clinics after it', () => {
    const mods = getActivityNavigation('imaging_center').map((l) => l.module);
    expect(mods.indexOf('imaging-requests')).toBe(mods.indexOf('overview') + 1);
    expect(mods.indexOf('referring-clinics')).toBe(mods.indexOf('imaging-requests') + 1);
  });
  it('clinic keeps the full base navigation (no imaging modules injected)', () => {
    const mods = getActivityNavigation('clinic').map((l) => l.module);
    expect(mods).toContain('leads');
    expect(mods).toContain('growth');
    expect(mods).not.toContain('imaging-requests');
    expect(mods).not.toContain('referring-clinics');
  });
  it('lab removes appointments+leads and adds no imaging modules', () => {
    const mods = getActivityNavigation('dental_lab').map((l) => l.module);
    expect(mods).not.toContain('appointments');
    expect(mods).not.toContain('leads');
    expect(mods).not.toContain('imaging-requests');
  });
  it('null activityType falls back to clinic navigation (backward compat)', () => {
    expect(getActivityNavigation(null)).toHaveLength(getActivityNavigation('clinic').length);
  });
});

describe('AI PRICING — fixed price from the canonical `price` column', () => {
  const imagingData: ClinicOperatingData = {
    services: [
      // بانوراما: fixed price stored in `price` (price_min was null — the bug)
      { id: 'pano', name: 'تصوير بانوراما', description: null, duration_minutes: 5, pricing_type: 'fixed', price: 30, price_min: null, price_max: null, price_visible_to_patients: true, active: true, requires_provider: false },
      // CBCT: range pricing via price_min/price_max (worked before)
      { id: 'cbct', name: 'تصوير طبقي cbct', description: null, duration_minutes: 5, pricing_type: 'range', price: null, price_min: 70, price_max: 300, price_visible_to_patients: true, active: true, requires_provider: false },
      // legacy row: fixed via price_min only
      { id: 'legacy', name: 'legacy fixed', description: null, duration_minutes: 5, pricing_type: 'fixed', price: null, price_min: 50, price_max: null, price_visible_to_patients: true, active: true, requires_provider: false },
    ],
    providers: [],
    providerServiceIds: [],
    hasServices: true,
    hasProviders: false,
    usable: true,
  };

  it('describeServicePrice returns the canonical price for بانوراما (was "غير محدد")', () => {
    const pano = imagingData.services[0];
    expect(describeServicePrice(pano)).toBe('30');
  });
  it('describePriceForPrompt includes the fixed price in the prompt section', () => {
    expect(describePriceForPrompt('pano', imagingData)).toBe(', price: 30');
  });
  it('CBCT range pricing still renders', () => {
    expect(describeServicePrice(imagingData.services[1])).toBe('70–300');
    expect(describePriceForPrompt('cbct', imagingData)).toBe(', price range: 70–300');
  });
  it('legacy fixed rows using price_min still work (no regression)', () => {
    expect(describeServicePrice(imagingData.services[2])).toBe('50');
  });
  it('hidden prices are never exposed', () => {
    const hidden = { ...imagingData.services[0], price_visible_to_patients: false };
    expect(describeServicePrice(hidden)).toBeNull();
  });
});