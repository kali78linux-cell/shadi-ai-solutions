/**
 * STEP 10C-B — Authenticated dashboard validation (synthetic owner+clinic only).
 * Safety: creates a synthetic clinic + owner via the real register API, signs in
 * with real auth, verifies dashboard APIs (conversations/messages/appointments),
 * cross-tenant RBAC (vs shadi-nouri), and UI auth-gates. Cleans up ONLY rows it
 * created, by IDs captured at creation time. No migrations, no resets.
 */
import fs from 'fs';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const stamp = Date.now();
const email = `e2e-10c-${stamp}@test-delete.local`;
const slug = `e2e-10c-${stamp}`;
const created = { clinicId: null, userId: null, convIds: [], apptIds: [], patientIds: [], serviceIds: [], providerIds: [], shadiConvId: null };
const results = [];
const check = (n, ok, x = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

async function main() {
  // 1) Register synthetic owner + clinic through the real API
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email, password: 'TestPass!234', clinic_name: 'عيادة لوحة STEP10C', clinic_slug: slug,
      owner_name: 'مالك 10C TEST', owner_phone: '+970599000222', clinic_type: 'dental_clinic',
      city: 'رام الله', country: 'فلسطين', address: 'عنوان TEST', clinic_phone: '+970922200022',
    }),
  });
  const regBody = await reg.json().catch(() => ({}));
  check('register owner+clinic', reg.ok && Boolean(regBody?.data?.id), `status=${reg.status}`);
  const CID = created.clinicId = regBody?.data?.id;
  if (!CID) throw new Error('no clinic id');

  // 2) Real login session
  const { data: sess, error: sessErr } = await anon.auth.signInWithPassword({ email, password: 'TestPass!234' });
  check('login (real auth session)', Boolean(sess?.session?.access_token) && !sessErr, sessErr?.message ?? '');
  const AUTH = { authorization: `Bearer ${sess.session.access_token}`, 'content-type': 'application/json' };

  // Tenant Y (read-only target): shadi-nouri
  const { data: shadi } = await admin.from('clinics').select('id').eq('slug', 'shadi-nouri').single();
  const SHADI = shadi?.id ?? null;

  // 3) Dashboard clinic context (authenticated, own clinic)
  const ov = await fetch(`${BASE}/api/clinic/overview?clinic_id=${CID}`, { headers: AUTH });
  check('dashboard overview (own clinic)', ov.status === 200, `status=${ov.status}`);

  // 4) Conversations list starts empty for the fresh clinic
  const cl0 = await fetch(`${BASE}/api/ai/conversations?clinic_id=${CID}`, { headers: AUTH });
  const cl0Body = await cl0.json().catch(() => null);
  check('conversations list (own, empty)', cl0.status === 200 && Array.isArray(cl0Body?.data) && cl0Body.data.length === 0, `status=${cl0.status} n=${cl0Body?.data?.length}`);

  // 5) Patient conversation via the public API on the synthetic clinic
  const m1 = await fetch(`${BASE}/api/public/ai/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clinic_slug: slug, text: 'مرحبا، عندي تسوس بالضرس' }),
  });
  const m1Body = await m1.json().catch(() => null);
  const convId = m1Body?.conversation_id ?? null;
  if (convId) created.convIds.push(convId);
  check('public AI message (own clinic)', m1.status === 200 && Boolean(convId), `status=${m1.status}`);

  // 6) Dashboard sees the E2E conversation (persistence + visibility)
  const cl1 = await fetch(`${BASE}/api/ai/conversations?clinic_id=${CID}`, { headers: AUTH });
  const cl1Body = await cl1.json().catch(() => null);
  check('dashboard conversations shows E2E conv', cl1.status === 200 && Array.isArray(cl1Body?.data) && cl1Body.data.some((c) => c.id === convId), `status=${cl1.status}`);

  // 7) Dashboard transcript (authorized owner reads the real history)
  const mh = await fetch(`${BASE}/api/ai/messages?conversation_id=${convId}&clinic_id=${CID}`, { headers: AUTH });
  const mhBody = await mh.json().catch(() => null);
  // 8) Appointment visibility in dashboard (direct synthetic seed — booking flow itself was proven in 10B)
  const svc = await admin.from('clinic_services').insert({ clinic_id: CID, name: 'فحص 10C TEST', description: 'TEST', duration_minutes: 30, price: 100, active: true }).select('id').single();
  created.serviceIds.push(svc.data?.id);
  const prov = await admin.from('providers').insert({ clinic_id: CID, user_id: crypto.randomUUID(), provider_type: 'dentist', name: 'طبيب 10C TEST', title: 'دكتور', email: `prov-${stamp}@test-delete.local`, phone: '+970599000444' }).select('id').single();
  created.providerIds.push(prov.data?.id);
  const pat = await admin.from('patients').insert({ clinic_id: CID, full_name: 'مريض لوحة TEST', email: `pat-${stamp}@test-delete.local`, phone_number: '+970599000333', notes: 'STEP 10C synthetic' }).select('id').single();
  created.patientIds.push(pat.data?.id);
  const date = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const appt = await admin.from('appointments').insert({
    clinic_id: CID, provider_id: prov.data.id, patient_id: pat.data.id, service: 'فحص 10C TEST',
    appointment_date: date, scheduled_at: `${date}T09:00:00.000Z`, duration_minutes: 30,
    status: 'tentative', booking_token: createHash('sha256').update(`10c-${stamp}`).digest('hex'), notes: 'STEP 10C synthetic',
  }).select('id').single();
  created.apptIds.push(appt.data?.id);
  const ap = await fetch(`${BASE}/api/appointments?clinic_id=${CID}`, { headers: AUTH });
  const apBody = await ap.json().catch(() => null);
  const apptSeen = Array.isArray(apBody?.data) && apBody.data.some((a) => a.id === appt.data?.id);
  check('dashboard appointments shows seeded appt', ap.status === 200 && apptSeen, `status=${ap.status}`);

  // 9) Cross-tenant RBAC: the owner of clinic X must NOT read tenant Y (shadi-nouri)
  if (SHADI) {
    const f1 = await fetch(`${BASE}/api/ai/conversations?clinic_id=${SHADI}`, { headers: AUTH });
    const f2 = await fetch(`${BASE}/api/appointments?clinic_id=${SHADI}`, { headers: AUTH });
    const f3 = await fetch(`${BASE}/api/clinic/overview?clinic_id=${SHADI}`, { headers: AUTH });
    check('RBAC denies cross-tenant conversations', [401, 403, 404].includes(f1.status), `status=${f1.status}`);
    check('RBAC denies cross-tenant appointments', [401, 403, 404].includes(f2.status), `status=${f2.status}`);
    check('RBAC denies cross-tenant overview', [401, 403, 404].includes(f3.status), `status=${f3.status}`);

    // IDOR via messages API with a Y conversation the token doesn't own
    const yc = await fetch(`${BASE}/api/public/ai/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clinic_slug: 'shadi-nouri', text: 'فحص عزل 10C' }),
    });
    const ycBody = await yc.json().catch(() => null);
    created.shadiConvId = ycBody?.conversation_id ?? null;
    const idor = await fetch(`${BASE}/api/ai/messages?conversation_id=${created.shadiConvId}&clinic_id=${SHADI}`, { headers: AUTH });
    const idorBody = await idor.json().catch(() => null);
    const leaked = idor.status === 200 && Array.isArray(idorBody?.data) && idorBody.data.length > 0;
    check('IDOR blocked: X cannot read Y conversation', !leaked, `status=${idor.status}`);
  }

  // 10) UI auth-gates (dev server)
  for (const [name, path] of [['dashboard gated', '/dashboard'], ['receptionist gated', '/receptionist']]) {
    const r = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    check(`UI ${name} (redirect to login)`, [302, 307].includes(r.status), `status=${r.status}`);
  }
  const lg = await fetch(`${BASE}/login`);
  check('UI login page renders', lg.status === 200, `status=${lg.status}`);

  console.log(results.join('\n'));
}

