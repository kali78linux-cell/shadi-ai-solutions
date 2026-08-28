import { describe, expect, it } from 'vitest';
import {
  buildClinicLookupQuery,
  clinicGateStateFromPayload,
  isClinicUuid,
} from '@/lib/chat/clinicGate';

/**
 * CLINIC CONTEXT GATE tests.
 *
 * Regression: the dashboard had NO path into /chat carrying the clinic
 * identity ("لم يتم تحديد العيادة" bug), and uuid identifiers were queried
 * with the wrong key (?slug=) so dashboard-originated links could never
 * resolve a clinic name.
 */

const DASHBOARD_UUID = 'b16f0b34-2c47-4d1e-9d3a-8f0c72aa1234';

describe('isClinicUuid', () => {
  it('detects uuid vs slug identifiers', () => {
    expect(isClinicUuid(DASHBOARD_UUID)).toBe(true);
    expect(isClinicUuid('demo-dental-clinic')).toBe(false);
    expect(isClinicUuid('')).toBe(false);
  });
});

describe('buildClinicLookupQuery', () => {
  it('queries uuid identifiers with clinic_id= (dashboard path)', () => {
    expect(buildClinicLookupQuery(DASHBOARD_UUID)).toBe(`clinic_id=${DASHBOARD_UUID}`);
  });

  it('queries slug identifiers with slug= (public link path)', () => {
    expect(buildClinicLookupQuery('demo-dental-clinic')).toBe('slug=demo-dental-clinic');
    expect(buildClinicLookupQuery('عيادة-الرحمة')).toBe(
      `slug=${encodeURIComponent('عيادة-الرحمة')}`
    );
  });
});

describe('clinicGateStateFromPayload', () => {
  it('opens the chat ready state with the REAL clinic name from the DB', () => {
    const outcome = clinicGateStateFromPayload({ data: { id: DASHBOARD_UUID, name: 'عيادة الرحمة' } });
    expect(outcome).toEqual({ kind: 'ready', clinicId: DASHBOARD_UUID, clinicName: 'عيادة الرحمة' });
  });

  it('falls back to null name when DB name missing — never invents one', () => {
    const outcome = clinicGateStateFromPayload({ data: { id: DASHBOARD_UUID } });
    expect(outcome).toEqual({ kind: 'ready', clinicId: DASHBOARD_UUID, clinicName: null });
  });

  it('maps empty payloads to not_found (no demo fallback, ever)', () => {
    expect(clinicGateStateFromPayload(null)).toEqual({ kind: 'not_found' });
    expect(clinicGateStateFromPayload({ data: null })).toEqual({ kind: 'not_found' });
    expect(clinicGateStateFromPayload({ error: 'Clinic not found' })).toEqual({ kind: 'not_found' });
  });
});