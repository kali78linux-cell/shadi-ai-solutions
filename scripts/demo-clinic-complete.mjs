// Complete the demo clinic build: assignments + schedules only (idempotent).
// Reuses the already-created demo clinic/provider/service records.
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = env.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const S_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const clinicId = process.argv[2] ?? fs.readFileSync('/tmp/demo_clinic.txt', 'utf8').trim();

const sdk = createClient(S_URL, ANON, { auth: { persistSession: false } });
const sess = await sdk.auth.signInWithPassword({ email: 'owner.modernsmile@demo.test', password: 'DemoSmile#2026' });
if (!sess.data?.session?.access_token) { console.error('signin failed'); process.exit(1); }
const token = sess.data.session.access_token;

const api = async (path, { method = 'GET', body } = {}) => {
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};
const list = async (path) => { const r = await api(path); return r.body?.data ?? []; };
const ok = (r, label) => { console.log(`[${r.status===200?'OK':'FAIL'}] ${label} -> ${r.status}`); if (r.status!==200) console.log('   ', JSON.stringify(r.body)?.slice(0,300)); };

// Providers & services for this clinic.
const provs = await list(`/api/clinic/providers?clinic_id=${clinicId}`);
const svcs = await list(`/api/clinic/services?clinic_id=${clinicId}`);
const doctors = provs.filter((p) => p.provider_type === 'dentist');
const svcByName = (name) => svcs.find((s) => s.name === name)?.id;
console.log('DOCTORS=' + doctors.map((d)=>d.name).join(', '));

const assigns = [
  { p: doctors[0]?.id, names: ['فحص أسنان','تنظيف أسنان','حشوة أسنان','خلع أسنان'] },
  { p: doctors[1]?.id, names: ['تقويم أسنان'] },
  { p: doctors[2]?.id, names: ['خلع أسنان','زراعة أسنان'] },
];
const day = (weekday, enabled, s, e) => ({ weekday, enabled, start_time: s, end_time: e, appointment_duration_minutes: 30, max_appointments_per_day: 16 });
const baseDays = [
  day(0,true,'09:00','17:00'), day(1,true,'09:00','17:00'), day(2,true,'09:00','17:00'),
  day(3,true,'09:00','17:00'), day(4,true,'09:00','17:00'), day(5,true,'09:00','13:00'), day(6,false,'09:00','13:00'),
];
for (let idx = 0; idx < assigns.length; idx++) {
  const a = assigns[idx];
  if (!a.p) { console.log('skip missing doctor'); continue; }
  const ids = a.names.map((n) => svcByName(n)).filter(Boolean);
  const r1 = await api(`/api/clinic/providers/${a.p}/services?clinic_id=${clinicId}`, { method: 'PUT', body: { service_ids: ids } });
  report(r1, `assign services to ${doctors[idx].name}`);
  const days = baseDays.map((d) => ({ ...d }));
  if (idx === 0) days[1] = { ...days[1], breaks: [{ start: '13:00', end: '14:00' }] };
  const r2 = await api(`/api/clinic/providers/${a.p}/schedule?clinic_id=${clinicId}`, { method: 'PUT', body: { schedule: days } });
  report(r2, `schedule ${doctors[idx].name}`);
}
console.log('COMPLETION DONE');

function report(r, label) { console.log(`[${r.status==200?'OK':'FAIL'}] ${label} -> ${r.status}`); if (r.status!==200) console.log('   ', JSON.stringify(r.body)?.slice(0,300)); }
process.exit(0);