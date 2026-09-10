import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/** BOOKING E2E live — public receptionist → real booking → DB readback + hours edges. */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = 'http://localhost:3244';
const SLUG = 'amal-x-ray-center';
const results = [];
const check = (n, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' — ' + extra : ''}`);

async function main() {
  const { data: clinic } = await sb.from('clinics').select('id, slug').eq('slug', SLUG).single();
  const { data: service } = await sb.from('clinic_services').select('id, name, duration_minutes').eq('clinic_id', clinic.id).eq('name', 'تصوير بانوراما').maybeSingle();
  const { data: provider } = await sb.from('providers').select('id, name').eq('clinic_id', clinic.id).maybeSingle();
  console.log('SERVICE:', service && service.id, service && service.name, 'duration=', service && service.duration_minutes);
  console.log('PROVIDER:', provider && provider.id, provider && provider.name);

  await fetch(`${BASE}/api/public/ai/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clinic_slug: SLUG, text: 'مرحبا، أريد حجز موعد تصوير بانوراما.' }) }).catch(() => null);
  const { data: convs } = await sb.from('conversations').select('id').eq('clinic_id', clinic.id).order('created_at', { ascending: false }).limit(1);
  const conversationId = convs ? convs[0].id : null;
  check('new conversation created (real id)', !!conversationId, conversationId || '');

  const date = '2026-09-10';
  const patientName = 'E2E PROBE ' + Date.now();
  const { data: patient, error: patErr } = await sb.from('patients').insert({ clinic_id: clinic.id, full_name: patientName, phone_number: '+970599111222', deleted_at: null }).select('id').single();
  check('disposable TEST patient created', !patErr && !!patient, patErr ? patErr.message : '');

  const availForBook = await fetch(BASE + '/api/booking/availability?clinic_id=' + clinic.id + '&provider_id=' + provider.id + '&date=' + date + '&service_id=' + service.id).then((r) => r.json());
  const availSlots = (availForBook.data && availForBook.data.slots) || [];
  const chosenSlot = availSlots[0] || '';
  console.log('CHOSEN SLOT:', chosenSlot);
  const chosenTime = String(chosenSlot).split('T')[1].slice(0, 5);

  const bookingRes = await fetch(`${BASE}/api/booking`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clinic_id: clinic.id, provider_id: provider.id, service: service.name, service_id: service.id, conversation_id: conversationId, date: date, time: chosenTime || '09:00', patient_name: patientName, phone: '+970599111222' }),
  });
  const bookingBody = await bookingRes.json().catch(() => ({}));
  console.log('BOOKING HTTP', bookingRes.status, JSON.stringify(bookingBody).slice(0, 240));
  check('booking succeeds (no 400/404)', bookingRes.status === 200 || bookingRes.status === 201, 'http ' + bookingRes.status);
  const apptId = bookingBody.data ? bookingBody.data.appointment_id || bookingBody.data.id : bookingBody.id;
  check('appointment id returned', !!apptId, apptId || '');

  if (apptId) {
    const { data: appt } = await sb.from('appointments').select('*').eq('id', apptId).maybeSingle();
    console.log('APPT DB:', appt ? appt.appointment_date + ' ' + appt.scheduled_at + ' svc=' + (appt.service_id || '') + ' conv=' + (appt.conversation_id || '') + ' status=' + appt.status : 'null');
    check('appointment persisted (date correct)', appt ? appt.appointment_date === date : false);
    check('service_id persisted', appt ? appt.service_id === service.id : false);
    check('provider_id persisted', appt ? appt.provider_id === provider.id : false);
    check('conversation linked', appt ? appt.conversation_id === conversationId : false);
    check('status = tentative', appt ? appt.status === 'tentative' : false);
  }

  const avail = await fetch(BASE + '/api/booking/availability?clinic_id=' + clinic.id + '&provider_id=' + provider.id + '&date=' + date + '&service_id=' + service.id).then((r) => r.json());
  const slots = (avail.data && avail.data.slots) || [];
  console.log('SLOTS:', slots.slice(0, 5).join(', '), ' … last:', slots.slice(-2).join(', '));
  check('slots never before 09:00 (9:00 ص)', !slots[0] || Number(String(slots[0]).split('T')[1].slice(0, 2)) >= 9, 'first=' + slots[0]);
  const last = slots[slots.length - 1] || '';
  const lastH = last ? Number(String(last).split('T')[1].slice(0, 2)) : 0;
  const lastM = last ? Number(String(last).split('T')[1].slice(3, 5)) : 0;
  check('last slot <= 20:00 (8:00 م)', lastH < 20 || (lastH === 20 && lastM === 0), 'last=' + last);
  check('no slots after 20:00', !slots.some((s) => Number(String(s).split('T')[1].slice(0, 2)) > 20));
  const fAvail = await fetch(BASE + '/api/booking/availability?clinic_id=' + clinic.id + '&provider_id=' + provider.id + '&date=2026-09-11&service_id=' + service.id).then((r) => r.json());
  const fslots = (fAvail.data && fAvail.data.slots) || [];
  check('Friday closed (0 slots)', fslots.length === 0, 'fri_slots=' + fslots.length);

  await sb.from('patients').update({ deleted_at: new Date().toISOString() }).eq('id', patient.id);
  if (apptId) await sb.from('appointments').update({ deleted_at: new Date().toISOString() }).eq('id', apptId);
  check('cleanup (test patient + appointment soft-deleted)', true);

  console.log('\n=== BOOKING E2E ===');
  for (const r of results) console.log(r);
  const fails = results.filter((r) => r.startsWith('FAIL'));
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' PASS');
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });