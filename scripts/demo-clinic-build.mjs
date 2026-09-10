// Part 1: create realistic DEMO clinic via app paths (register + auth APIs).
// All data synthetic/demo. No Shadi Nouri data, no payments.
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = env.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const S_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
if (!S_URL || S_URL.includes('example')) { console.log('BLOCKED'); process.exit(1); }

const EMAIL = 'owner.modernsmile@demo.test';
const PASSWORD = 'DemoSmile#2026';
const NAME = 'عيادة الابتسامة الحديثة';
const SLUG = 'modern-smile-dental';
let token = '';

const api = async (path, { method = 'GET', body } = {}) => {
  const h = { 'content-type': 'application/json' };
  if (token) h.authorization = `Bearer ${token}`;
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};
const ok = (r, label, expect = 200) => { const pass = r.status === expect; console.log(`[${pass ? 'OK' : 'FAIL'}] ${label} -> HTTP ${r.status}${r.body && r.body.error ? ' :: ' + r.body.error : ''}`); if (!pass) console.error('   ', JSON.stringify(r.body)?.slice(0, 400)); return pass; };

// 1. Create clinic via the app's register route.
const reg = await api('/api/auth/register', { method: 'POST', body: { email: EMAIL, password: PASSWORD, clinic_name: NAME, clinic_slug: SLUG } });
if (reg.status === 409) { console.log('clinic exists (409), reusing'); }
else if (!ok(reg, 'register clinic', 201)) { process.exit(1); }
const clinicId = reg.body?.data?.id;
if (!clinicId) { console.error('no clinic id', JSON.stringify(reg.body)); process.exit(1); }
console.log('CLINIC_ID=' + clinicId);

// 2. Real owner token.
const sdk = createClient(S_URL, ANON, { auth: { persistSession: false } });
const sess = await sdk.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (!sess.data?.session?.access_token) { console.error('signin failed', JSON.stringify(sess.error ?? sess)); process.exit(1); }
token = sess.data.session.access_token;
console.log('OWNER_TOKEN_OK');

// 3. Profile.
ok(await api(`/api/clinic/profile?clinic_id=${clinicId}`, { method: 'PUT', body: { name: NAME, phone: '+972512345678', address: 'شارع الوحدة 12، رام الله (بيانات تجريبية)', website: 'https://modern-smile.demo' } }), 'profile');

// 4. Providers (3 doctors + 2 staff).
const mkEntities = async (list) => {
  const ids = [];
  for (const [name, title, type] of list) {
    const r = await api(`/api/clinic/providers?clinic_id=${clinicId}`, { method: 'POST', body: { name, title, provider_type: type, active: true, email: null, phone: null } });
    ok(r, `create ${type} ${name}`, 201);
    if (r.body?.data?.id) ids.push(r.body.data.id);
  }
  return ids;
};
const providerIds = await mkEntities([
  ['د. أحمد خالد', 'طبيب أسنان عام', 'dentist'],
  ['د. ليان محمود', 'أخصائية تقويم أسنان', 'dentist'],
  ['د. عمر سامر', 'أخصائي زراعة وجراحة أسنان', 'dentist'],
]);
await mkEntities([
  ['سارة ناصر', 'موظفة استقبال', 'staff'],
  ['ريم عادل', 'مديرة عيادة', 'staff'],
]);
// 5. Services (8).
const services = [
  ['فحص أسنان', 'فحص شامل', 30, 50],
  ['تنظيف أسنان', 'إزالة الجير والصبغات', 45, 70],
  ['حشوة أسنان', 'حشو ترميمي', 60, 120],
  ['علاج عصب', 'علاج قناة الجذر', 90, 250],
  ['خلع أسنان', 'خلع سن', 45, 150],
  ['تقويم أسنان', 'خطة تقويم كاملة', 60, 3500],
  ['زراعة أسنان', 'زراعة سن/جسر', 120, 2500],
  ['أشعة بانوراما', 'تصوير بانورامي', 15, 80],
];
const serviceIds = [];
for (const [name, desc, dur, price] of services) {
  const r = await api(`/api/clinic/services?clinic_id=${clinicId}`, { method: 'POST', body: { name, description: desc, duration_minutes: dur, price } });
  ok(r, `create service ${name}`, 201);
  if (r.body?.data?.id) serviceIds.push(r.body.data.id);
}
console.log('SERVICES=' + JSON.stringify(serviceIds));

