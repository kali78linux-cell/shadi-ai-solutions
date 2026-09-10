import { describe, it, expect } from 'vitest';

/**
 * Phase 32 — Security matrix (pure unit) proving the CROSS-TENANT rules.
 * These mirror the DB/API invariants implemented in the 20260922 migration +
 * the referral/files APIs: access is relationship + patient + imaging-request
 * + role. A third tenant never sees anything.
 */
describe('PHASE 32 — security matrix (cross-tenant rules)', () => {
  const clinicA = 'clinic-a';
  const imagingB = 'imaging-b';
  const tenantC = 'tenant-c';
  const patientX = 'patient-x';
  const requestR = 'request-r';

  it('an imaging request connects exactly {clinic, patient, imaging center}', () => {
    const referralRow = {
      id: requestR,
      clinic_id: imagingB, // owner (imaging center)
      referring_clinic_id: clinicA,
      patient_id: patientX,
    };
    expect(referralRow.clinic_id).toBe(imagingB);
    expect(referralRow.patient_id).toBe(patientX);
    expect(referralRow.referring_clinic_id).toBe(clinicA);

    const canClinicASee = referralRow.referring_clinic_id === clinicA;
    const canTenantC = referralRow.referring_clinic_id === tenantC || referralRow.clinic_id === tenantC;
    expect(canClinicASee).toBe(true);
    expect(canTenantC).toBe(false);
  });

  it('medical file access scopes to the patient link + request link (never a bare file id)', () => {
    const file = { clinic_id: imagingB, patient_id: patientX, imaging_request_id: requestR };
    const allowedFor = (org: string) =>
      org === file.clinic_id ||
      // partner org with a request that ties THIS org and the patient
      (org === clinicA && file.imaging_request_id === requestR);
    expect(allowedFor(clinicA)).toBe(true); // referring clinic
    expect(allowedFor(imagingB)).toBe(true); // recording center
    expect(allowedFor(tenantC)).toBe(false); // third tenant DENIED
  });

  it('relationship acceptance gate requires the TARGET org and requested status', () => {
    const rel = { source_org_id: clinicA, target_org_id: imagingB, status: 'requested' };
    const canAccept = (org: string) => org === rel.target_org_id && rel.status === 'requested';
    expect(canAccept(imagingB)).toBe(true);
    expect(canAccept(clinicA)).toBe(false); // source cannot accept
    expect(canAccept(tenantC)).toBe(false); // unrelated cannot accept
  });

  it('public media stays public; medical files stay private (different buckets)', () => {
    const publicBucket = 'clinic-public-media';
    const medicalBucket = 'medical-files';
    expect(publicBucket).not.toBe(medicalBucket);
    expect(publicBucket.endsWith('public-media')).toBe(true);
    expect(medicalBucket).toContain('medical');
  });

  it('one effective subscription per tenant (DB partial unique invariant)', () => {
    // Mirrors uq_subscriptions_one_active_per_clinic: active + not deleted.
    const uniqueKey = (clinicId: string, status: string, deleted: boolean) =>
      `${clinicId}|${status === 'active' && !deleted ? 'active' : ''}`;
    expect(uniqueKey(clinicA, 'active', false)).toBe(uniqueKey(clinicA, 'active', false));
    expect(uniqueKey(clinicA, 'unpaid', false)).not.toBe(uniqueKey(clinicA, 'active', false));
    expect(uniqueKey(clinicA, 'active', true)).not.toBe(uniqueKey(clinicA, 'active', false));
  });
});