import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider: mocks.getProvider }));
vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import { classifyIntent } from '@/lib/ai/intentClassifier';
import { buildPrompt } from '@/lib/ai/promptManager';
import { describeServicePrice } from '@/lib/ai/clinicDataContext';

function providerReturning(intent: string, confidence = 0.85) {
  mocks.getProvider.mockReturnValue({
    embed: false,
    generate: async () => ({ text: JSON.stringify({ intent, confidence, entities: {} }) }),
  });
}

const operatingData: any = {
  services: [
    { id: 's-implant', name: 'زراعة أسنان', description: null, duration_minutes: 60, pricing_type: 'case_by_case', price_min: null, price_max: null, price_visible_to_patients: true, active: true },
    { id: 's-exam', name: 'فحص أسنان', description: null, duration_minutes: 30, pricing_type: 'fixed', price_min: 50, price_max: 50, price_visible_to_patients: true, active: true },
  ],
  providers: [{ id: 'p1', name: 'د. سارة محمود', title: 'أخصائية تقويم' }],
  providerServiceIds: [{ provider_id: 'p1', service_id: 's-exam' }],
  hasServices: true,
  hasProviders: true,
  usable: true,
};

const receptionistState: any = {
  state: 'DISCOVERING_PROBLEM',
  recommended_service_id: 's-implant',
  recommended_provider_id: 'p1',
  patient_confirmed_booking: false,
  pending_question: '',
};

describe('AI Receptionist — intent ordering (LLM primary, keyword fallback)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('classifies by MEANING: availability question is NOT short-circuited by the word "موعد"', async () => {
    providerReturning('general_question');
    const r = await classifyIntent('متى أقرب موعد؟');
    expect(r.intent).toBe('general_question');
  });

  it('emergency signals always win deterministically', async () => {
    providerReturning('greeting');
    const r = await classifyIntent('عندي تورم كبير وصعوبة بالتنفس');
    expect(r.intent).toBe('urgent_signal');
    expect(r.entities.urgency).toBe('critical');
  });

  it('falls back to the deterministic fast-path only when the LLM is unavailable', async () => {
    mocks.getProvider.mockReturnValue({ embed: false, generate: async () => { throw new Error('provider down'); } });
    const r = await classifyIntent('بدي احجز موعد');
    expect(r.intent).toBe('appointment_booking');
  });
});

describe('AI Receptionist — Arabic fast-path fallback works for dialectal Arabic', () => {
  // ROOT-CAUSE REGRESSION GUARD: `\b` word boundaries are ASCII-only in JS and
  // never matched around Arabic letters — these cases all used to fall through
  // to `unknown` whenever the LLM was unavailable.
  beforeEach(() => { vi.clearAllMocks(); });

  async function classifyWithLlmDown(text: string) {
    mocks.getProvider.mockReturnValue({ embed: false, generate: async () => { throw new Error('provider down'); } });
    return classifyIntent(text);
  }

  it('booking: "بدي احجز موعد" / "احجزلي" / "بدي حجز"', async () => {
    expect((await classifyWithLlmDown('بدي احجز موعد')).intent).toBe('appointment_booking');
    expect((await classifyWithLlmDown('احجزلي عند الدكتور')).intent).toBe('appointment_booking');
    expect((await classifyWithLlmDown('بدي حجز')).intent).toBe('appointment_booking');
  });

  it('cancellation: "بدي الغي" / "الغيلي" — and NOT "الحجز متاح؟"', async () => {
    expect((await classifyWithLlmDown('بدي الغي موعدي')).intent).toBe('appointment_cancellation');
    expect((await classifyWithLlmDown('بدي الغيلي')).intent).toBe('appointment_cancellation');
    expect((await classifyWithLlmDown('شو اوقات الحجز؟')).intent).toBe('unknown');
  });

  it('reschedule: "بدي تغيير الموعد"', async () => {
    expect((await classifyWithLlmDown('بدي تغيير الموعد')).intent).toBe('appointment_reschedule');
  });

  it('human handoff: "بدي احكي مع موظفة"', async () => {
    expect((await classifyWithLlmDown('بدي احكي مع موظفة')).intent).toBe('human_handoff');
  });

  it('pure greeting only: "مرحبا" yes — "مرحبا بدي احجز" is booking, not greeting', async () => {
    expect((await classifyWithLlmDown('مرحبا')).intent).toBe('greeting');
    expect((await classifyWithLlmDown('مرحبا بدي احجز')).intent).toBe('appointment_booking');
  });
});

describe('AI receptionist — operating data & pricing in the prompt', () => {
  it('injects real clinic services/providers into the prompt (source of truth)', () => {
    const prompt = buildPrompt({ assistant_name: 'موظفة الاستقبال' } as any, 'بدي تقويم', [], [], [], {
      operatingData,
      receptionistState,
    });
    expect(prompt).toContain('زراعة أسنان');
    expect(prompt).toContain('د. سارة محمود');
    expect(prompt).toContain('RECEPTIONIST OPERATING MODE');
    expect(prompt).toContain('Recommended service id: s-implant');
  });

  it('never says free for price=0 / unspecified pricing', () => {
    const svc: any = { id: 'x', name: 'غ', duration_minutes: 30, pricing_type: 'unspecified', price_min: 0, price_max: 0, price_visible_to_patients: true };
    expect(describeServicePrice(svc)).toBeNull();
    const prompt = buildPrompt({ assistant_name: 'x' } as any, 'شو سعر الخدمة؟', [], [], [], { operatingData: { services: [svc], providers: [] as any, providerServiceIds: [] as any, hasServices: true, hasProviders: false, usable: true }, receptionistState });
    // The service must never appear with a FREE/zero price VALUE. (The guard
    // instruction itself says "never say free", so assert on price values.)
    expect(prompt).not.toMatch(/price:\s*(free|0)/i);
    expect(prompt).toMatch(/never say free/i); // guard instruction present
  });

  it('shows a fixed price only when visible', () => {
    const built = buildPrompt({ assistant_name: 'x' } as any, 'شو سعر الفحص؟', [], [], [], {
      operatingData,
      receptionistState,
    });
    expect(built).toContain('فحص أسنان');
    expect(built).toMatch(/price: 50/);
  });
});