// 6. Provider-service assignments.
const assignments = [
  { i: 0, s: [0, 1, 2, 4] }, // Ahmed: exam, clean, filling, extract
  { i: 1, s: [5] },          // Leen: braces
  { i: 2, s: [4, 6] },       // Omar: extract, implant
];
for (const { i, s } of assignments) {
  const r = await api(`/api/clinic/providers/${providerIds[i]}/services?clinic_id=${clinicId}`, { method: 'PUT', body: { service_ids: s.map((x) => serviceIds[x]) } });
  ok(r, `assign services doctor[${i}]`);
}

// 7. Working hours + break (weekday: 0=Sun ... 5=Fri, 6=Sat).
const day = (weekday, enabled, s, e) => ({ weekday, enabled, start_time: s, end_time: e, appointment_duration_minutes: 30, max_appointments_per_day: 16 });
const baseDays = [
  day(0, true, '09:00', '17:00'), day(1, true, '09:00', '17:00'), day(2, true, '09:00', '17:00'),
  day(3, true, '09:00', '17:00'), day(4, true, '09:00', '17:00'), day(5, true, '09:00', '13:00'), day(6, false, '09:00', '13:00'),
];
for (let i = 0; i < providerIds.length; i++) {
  const days = baseDays.map((d) => ({ ...d }));
  if (i === 0) days[1] = { ...days[1], breaks: [{ start: '13:00', end: '14:00' }] };
  const r = await api(`/api/clinic/providers/${providerIds[i]}/schedule?clinic_id=${clinicId}`, { method: 'PUT', body: { schedule: days } });
  ok(r, `schedule provider[${i}]`);
}

// 8. Patients (5 synthetic).
const patients = [
  ['محمد سامي', 'mohammad.sami@demo.test', '+970599111222', 'موقع الويب'],
  ['نور أحمد', 'noor.ahmad@demo.test', '+970599333444', 'بحث'],
  ['يزن خالد', 'yazen.khaled@demo.test', '+970599555666', 'إحالة'],
  ['ليان محمد', 'lian.mohammad@demo.test', '+970599777888', 'موقع الويب'],
  ['كريم عادل', 'karim.adel@demo.test', '+970599999000', 'توصية'],
];
for (const [name, email, phone, source] of patients) {
  const r = await api('/api/patients', { method: 'POST', body: { clinic_id: clinicId, name, email, phone, source, status: 'جديد', notes: 'بيانات تجريبية Demo' } });
  ok(r, `create patient ${name}`, 201);
}

// 9. AI settings.
await api(`/api/clinic/ai-settings?clinic_id=${clinicId}`, { method: 'PUT', body: {
  assistant_name: 'استقبال الابتسامة الحديثة', language: 'ar', tone: 'مستقبل طبي محترم ودافئ', greeting: 'أهلاً بك في عيادة الابتسامة الحديثة 👋 كيف يمكننا مساعدتك؟',
  lead_detection_enabled: true, appointment_booking_enabled: true, knowledge_retrieval_enabled: true, confidence_threshold: 0.65, show_service_prices_to_patients: true,
} });

// 10. Communication settings.
await api(`/api/clinic/communication-settings?clinic_id=${clinicId}`, { method: 'PUT', body: {
  emailEnabled: true, smsEnabled: true, whatsappEnabled: true, telegramEnabled: false, defaultChannel: 'email',
  reminderChannels: ['email', 'sms'], confirmationChannels: ['email', 'whatsapp'], cancellationChannels: ['email', 'sms'],
  remindersEnabled: true, reminderOffsetMinutes1: 1440, reminderOffsetMinutes2: 120, confirmationNotifications: true, cancellationNotifications: true, reschedulingNotifications: true, notificationLanguage: 'ar',
} });

console.log('\nDEMO CLINIC READY clinic_id=' + clinicId);
fs.writeFileSync('/tmp/demo_clinic.txt', clinicId);
process.exit(0);
console.log('PROVIDERS=' + JSON.stringify(providerIds));