/**
 * ARCHITECTURAL GUARD: PatientLocation stays fully separate from ClinicLocation.
 * persistPatientLocation may only ever UPDATE conversations (scoped), and must
 * never read or write the clinics table.
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
        // select().eq(id).eq(clinic_id).maybeSingle()
        select() {
          let eqCount = 0;
          const obj: any = {
            eq(_key: string, _val: string) { eqCount += 1; if (eqCount > 2) throw new Error('too many eq on select'); return obj; },
            maybeSingle() { return Promise.resolve(state.selectPayload); },
          };
          return obj;
        },
        // update(payload).eq(id).eq(clinic_id) → awaited
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

import { persistPatientLocation, patientLocationSchema, buildManualPatientLocation } from '@/lib/ai/patientLocation';

describe('patient location separation', () => {
  beforeEach(() => {
    state.tablesTouched.length = 0;
    state.lastUpdate = null;
    state.selectPayload = { data: { metadata: { booking: {} } }, error: null };
  });

  it('stores patient area under conversations.metadata.patient_location', async () => {
    const ok = await persistPatientLocation('clinic-1', 'conv-1', { area: 'رام الله', source: 'conversation' });
    expect(ok).toBe(true);
    expect(state.tablesTouched.every((t) => t === 'conversations')).toBe(true);
    expect((state.lastUpdate!.metadata as any).patient_location).toEqual(
      expect.objectContaining({ area: 'رام الله', source: 'conversation' })
    );
  });

  it('NEVER touches the clinics table (no clinic-location inference)', async () => {
    await persistPatientLocation('clinic-1', 'conv-1', { area: 'رام الله', source: 'user_selected' });
    expect(state.tablesTouched).not.toContain('clinics');
  });

  it('keeps existing metadata keys intact (merge, not replace)', async () => {
    await persistPatientLocation('clinic-1', 'conv-1', { area: 'نابلس', source: 'user_selected' });
    const meta = state.lastUpdate!.metadata as Record<string, unknown>;
    expect(meta.booking).toEqual({});
    expect(meta.patient_location).toEqual(expect.objectContaining({ area: 'نابلس' }));
  });

  it('returns false gracefully when conversation missing', async () => {
    (state as any).selectPayload = { data: null, error: null };
    const ok = await persistPatientLocation('clinic-1', 'missing-conv', { area: 'X', source: 'conversation' });
    expect(ok).toBe(false);
  });

  it('rejects unknown location sources', async () => {
    const ok = await persistPatientLocation('clinic-1', 'conv-1', { area: 'X', source: 'guessing' as never });
    expect(ok).toBe(false);
    expect(patientLocationSchema.safeParse({ source: 'guessing' }).success).toBe(false);
  });
});

describe('STEP 6 — manual/shared location flow (buildManualPatientLocation)', () => {
  it('builds a validated user_selected location (UI picker)', () => {
    expect(buildManualPatientLocation({ city: ' رام الله ' })).toEqual({
      city: 'رام الله',
      source: 'user_selected',
    });
  });

  it('accepts a shared_location (device-derived area) with an optional region', () => {
    expect(buildManualPatientLocation({ city: 'نابلس', region: 'الجنوب', source: 'shared_location' })).toEqual({
      city: 'نابلس',
      region: 'الجنوب',
      source: 'shared_location',
    });
  });

  it('never emits raw GPS: shared_location is only a city/area name + provenance', () => {
    const loc = buildManualPatientLocation({ city: 'رام الله', source: 'shared_location' });
    expect(loc).toBeDefined();
    expect(loc!.city).toBe('رام الله');
    expect(loc!).not.toHaveProperty('latitude');
    expect(loc!).not.toHaveProperty('longitude');
    expect(loc!.source).toBe('shared_location');
  });

  it('returns PATIENT-side info only — never any clinic location field', () => {
    const loc = buildManualPatientLocation({ city: 'غزة', source: 'user_selected' });
    expect(loc).toBeDefined();
    const keys = Object.keys(loc!);
    ['clinic_name', 'clinic_address', 'city_of_clinic'].forEach((k) => expect(keys).not.toContain(k));
  });

  it('rejects an empty city and an unknown source (no guessing)', () => {
    expect(buildManualPatientLocation({ city: '   ' })).toBeUndefined();
    expect(buildManualPatientLocation({ city: 'رام الله', source: 'gps' as never })).toBeUndefined();
  });

  it('trims + caps city length consistently', () => {
    const loc = buildManualPatientLocation({ city: 'x'.repeat(500) });
    expect(loc!.city.length).toBeLessThanOrEqual(120);
  });
});