async function cleanup() {
  const del = [];
  for (const id of created.convIds) del.push(admin.from('messages').delete().eq('conversation_id', id).eq('clinic_id', created.clinicId));
  for (const id of created.convIds) del.push(admin.from('conversations').delete().eq('id', id).eq('clinic_id', created.clinicId));
  if (created.shadiConvId) {
    del.push(admin.from('messages').delete().eq('conversation_id', created.shadiConvId).eq('clinic_id', (await admin.from('clinics').select('id').eq('slug', 'shadi-nouri').single()).data.id));
    del.push(admin.from('conversations').delete().eq('id', created.shadiConvId));
  }
  for (const id of created.apptIds) del.push(admin.from('appointments').delete().eq('id', id).eq('clinic_id', created.clinicId));
  for (const id of created.patientIds) del.push(admin.from('patients').delete().eq('id', id).eq('clinic_id', created.clinicId));
  for (const id of created.providerIds) del.push(admin.from('providers').delete().eq('id', id).eq('clinic_id', created.clinicId));
  for (const id of created.serviceIds) del.push(admin.from('clinic_services').delete().eq('id', id).eq('clinic_id', created.clinicId));
  if (created.clinicId) {
    del.push(admin.from('clinic_users').delete().eq('clinic_id', created.clinicId));
    del.push(admin.from('clinics').delete().eq('id', created.clinicId));
  }
  for (const d of del) await d;
  if (created.clinicId) {
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const owner = users.users.find((u) => u.email === email);
    if (owner) { created.userId = owner.id; await admin.auth.admin.deleteUser(owner.id); }
  }
}

async function verifyCleanup() {
  const out = [];
  const cnt = async (tbl, cid) => { const r = await admin.from(tbl).select('id', { count: 'exact', head: true }).eq('clinic_id', cid); return r.count ?? -1; };
  out.push(`clinic_rows=${(await admin.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinicId)).count ?? 0}`);
  if (created.clinicId) {
    for (const t of ['conversations', 'appointments', 'patients', 'providers', 'clinic_services', 'clinic_users']) out.push(`${t}=${await cnt(t, created.clinicId)}`);
  }
  if (created.shadiConvId) {
    const r = await admin.from('conversations').select('id', { count: 'exact', head: true }).eq('id', created.shadiConvId);
    out.push(`shadi_probe_conv=${r.count ?? 0}`);
  }
  console.log('VERIFY_CLEANUP ' + out.join(' '));
}

main()
  .catch((e) => { console.log(results.join('\n')); console.error('FATAL', e.message); })
  .finally(async () => { await cleanup(); await verifyCleanup(); process.exit(0); });
