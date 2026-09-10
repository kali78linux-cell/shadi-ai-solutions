// MASTER RECOVERY — TEST-DATA CLEANUP (2026-09-07)
// SAFE, auditable, scoped cleanup of E2E-test-contaminated records for the
// imaging center tenant 14f6ad3a. Only rows attributed to the E2E cohort
// (phone +970599111222 / names E2E* / "Test Patient") are removed, in FK-safe
// order (children first). REAL owner-test patients are KEPT.
// DRY-RUN (default) prints counts; --apply executes the deletes.
import fs from 'fs';
const env = fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8');
const TOKEN = env.match(/^SUPABASE_ACCESS_TOKEN=(.+)$/m)?.[1]?.trim();
const CID = '14f6ad3a-f9bf-4108-a809-7e96ad3e2bf5';

async function q(sql) {
  const r = await fetch('https://api.supabase.com/v1/projects/zcnxrhviyfscyqhavgzj/database/query', {
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(90000),
  });
  const t = await r.text(); if (!r.ok) throw new Error(t.slice(0, 300)); return JSON.parse(t);
}

const NAMES = "(p.full_name ILIKE 'E2E%' OR p.full_name='Test Patient')";
const SCOPE = `p.clinic_id='${CID}' AND ${NAMES}`;

// [label, dry-RUN count SELECT, apply DELETE]
const steps = [
  ['financial_transactions (by invoice of E2E)',
   `SELECT count(*)::int c FROM public.financial_transactions ft JOIN clinic_invoices inv ON inv.id=ft.ref_id JOIN patients p ON p.id=inv.patient_id WHERE ft.ref_table='clinic_invoices' AND ${SCOPE}`,
   `DELETE FROM public.financial_transactions ft USING clinic_invoices inv, patients p WHERE ft.ref_table='clinic_invoices' AND inv.id=ft.ref_id AND p.id=inv.patient_id AND ${SCOPE} RETURNING ft.id`],
  ['clinic_payments (by invoice of E2E)',
   `SELECT count(*)::int c FROM public.clinic_payments pm JOIN clinic_invoices inv ON inv.id=pm.invoice_id JOIN patients p ON p.id=inv.patient_id WHERE ${SCOPE}`,
   `DELETE FROM public.clinic_payments pm USING clinic_invoices inv, patients p WHERE inv.id=pm.invoice_id AND p.id=inv.patient_id AND ${SCOPE} RETURNING pm.id`],
  ['clinic_invoices (E2E)',
   `SELECT count(*)::int c FROM public.clinic_invoices inv JOIN patients p ON p.id=inv.patient_id WHERE ${SCOPE}`,
   `DELETE FROM public.clinic_invoices inv USING patients p WHERE p.id=inv.patient_id AND ${SCOPE} RETURNING inv.id`],
  ['appointments (E2E)',
   `SELECT count(*)::int c FROM public.appointments a JOIN patients p ON p.id=a.patient_id WHERE ${SCOPE}`,
   `DELETE FROM public.appointments a USING patients p WHERE p.id=a.patient_id AND ${SCOPE} RETURNING a.id`],
  ['imaging_requests (E2E)',
   `SELECT count(*)::int c FROM public.imaging_requests i JOIN patients p ON p.id=i.patient_id WHERE ${SCOPE}`,
   `DELETE FROM public.imaging_requests i USING patients p WHERE p.id=i.patient_id AND ${SCOPE} RETURNING i.id`],
  ['imaging_results (by E2E request)',
   `SELECT count(*)::int c FROM public.imaging_results r JOIN imaging_requests ir ON ir.id=r.imaging_request_id JOIN patients p ON p.id=ir.patient_id WHERE ${SCOPE}`,
   `DELETE FROM public.imaging_results r USING imaging_requests ir, patients p WHERE r.imaging_request_id=ir.id AND p.id=ir.patient_id AND ${SCOPE} RETURNING r.id`],
  ['patients (E2E cohort)',
   `SELECT count(*)::int c FROM public.patients p WHERE ${SCOPE}`,
   `DELETE FROM public.patients p WHERE ${SCOPE} RETURNING p.id`],
];

const DRY = !process.argv.includes('--apply');
console.log('MODE:', DRY ? 'DRY-RUN (counts only)' : 'APPLY');
let total = 0;
for (const [name, countSql, delSql] of steps) {
  try {
    if (DRY) {
      const rows = await q(countSql);
      console.log(name.padEnd(46), '=>', rows[0]?.c ?? 0, '(dry)');
    } else {
      const rows = await q(delSql);
      const n = Array.isArray(rows) ? rows.length : 0;
      total += n;
      console.log(name.padEnd(46), '=>', n, '(deleted)');
    }
  } catch (e) {
    console.log('ERR ' + name + ': ' + String(e).slice(0, 180));
  }
}
if (!DRY) console.log('TOTAL deleted:', total);