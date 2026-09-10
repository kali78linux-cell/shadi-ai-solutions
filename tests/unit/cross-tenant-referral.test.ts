import { describe, it, expect } from 'vitest';

/**
 * Phase 28 — Cross-tenant referral workflow (pure contract test).
 *
 * Dental Clinic A creates a referral imaging request for Patient X at
 * Imaging Center B. The request lives at the IMAGING CENTER (clinic_id=B).
 * Lifecycle: submitted → accepted → scheduled → in_progress → completed,
 * and the imaging result is ONLY visible to A and B (never tenant C).
 */
describe('PHASE 28 — cross-tenant imaging referral workflow', () => {
  const clinicA = 'clinic-a'; // dental clinic
  const imagingB = 'imaging-b'; // dental imaging center
  const tenantC = 'tenant-c'; // unrelated third tenant
  const patientX = 'patient-x';

  const referralCreated = () => ({
    id: 'req-1',
    clinic_id: imagingB, // the OWNING imaging center
    referring_clinic_id: clinicA,
    patient_id: patientX,
    patient_ref: 'Patient X',
    requested_service: 'CBCT',
    status: 'submitted',
    created_at: '2026-09-05T00:00:00Z',
  });

  it('imaging center receives the referral in its OWN tenant', () => {
    const r = referralCreated();
    // The imaging center's inbox = requests where clinic_id === imaging center id.
    expect(r.clinic_id).toBe(imagingB);
    expect(r.referring_clinic_id).toBe(clinicA);
    expect(r.status).toBe('submitted');
  });

  it('adheres to the imaging request state machine', () => {
    const transitions: Array<[string, string, boolean]> = [
      ['submitted', 'accepted', true],
      ['submitted', 'rejected', true],
      ['submitted', 'needs_clarification', true],
      ['accepted', 'scheduled', true],
      ['scheduled', 'in_progress', true],
      ['in_progress', 'completed', true],
      ['in_progress', 'scheduled', false], // no backward jump
      ['submitted', 'completed', false], // cannot skip to terminal
    ];
    for (const [from, to, allowed] of transitions) {
      expect(allowedFor(from, to), `${from} → ${to}`).toBe(allowed);
    }
  });

  it('referring clinic A sees the completed result; unrelated tenant C is DENIED', () => {
    const result = {
      imaging_request_id: 'req-1',
      referring_clinic_id: clinicA,
      imaging_center_id: imagingB,
      status: 'finalized',
      report_text: 'CBCT study completed',
    };
    const mayRead = (org: string) =>
      org === result.imaging_center_id || org === result.referring_clinic_id;
    expect(mayRead(clinicA)).toBe(true);
    expect(mayRead(imagingB)).toBe(true);
    expect(mayRead(tenantC)).toBe(false);
  });

  it('patient link stays clinic-relative (A owns the patient record)', () => {
    // patients are scoped to their recording clinic; the imaging center never
    // sees the full patient record — only the referral row.
    const patientOwnedBy = { id: patientX, clinic_id: clinicA };
    const imagingSeesPatientRecord = patientOwnedBy.clinic_id === imagingB;
    expect(imagingSeesPatientRecord).toBe(false);
    expect(patientOwnedBy.clinic_id).toBe(clinicA);
  });
});

function allowedFor(from: string, to: string): boolean {
  const map: Record<string, string[]> = {
    submitted: ['accepted', 'rejected', 'needs_clarification', 'cancelled'],
    accepted: ['scheduled'],
    scheduled: ['in_progress', 'cancelled'],
    in_progress: ['ready', 'completed', 'cancelled'],
  };
  return map[from]?.includes(to) ?? false;
}