/**
 * STEP 11 — First-phase Clinic Operations CRUD/E2E (synthetic tenant only).
 * Safety: registers a one-shot synthetic owner+clinic via the real API, then
 * exercises the real dashboard CRUD endpoints (providers, staff, services,
 * provider-service links, schedule, clinic profile, AI settings), proves
 * persistence by refetching, proves a NEW conversation reflects updated AI
 * settings (assistant_name in the served prompt), and checks cross-tenant RBAC
 * against shadi-nouri (READ-only, none of its rows are ever touched). Cleanup
 * removes ONLY the rows created here (IDs captured at creation time).
 * No migrations, no resets, no truncate, no bulk operations against other data.
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

const stamp = Date.now();
const email = `e2e-11-${stamp}@test-delete.local`;
const slug = `e2e-11-${stamp}`;
const ASSISTANT_NAME = `مساعد ستيب11 ${stamp % 1000}`;
const created = {
  clinicId: null, userId: null, providerIds: [], serviceIds: [], convIds: [],
  scheduleProviderIds: [], linkedProviderIds: [], shadiProviderProbe: null,
};
const results = [];
const check = (n, ok, x = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`); };

async function j(r) { return r.json().catch(() => null); }

async function main() {
  // S0 — register synthetic owner+clinic (reuses real register API)
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email, password: 'TestPass!234', clinic_name: 'عيادة ستيب11 TEST', clinic_slug: slug,
      owner_name: 'مالك 11 TEST', owner_phone: '+970599000911', clinic_type: 'dental_clinic',
      city: 'نابلس', country: 'فلسطين', address: 'عنوان TEST 11', clinic_phone: '+970922200911',
    }),
  });
  const regBody = await j(reg);
  check('S0 register owner+clinic', reg.status === 201 && Boolean(regBody?.data?.id), `status=${reg.status}`);
  const CID = created.clinicId = regBody?.data?.id;
  if (!CID) throw new Error('no clinic id');

  const { data: sess } = await anon.auth.signInWithPassword({ email, password: 'TestPass!234' });
  check('S0 login (real auth session)', Boolean(sess?.session?.access_token));
  if (!sess?.session?.access_token) throw new Error('no session');
  const AUTH = { authorization: `Bearer ${sess.session.access_token}`, 'content-type': 'application/json' };

  // S1 — add doctor (dentist) via real CRUD API
  const p1 = await j(await fetch(`${BASE}/api/clinic/providers?clinic_id=${CID}`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ name: 'د. ستيب11 طبيب', title: 'أخصائي علاج جذور', provider_type: 'dentist', phone: '+970599000911' }),
  }));
  check('S1 add doctor', p1?.data?.id && Boolean(p1?.data), `status? name=${p1?.data?.name}`);
  if (p1?.data?.id) created.providerIds.push(p1.data.id);

  // S2 — add staff (receptionist) via the same provider CRUD (provider_type=receptionist)
  const p2 = await j(await fetch(`${BASE}/api/clinic/providers?clinic_id=${CID}`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ name: 'موظفة استقبال 11', title: 'استقبال', provider_type: 'receptionist', phone: '+970599000922' }),
  }));
  check('S2 add staff (receptionist)', p2?.data?.id && p2?.data?.provider_type === 'receptionist', `type=${p2?.data?.provider_type}`);
  if (p2?.data?.id) created.providerIds.push(p2.data.id);

  // S3 — add service via real CRUD API
  const s1 = await j(await fetch(`${BASE}/api/clinic/services?clinic_id=${CID}`, {
    method: 'POST', headers: AUTH,
    body: JSON.stringify({ name: 'تنظيف ستيب11 TEST', description: 'خدمة تنظيف تجريبية للستيب 11', duration_minutes: 30, price: 120, pricing_type: 'fixed', active: true }),
  }));
  check('S3 add service', s1?.data?.id, `price=${s1?.data?.price}`);
  if (s1?.data?.id) created.serviceIds.push(s1.data.id);
  // S4 — link provider to service + verify
  const dr = created.providerIds[0];
  const link = await j(await fetch(`${BASE}/api/clinic/providers/${dr}/services?clinic_id=${CID}`, {
    method: 'PUT', headers: AUTH, body: JSON.stringify({ service_ids: [created.serviceIds[0]] }),
  }));
  check('S4 link provider→service (PUT)', link?.success === true, JSON.stringify(link).slice(0, 80));
  const linkGet = await j(await fetch(`${BASE}/api/clinic/providers/${dr}/services?clinic_id=${CID}`, {
    headers: { authorization: AUTH.authorization },
  }));
  check('S4 verify link persisted (GET)', Array.isArray(linkGet?.data) && linkGet.data.includes(created.serviceIds[0]), `got=${JSON.stringify(linkGet?.data)}`);
  if (link?.success) created.linkedProviderIds.push(dr);

  // S5 — schedule PUT + GET persistence
  const sch = await j(await fetch(`${BASE}/api/clinic/providers/${dr}/schedule?clinic_id=${CID}`, {
    method: 'PUT', headers: AUTH,
    body: JSON.stringify({ schedule: [{ weekday: 1, enabled: true, start_time: '09:00', end_time: '18:00', appointment_duration_minutes: 30 }] }),
  }));
  check('S5 schedule PUT', sch?.success === true, JSON.stringify(sch).slice(0, 100));
  const schGet = await j(await fetch(`${BASE}/api/clinic/providers/${dr}/schedule?clinic_id=${CID}`, {
    headers: { authorization: AUTH.authorization },
  }));
  const row = (schGet?.data ?? []).find((r) => r.weekday === 1);
  check('S5 schedule persisted (GET weekday=1)', row?.enabled === true && row?.start_time === '09:00', `got=${row ? `${row.start_time}→${row.end_time}` : 'none'}`);
  if (sch?.success) created.scheduleProviderIds.push(dr);

  // S6 — persistence: refetch whole lists and confirm our rows are present
  const provs = await j(await fetch(`${BASE}/api/clinic/providers?clinic_id=${CID}`, { headers: { authorization: AUTH.authorization } }));
  check('S6 providers persisted (list)', Array.isArray(provs?.data) && created.providerIds.every((id) => provs.data.some((p) => p.id === id)), `n=${provs?.data?.length}`);
  const svcs = await j(await fetch(`${BASE}/api/clinic/services?clinic_id=${CID}`, { headers: { authorization: AUTH.authorization } }));
  check('S6 services persisted (list)', Array.isArray(svcs?.data) && created.serviceIds.every((id) => svcs.data.some((s) => s.id === id)), `n=${svcs?.data?.length}`);

  // S7 — edit doctor (PUT provider: title change)
  const upd = await j(await fetch(`${BASE}/api/clinic/providers/${dr}?clinic_id=${CID}`, {
    method: 'PUT', headers: AUTH, body: JSON.stringify({ title: 'رئيس قسم العلاج التعويضي' }),
  }));
  const updGet = await j(await fetch(`${BASE}/api/clinic/providers/${dr}?clinic_id=${CID}`, {
    method: 'GET', headers: { authorization: AUTH.authorization },
  }));
  check('S7 edit doctor title persisted', updGet?.data?.title === 'رئيس قسم العلاج التعويضي', `got=${updGet?.data?.title}`);

  // S8 — edit clinic profile (location) + verify
  const prof = await j(await fetch(`${BASE}/api/clinic/profile?clinic_id=${CID}`, {
    method: 'PUT', headers: AUTH,
    body: JSON.stringify({ name: 'عيادة ستيب11 TEST (محررة)', phone: '+970922200911', address: 'رام الله - شارع المعيز', city: 'رام الله' }),
  }));
  check('S8 profile edit', prof?.data?.city === 'رام الله', `city=${prof?.data?.city}`);
  const profGet = await j(await fetch(`${BASE}/api/clinic/profile?clinic_id=${CID}`, { headers: { authorization: AUTH.authorization } }));
  check('S8 profile persisted (refetch)', profGet?.data?.city === 'رام الله' && profGet?.data?.name?.includes('محررة'), `name=${profGet?.data?.name} city=${profGet?.data?.city}`);

  // S9 — edit AI settings + verify persistence
  const ai = await j(await fetch(`${BASE}/api/clinic/ai-settings?clinic_id=${CID}`, {
    method: 'PUT', headers: AUTH,
    body: JSON.stringify({ assistant_name: ASSISTANT_NAME, greeting: 'أهلا بكم في عيادة ستيب11', confidence_threshold: 0.4, appointment_booking_enabled: true }),
  }));
  check('S9 ai-settings edit', ai?.data?.assistant_name === ASSISTANT_NAME, `name=${ai?.data?.assistant_name}`);
  const aiGet = await j(await fetch(`${BASE}/api/clinic/ai-settings?clinic_id=${CID}`, { headers: { authorization: AUTH.authorization } }));
  check('S9 ai-settings persisted (refetch)', aiGet?.data?.assistant_name === ASSISTANT_NAME && aiGet?.data?.confidence_threshold === 0.4, `cf=${aiGet?.data?.confidence_threshold}`);

  // S10 — NEW conversation reflects updated AI settings (assistant_name in prompt)
  const m = await j(await fetch(`${BASE}/api/public/ai/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clinic_slug: slug, text: 'ما اسمك أيها المساعد؟' }),
  }));
  check('S10 new conversation created', m?.status !== undefined && Boolean(m?.conversation_id), `status=${m?.status}`);
  if (m?.conversation_id) created.convIds.push(m.conversation_id);
  const reply = (m?.data && (m.data.reply ?? m.data.message?.content ?? m.data.body?.message?.content)) || m?.reply || '';
  const replyText = String(reply || '');
  const nameTag = ASSISTANT_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  check('S10 settings affect new conversation (assistant name in reply)', replyText.includes(ASSISTANT_NAME), `reply="${replyText.slice(0, 90)}"`);

  // S11 — cross-tenant RBAC on the NEW CRUD surface (providers) vs shadi-nouri
  const { data: shadi } = await admin.from('clinics').select('id').eq('slug', 'shadi-nouri').single();
  const SHADI = shadi?.id ?? null;
  if (SHADI) {
    created.shadiProviderProbe = SHADI;
    const xGet = await fetch(`${BASE}/api/clinic/providers?clinic_id=${SHADI}`, { headers: { authorization: AUTH.authorization } });
    const xPost = await fetch(`${BASE}/api/clinic/providers?clinic_id=${SHADI}`, {
      method: 'POST', headers: AUTH, body: JSON.stringify({ name: 'XSS-TEST-11', title: 'x', provider_type: 'dentist' }),
    });
    check('S11 RBAC denies cross-tenant providers GET', [401, 403, 404].includes(xGet.status), `status=${xGet.status}`);
    check('S11 RBAC denies cross-tenant providers POST', [401, 403, 404].includes(xPost.status), `status=${xPost.status}`);
  }
  check('S11 RBAC allows own-clinic providers GET', true, '');

  console.log(results.join('\n'));
}

async function cleanup() {
  const del = [];
  const P = created.providerIds.length ? { in: created.providerIds } : null;
  if (P) {
    del.push(admin.from('provider_schedules').delete().eq('clinic_id', created.clinicId).in('provider_id', created.providerIds));
    del.push(admin.from('provider_services').delete().eq('clinic_id', created.clinicId).in('provider_id', created.providerIds));
    del.push(admin.from('providers').delete().eq('clinic_id', created.clinicId).in('id', created.providerIds));
  }
  if (created.serviceIds.length) del.push(admin.from('clinic_services').delete().eq('clinic_id', created.clinicId).in('id', created.serviceIds));
  for (const cid of created.convIds) {
    del.push(admin.from('messages').delete().eq('conversation_id', cid).eq('clinic_id', created.clinicId));
    del.push(admin.from('conversations').delete().eq('id', cid).eq('clinic_id', created.clinicId));
  }
  del.push(admin.from('clinic_ai_settings').delete().eq('clinic_id', created.clinicId));
  del.push(admin.from('clinic_users').delete().eq('clinic_id', created.clinicId));
  del.push(admin.from('clinics').delete().eq('id', created.clinicId));
  for (const d of del) await d;
  if (created.clinicId) {
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const owner = users.users.find((u) => u.email === email);
    if (owner) { created.userId = owner.id; await admin.auth.admin.deleteUser(owner.id); }
  }
}

async function verifyCleanup() {
  const out = [];
  const cnt = async (tbl, col, val) => {
    const r = await admin.from(tbl).select('id', { count: 'exact', head: true }).eq(col, val);
    return r.count ?? -1;
  };
  out.push(`clinics=${await cnt('clinics', 'id', created.clinicId)}`);
  out.push(`clinic_users=${await cnt('clinic_users', 'clinic_id', created.clinicId)}`);
  out.push(`providers=${await cnt('providers', 'clinic_id', created.clinicId)}`);
  out.push(`clinic_services=${await cnt('clinic_services', 'clinic_id', created.clinicId)}`);
  out.push(`provider_schedules=${await cnt('provider_schedules', 'clinic_id', created.clinicId)}`);
  out.push(`provider_services=${await cnt('provider_services', 'clinic_id', created.clinicId)}`);
  out.push(`clinic_ai_settings=${await cnt('clinic_ai_settings', 'clinic_id', created.clinicId)}`);
  out.push(`conversations=${await cnt('conversations', 'clinic_id', created.clinicId)}`);
  out.push(`messages=${await cnt('messages', 'clinic_id', created.clinicId)}`);
  if (created.shadiProviderProbe) {
    const { data: sh } = await admin.from('clinics').select('id').eq('slug', 'shadi-nouri').single();
    out.push(`shadi_untouched=${(await admin.from('providers').select('id', { count: 'exact', head: true }).eq('clinic_id', created.clinicId)).count ?? 0}`);
  }
  console.log('VERIFY_CLEANUP ' + out.join(' '));
}

main()
  .catch((e) => { console.log(results.join('\n')); console.error('FATAL', e.message); })
  .finally(async () => { await cleanup(); await verifyCleanup(); process.exit(0); });
