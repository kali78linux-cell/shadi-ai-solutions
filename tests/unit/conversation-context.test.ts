/**
 * STEP 1 — Conversation Context tests.
 *
 * Guards:
 *  - Old conversations (no reception_context) load cleanly (backward compat).
 *  - Fields are added incrementally and never cleared by an unrelated update.
 *  - patient_location is PATIENT-side and never touches the clinics table.
 *  - patient_reported_symptoms is a faithful record, NOT a diagnosis.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  tablesTouched: [] as string[],
  selectPayload: { data: { metadata: { booking: {} } }, error: null } as unknown,
  lastUpdate: null as Record<string, unknown> | null,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from(table: string) {
      state.tablesTouched.push(table);
      return {
        select() {
          let eqCount = 0;
          const obj: any = {
            eq(_key: string, _val: string) {
              eqCount += 1;
              if (eqCount > 2) throw new Error('too many eq on select');
              return obj;
            },
            maybeSingle() {
              return Promise.resolve(state.selectPayload);
            },
          };
          return obj;
        },
        update(payload: Record<string, unknown>) {
          state.lastUpdate = payload;
          let eqCount = 0;
          const obj: any = {
            eq(_key: string, _val: string) {
              eqCount += 1;
              if (eqCount > 2) throw new Error('too many eq on update');
              return eqCount === 2 ? Promise.resolve({ error: null }) : obj;
            },
          };
          return obj;
        },
      };
    },
  },
}));

vi.mock('@/lib/server/logging', () => ({ logEvent: vi.fn() }));

import {
  normalizeConversationContext,
  mergeConversationContext,
  loadConversationContext,
  saveConversationContext,
} from '@/lib/ai/conversationContext';
import { loadReceptionistConversationState } from '@/lib/ai/clinicDataContext';

const CLINIC = 'clinic-1';
const CONV = 'conv-1';

beforeEach(() => {
  state.tablesTouched.length = 0;
  state.lastUpdate = null;
  state.selectPayload = { data: { metadata: { booking: {} } }, error: null };
});

describe('conversation context — backward compatibility', () => {
  it('loads an empty context for an old conversation without reception_context', async () => {
    const ctx = await loadConversationContext(CLINIC, CONV);
    expect(ctx).toEqual({});
    expect(normalizeConversationContext(undefined)).toEqual({});
    expect(normalizeConversationContext({ requested_service: 'x' })).toEqual({ requested_service: 'x' });
  });

  it('falls back to the legacy metadata.patient_location namespace', async () => {
    state.selectPayload = { data: { metadata: { booking: {}, patient_location: { area: 'رام الله', source: 'conversation' } } }, error: null };
    const ctx = await loadConversationContext(CLINIC, CONV);
    expect(ctx.patient_location).toEqual({ city: 'رام الله', source: 'conversation' });
  });
});

describe('conversation context — incremental persistence', () => {
  it('stores patient_location under reception_context and preserves metadata.booking', async () => {
    state.selectPayload = { data: { metadata: { booking: { slot: '2026-08-27T09:00:00.000Z', patient_name: 'عدنان' } } }, error: null };
    const ok = await saveConversationContext(CLINIC, CONV, {
      patient_location: { city: 'رام الله', source: 'conversation' },
    });
    expect(ok).toBe(true);
    const meta = state.lastUpdate!.metadata as Record<string, unknown>;
    expect(meta.booking).toEqual({ slot: '2026-08-27T09:00:00.000Z', patient_name: 'عدنان' });
    expect((meta.reception_context as any).patient_location).toEqual({ city: 'رام الله', source: 'conversation' });
  });

  it('updates patient_location city without duplicating fields', async () => {
    await saveConversationContext(CLINIC, CONV, { patient_location: { city: 'رام الله', source: 'conversation' } });
    state.selectPayload = { data: { metadata: state.lastUpdate!.metadata }, error: null };
    await saveConversationContext(CLINIC, CONV, { patient_location: { city: 'نابلس', source: 'user_selected' } });
    const meta = state.lastUpdate!.metadata as Record<string, unknown>;
    expect(meta.reception_context).toEqual({ patient_location: { city: 'نابلس', source: 'user_selected' } });
  });

  it('accumulates requested_service then preferred_provider without losing earlier values', async () => {
    await saveConversationContext(CLINIC, CONV, { requested_service: 'فحص أسنان' });
    state.selectPayload = { data: { metadata: state.lastUpdate!.metadata }, error: null };
    await saveConversationContext(CLINIC, CONV, { preferred_provider: 'سارة' });
    const meta = state.lastUpdate!.metadata as Record<string, unknown>;
    expect(meta.reception_context).toEqual({ requested_service: 'فحص أسنان', preferred_provider: 'سارة' });
  });

  it('returns false when the conversation is missing', async () => {
    state.selectPayload = { data: null, error: null };
    const ok = await saveConversationContext(CLINIC, 'missing', { requested_service: 'x' });
    expect(ok).toBe(false);
  });
});

describe('conversation context — merge semantics', () => {
  it('merge keeps existing nested city when only region is added', () => {
    const merged = mergeConversationContext(
      { patient_location: { city: 'رام الله', source: 'conversation' } },
      { patient_location: { region: 'الوسطى' } }
    );
    expect(merged.patient_location).toEqual({ city: 'رام الله', region: 'الوسطى', source: 'conversation' });
  });

  it('appends patient_reported_symptoms as a faithful record, not a diagnosis', () => {
    const merged = mergeConversationContext(
      { patient_reported_symptoms: 'ألم في الضرس' },
      { patient_reported_symptoms: 'يزداد مع الساخن' }
    );
    expect(merged.patient_reported_symptoms).toBe('ألم في الضرس / يزداد مع الساخن');
    expect(Object.keys(merged)).not.toContain('diagnosis');
  });

  it('rejects invalid values via zod normalization', () => {
    const ctx = normalizeConversationContext({ preferred_date: 12345 });
    expect(ctx.preferred_date).toBeUndefined();
    const badRange = normalizeConversationContext({ preferred_time_range: { from: '25:99' } });
    expect(badRange.preferred_time_range).toBeUndefined();
  });
});

describe('conversation context — state loader integration', () => {
  it('maps reception_context onto ReceptionistConversationState', async () => {
    state.selectPayload = {
      data: {
        metadata: {
          state: 'DISCOVERING_PROBLEM',
          recommended_service_id: 'svc-1',
          recommended_provider_id: 'prov-1',
          patient_confirmed_booking: false,
          booking: { slot: '2026-08-27T09:00:00.000Z' },
          reception_context: {
            patient_location: { city: 'رام الله', source: 'conversation' },
            requested_service: 'فحص أسنان',
            patient_reported_symptoms: 'ألم يزداد مع الساخن',
            booking_intent: true,
          },
        },
      },
      error: null,
    };
    const rs = await loadReceptionistConversationState(CLINIC, CONV);
    expect(rs).not.toBeNull();
    expect(rs!.booking.slot).toBe('2026-08-27T09:00:00.000Z');
    expect(rs!.requested_service).toBe('فحص أسنان');
    expect(rs!.patient_location).toEqual({ city: 'رام الله', source: 'conversation' });
    expect(rs!.patient_reported_symptoms).toBe('ألم يزداد مع الساخن');
    expect(rs!.booking_intent).toBe(true);
  });

  it('never queries the clinics table when saving patient context', async () => {
    await saveConversationContext(CLINIC, CONV, { patient_location: { city: 'نابلس', source: 'user_selected' } });
    expect(state.tablesTouched.every((t) => t === 'conversations')).toBe(true);
    expect(state.tablesTouched).not.toContain('clinics');
  });
});
