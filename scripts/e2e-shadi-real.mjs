// FIRST REAL CLINIC E2E — Shadi Nouri (real clinic, own resources).
// Patient -> AI -> PatientContext -> Recommendation -> Booking -> Appointment,
// all under the SAME clinic_id, using an explicitly TEST-flagged synthetic patient.
// FULL cleanup after verification (only this run's rows; no production rows touched).
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = env.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const S_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const KEY = get('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(S_URL, KEY, { auth: { persistSession: false } });

const CID = '7fe17ccd-8185-407a-8ec4-33bf6e357c2d'; // Shadi Nouri
const SLUG = 'shadi-nouri';
const SERVICE_ID = 'e66bd813-d617-4aa0-9f22-53741c2fc499'; // سحب عصب سن
const PROVIDER_ID = '05db27bf-5c31-4565-8cbd-4441a28066ac'; // خالد جمال

const MARK = `TEST-${Date.now()}`;
const TEST_PATIENT = `مريض تجريبي ${MARK}`;
const TEST_PHONE = `+9705${Date.now().toString().slice(-8)}`; // synthetic, unique per run

const created = { patientId: null, appointmentId: null, conversationId: null };

async function cleanup() {
  const del = [];
  if (created.appointmentId) del.push(admin.from('appointments').delete().eq('id', created.appointmentId).eq('clinic_id', CID));
  if (created.conversationId) {
    del.push(admin.from('messages').delete().eq('conversation_id', created.conversationId).eq('clinic_id', CID));
    del.push(admin.from('conversations').delete().eq('id', created.conversationId).eq('clinic_id', CID));
  }
  if (created.patientId) del.push(admin.from('patients').delete().eq('id', created.patientId).eq('clinic_id', CID));
  await Promise.all(del.map((p) => p));
  console.log('CLEANUP_EXECUTED');
}

async function verifyCleanup() {
  const out = {};
  if (created.patientId) { const r = await admin.from('patients').select('id').eq('id', created.patientId); out.patientRows = r.data?.length ?? 0; }
  if (created.conversationId) {
    const r = await admin.from('conversations').select('id').eq('id', created.conversationId); out.convRows = r.data?.length ?? 0;
    const m = await admin.from('messages').select('id').eq('conversation_id', created.conversationId); out.msgRows = m.data?.length ?? 0;
  }
  if (created.appointmentId) { const r = await admin.from('appointments').select('id').eq('id', created.appointmentId); out.apptRows = r.data?.length ?? 0; }
  console.log('VERIFY_CLEANUP=' + JSON.stringify(out));
}

(async () => {
try {
  // 1) Patient -> AI (real public AI route; creates a real conversation under Shadi Nouri).
  const aiRes = await fetch(`${BASE}/api/public/ai/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clinic_slug: SLUG, text: `أريد حجز موعد لعلاج عصب سن، اسمي ${TEST_PATIENT}` }),
    cache: 'no-store',
  });
  const aiBody = await aiRes.json().catch(() => null);
  created.conversationId = aiBody?.conversation_id ?? null;
  console.log('AI_ROUTE status=' + aiRes.status + ' conv=' + created.conversationId);
  console.log('AI_BOOKING_CONTEXT=' + JSON.stringify(aiBody?.booking_context));

  const recService = aiBody?.booking_context?.recommended_service_id;
  const recProvider = aiBody?.booking_context?.recommended_provider_id;
  console.log('RECOMMENDATION_serviceMatch=' + (recService === SERVICE_ID));
  console.log('RECOMMENDATION_providerMatch=' + (recProvider === PROVIDER_ID));

  // 2) Availability (non-mutating) for the real clinic resources.
  const av = await fetch(`${BASE}/api/booking/availability?clinic_id=${CID}&provider_id=${PROVIDER_ID}&date=2026-08-31&service_id=${SERVICE_ID}`, { cache: 'no-store' });
  const avBody = await av.json().catch(() => null);
  const slots = avBody?.data?.slots ?? [];
  const chosen = slots.find((s) => s.includes('T09:00')) ? '09:00' : null;
  console.log('AVAILABILITY status=' + av.status + ' slots=' + slots.length + ' chosen=' + chosen);
  if (!chosen) throw new Error('No 09:00 slot available; aborted to avoid partial booking test');

  // 3) Booking -> Appointment (real, under Shadi Nouri, synthetic TEST patient).
  const bk = await fetch(`${BASE}/api/booking`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      clinic_id: CID, provider_id: PROVIDER_ID,
      service: 'سحب عصب سن', service_id: SERVICE_ID,
      conversation_id: created.conversationId ?? null,
      date: '2026-08-31', time: chosen,
      patient_name: TEST_PATIENT, phone: TEST_PHONE, email: null,
    }),
    cache: 'no-store',
  });
  const bkBody = await bk.json().catch(() => null);
  console.log('BOOKING status=' + bk.status + ' resp=' + JSON.stringify(bkBody));
  created.appointmentId = bkBody?.data?.appointment_id ?? null;

  // 4) Verify the appointment is in THIS clinic with the right provider/service.
  if (created.appointmentId) {
    const appt = await admin.from('appointments')
      .select('id,clinic_id,provider_id,service_id,conversation_id,status,patient_id')
      .eq('id', created.appointmentId).eq('clinic_id', CID).single();
    console.log('APPT_ROW=' + JSON.stringify(appt.data));
    console.log('APPT_CLINIC_SAFE=' + Boolean(appt.data && appt.data.clinic_id === CID && appt.data.provider_id === PROVIDER_ID));
    created.patientId = appt.data?.patient_id ?? null;
  }
} finally {
  await cleanup();
  await verifyCleanup();
}
process.exit(0);
})();