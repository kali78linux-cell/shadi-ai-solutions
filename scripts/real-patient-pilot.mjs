/*
 * FIRST REAL PATIENT — CONTROLLED PRODUCTION PILOT (shadi-nouri ONLY)
 *
 * Explicitly authorized by the owner as a controlled pilot. NOT STEP 14.
 * The ONLY real-clinic writes this file performs are:
 *   1 patient  (clear pilot/test name+phone, unique)
 *   1 conversation + its messages
 *   1 appointment (via the real AI conversation state machine — no bypass)
 * ...and it deletes ONLY those rows (by captured IDs) afterwards.
 * It NEVER touches pre-existing clinic data, never uses a demo tenant,
 * never calls Stripe, never alters schema/RLS/migrations.
 *
 * Path under test (MASTER PLAN "FIRST REAL CLINIC"):
 *   Patient → Conversation → AI understanding → Recommendation →
 *   Service resolution → Provider resolution → Real availability →
 *   Patient confirmation → Booking (state=BOOKING + confirmed).
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = 'http://localhost:3111';
const SLUG = 'shadi-nouri';
const PILOT_NAME = 'مريض تجريبي PILOT';
const PILOT_PHONE = '+970599000001';

const created = { conversationId: null, appointmentId: null, patientId: null };
const log = [];
const result = (n, ok, ev = '') => { log.push(`${ok ? 'PASS' : 'FAIL'} ${n}${ev ? ' — ' + ev : ''}`); console.log(`[${ok ? 'PASS' : 'FAIL'}] ${n}${ev ? ' — ' + ev : ''}`); };
const j = (r) => r.json().catch(() => null);
const countAll = async (t, cid) => (await admin.from(t).select('id', { count: 'exact', head: true }).eq('clinic_id', cid)).count ?? -1;

let CID = null;

async function readMeta(convId) {
  const { data } = await admin.from('conversations').select('metadata, conversation_state').eq('id', convId).eq('clinic_id', CID).maybeSingle();
  return data ?? null;
}
async function run() {
  // ---------- Resolve the REAL clinic (never demo) ----------
  const clinicRes = await fetch(`${BASE}/api/booking/clinic?slug=${SLUG}`, { cache: 'no-store' });
  const clinicBody = await j(clinicRes);
  const clinic = clinicBody?.data;
  if (!clinic?.id) throw new Error('Real clinic could not be resolved');
  CID = clinic.id;
  console.log('CLINIC=' + JSON.stringify({ id: clinic.id, name: clinic.name, slug: clinic.slug }));

  // ---------- Baseline counts (pre-existing data protection) ----------
  const base = {
    providers: (await admin.from('providers').select('id', { count: 'exact', head: true }).eq('clinic_id', CID).is('deleted_at', null)).count,
    services: (await admin.from('clinic_services').select('id', { count: 'exact', head: true }).eq('clinic_id', CID).eq('active', true).is('deleted_at', null)).count,
    schedules: await countAll('provider_schedules', CID),
    assignments: await countAll('provider_services', CID),
    patients: await countAll('patients', CID),
    appointments: await countAll('appointments', CID),
    conversations: await countAll('conversations', CID),
    messages: await countAll('messages', CID),
  };
  console.log('BASELINE=' + JSON.stringify(base));

  // ---------- Real operating data (expected values from STEP 13) ----------
  const { data: svc } = await admin.from('clinic_services').select('id,name').eq('clinic_id', CID).eq('active', true).is('deleted_at', null);
  const { data: prov } = await admin.from('providers').select('id,name,title').eq('clinic_id', CID).is('deleted_at', null);
  const { data: links } = await admin.from('provider_services').select('provider_id,service_id').eq('clinic_id', CID);
  const EXP_SERVICE = svc?.[0]?.id;
  const EXP_PROVIDER = prov?.[0]?.id;
  console.log('EXPECTED_SERVICE=' + EXP_SERVICE + ' EXPECTED_PROVIDER=' + EXP_PROVIDER + ' LINKS=' + JSON.stringify(links));

  // ---------- Drive the real conversation via the public AI route ----------
  let convId = null;
  const send = async (text) => {
    const body = { clinic_slug: SLUG, text };
    if (convId) body.conversation_id = convId;
    const res = await fetch(`${BASE}/api/public/ai/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
    });
    const payload = await j(res);
    if (!convId && payload?.conversation_id) { convId = payload.conversation_id; created.conversationId = convId; }
    const reply = payload?.assistant_message?.content ?? '(no assistant reply)';
    console.log(`[TURN] status=${res.status} conv=${convId}\n  PATIENT: ${text}\n  ASSISTANT: ${String(reply).slice(0, 300)}`);
    return { status: res.status, payload };
  };

  // Turn 1 — booking intent for the real service
  await send('مرحبا، عم بوجعني ضرسي من يومين وبدي أحجز عند الدكتور لعمل سحب عصب');

  let meta = convId ? await readMeta(convId) : null;
  let booking = meta ? bookingOf(meta) : {};
  const missingOf = () => {
    const m = [];
    if (!booking.service_id) m.push('service');
    if (!booking.provider_id) m.push('provider');
    if (!booking.patient_name) m.push('patient_name');
    if (!booking.phone) m.push('phone');
    if (!booking.slot) m.push('slot');
    return m;
  };

  // Turn 2 — supply identity if the AI asked for it
  const needIdentity = missingOf().some((f) => f === 'patient_name' || f === 'phone');
  if (needIdentity) {
    await send(`اسمي ${PILOT_NAME}، ورقم هاتفي ${PILOT_PHONE}`);
    meta = convId ? await readMeta(convId) : meta;
    booking = meta ? bookingOf(meta) : {};
  } else {
    console.log('[NEXT] identity already known; skipping identity turn');
  }

  // Capture REAL availability BEFORE the booking is created (the engine will
  // exclude the slot once booked — so post-booking availability is the wrong
  // baseline). Uses the slot the orchestrator already resolved from the engine.
  let preSlots = [];
  const preSlot = booking.slot ?? booking.slot_start ?? null;
  if (preSlot) {
    const d = String(preSlot).slice(0, 10);
    const av = await fetch(`${BASE}/api/booking/availability?clinic_id=${CID}&provider_id=${booking.provider_id}&date=${d}&service_id=${booking.service_id}&limit=20`, { cache: 'no-store' });
    const avb = await j(av);
    preSlots = avb?.data?.slots ?? [];
    console.log('[PRE-SLOTS] date=' + d + ' slots=' + JSON.stringify(preSlots));
  }

  // Turn 3 — confirmation (only if not already booked)
  if (booking.appointment_id || meta?.metadata?.booking?.appointment_id) {
    console.log('[NEXT] booking already created in prior turn');
  } else {
    const still = missingOf();
    console.log('[NEXT] missing after identity turn: ' + JSON.stringify(still));
    const confirmText = still.includes('slot')
      ? 'أكيد بدي أحجز، أكد أول موعد متاح'
      : 'أكيد بدي أحجز، أكد الموعد';
    await send(confirmText);
    meta = convId ? await readMeta(convId) : meta;
    booking = meta ? bookingOf(meta) : {};
  }
// Allow async write settling, then re-read authoritative DB state
  await new Promise((r) => setTimeout(r, 900));
  meta = convId ? await readMeta(convId) : meta;
  booking = meta ? bookingOf(meta) : {};
  created.appointmentId = booking?.appointment_id ?? null;

  const conv = convId ? (await admin.from('conversations').select('*').eq('id', convId).eq('clinic_id', CID).maybeSingle()).data : null;
  console.log('FINAL_CONV=' + JSON.stringify(conv && { id: conv.id, clinic_id: conv.clinic_id, conversation_state: conv.conversation_state, patient_id: conv.patient_id }));
  console.log('FINAL_BOOKING=' + JSON.stringify(booking));

  // ---------- VERIFICATION ----------
  result('1. conversation created for real clinic', Boolean(conv?.id) && conv?.clinic_id === CID, 'id=' + conv?.id);
  result('1b. conversation reached booking/completed state', ['BOOKING', 'COMPLETED'].includes(conv?.conversation_state) || Boolean(booking?.appointment_id), 'state=' + conv?.conversation_state);

  const { data: msgs } = conv
    ? await admin.from('messages').select('role, content, clinic_id').eq('conversation_id', conv.id).eq('clinic_id', CID).order('created_at')
    : { data: null };
  result('2. messages persisted (patient+assistant)', Array.isArray(msgs) && msgs.length >= 2, 'n=' + (msgs?.length ?? 'n/a'));
  result('2b. messages clinic-scoped', (msgs ?? []).every((m) => m.clinic_id === CID), 'clinic=' + CID);

  result('3. AI recommendation service = real service', booking?.service_id === EXP_SERVICE || meta?.metadata?.recommended_service_id === EXP_SERVICE, 'got=' + (booking?.service_id ?? meta?.metadata?.recommended_service_id));
  result('3b. AI recommendation provider = real provider', booking?.provider_id === EXP_PROVIDER || meta?.metadata?.recommended_provider_id === EXP_PROVIDER, 'got=' + (booking?.provider_id ?? meta?.metadata?.recommended_provider_id));

  const appt = created.appointmentId
    ? (await admin.from('appointments').select('*').eq('id', created.appointmentId).eq('clinic_id', CID).maybeSingle()).data
    : null;
  result('4. appointment created exactly once', Boolean(appt) && booking?.appointment_id === appt?.id && appt?.clinic_id === CID, 'id=' + (appt?.id ?? 'n/a'));
if (appt) {
    created.patientId = appt.patient_id;
    const p = (await admin.from('patients').select('id,clinic_id,full_name,phone_number').eq('id', appt.patient_id).maybeSingle()).data;
    result('4b. pilot patient created + clinic-scoped', Boolean(p) && p?.clinic_id === CID && String((p?.phone_number ?? '') + (p?.full_name ?? '')).includes('0599000001'), 'name=' + (p?.full_name ?? 'n/a') + ' phone=' + (p?.phone_number ?? 'n/a'));
    result('4c. appointment provider/service match recommendation', appt?.provider_id === EXP_PROVIDER && appt?.service_id === EXP_SERVICE, 'p=' + appt?.provider_id + ' s=' + appt?.service_id);
    const apptStart = new Date(appt.scheduled_at).getTime();
    const inList = preSlots.some((s) => new Date(s).getTime() === apptStart);
    result('5. appointment time matches real availability slot', inList, 'at=' + appt.scheduled_at + ' preSlots=' + JSON.stringify(preSlots));
  }

  const dup = appt ? (await admin.from('appointments').select('id', { count: 'exact', head: true }).eq('clinic_id', CID).eq('conversation_id', conv?.id)).count : -1;
  result('6. no duplicate appointment for this conversation', dup === 1, 'appointments_for_conv=' + dup);

  const after = {
    providers: (await admin.from('providers').select('id', { count: 'exact', head: true }).eq('clinic_id', CID).is('deleted_at', null)).count,
    services: (await admin.from('clinic_services').select('id', { count: 'exact', head: true }).eq('clinic_id', CID).eq('active', true).is('deleted_at', null)).count,
    schedules: await countAll('provider_schedules', CID),
    assignments: await countAll('provider_services', CID),
  };
  result('7. pre-existing operating data untouched', JSON.stringify(after) === JSON.stringify({ providers: base.providers, services: base.services, schedules: base.schedules, assignments: base.assignments }), JSON.stringify(after));

  const leak = conv ? (await admin.from('conversations').select('clinic_id').neq('clinic_id', CID).eq('id', conv.id).maybeSingle()).data : null;
  result('8. no cross-tenant leakage', !leak, 'leak_clinic=' + (leak?.clinic_id ?? 'none'));

  console.log('\n=== PILOT RESULT ===');
  console.log(log.join('\n'));
  const passed = log.filter((l) => l.startsWith('PASS')).length;
  console.log(`RESULT: ${passed}/${log.length} PASS`);

  await cleanup(passed === log.length, base);
  process.exitCode = passed === log.length && Boolean(appt) ? 0 : 1;
}
async function cleanup(ok, base) {
  console.log('--- CLEANUP (pilot rows only, captured IDs) ---');
  if (created.appointmentId) {
    const q = await admin.from('notification_queue').delete().eq('appointment_id', created.appointmentId);
    console.log('[CLEANUP] notification_queue -> ' + JSON.stringify(q.error ?? 'ok'));
    const a = await admin.from('appointments').delete().eq('id', created.appointmentId).eq('clinic_id', CID);
    console.log('[CLEANUP] appointment -> ' + JSON.stringify(a.error ?? 'ok'));
  }
  if (created.conversationId) {
    const m = await admin.from('messages').delete().eq('conversation_id', created.conversationId).eq('clinic_id', CID);
    console.log('[CLEANUP] messages -> ' + JSON.stringify(m.error ?? 'ok'));
    const c = await admin.from('conversations').delete().eq('id', created.conversationId).eq('clinic_id', CID);
    console.log('[CLEANUP] conversation -> ' + JSON.stringify(c.error ?? 'ok'));
  }
  if (created.patientId) {
    const p = await admin.from('patients').delete().eq('id', created.patientId).eq('clinic_id', CID);
    console.log('[CLEANUP] patient -> ' + JSON.stringify(p.error ?? 'ok'));
  }
  const finalCounts = {
    patients: await countAll('patients', CID), appointments: await countAll('appointments', CID),
    conversations: await countAll('conversations', CID), messages: await countAll('messages', CID),
  };
  const b = { patients: base.patients, appointments: base.appointments, conversations: base.conversations, messages: base.messages };
  console.log('FINAL_COUNTS=' + JSON.stringify(finalCounts) + ' BASELINE=' + JSON.stringify(b));
  result('9. cleanup restored baseline (no residue)', JSON.stringify(finalCounts) === JSON.stringify(b), JSON.stringify(finalCounts));
  if (ok) console.log('\nPILOT_CLEANED=YES');
}

run().catch(async (e) => {
  console.error('FATAL', e);
  if (created.appointmentId) await admin.from('appointments').delete().eq('id', created.appointmentId).catch(() => {});
  if (created.conversationId) { await admin.from('messages').delete().eq('conversation_id', created.conversationId).catch(() => {}); await admin.from('conversations').delete().eq('id', created.conversationId).catch(() => {}); }
  process.exitCode = 1;
});
function bookingOf(meta) { return meta?.metadata?.booking ?? {}; }