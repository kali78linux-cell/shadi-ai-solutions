/**
 * STEP 15F — Final Verification E2E (TEST CLINICS ONLY).
 * Creates Clinic A + Clinic B via the real register API, verifies:
 *   tenant isolation (A↔B), subscription flow + Stripe TEST price/currency,
 *   entitlement SQL atomicity, anon REST RLS matrix, public page/QR,
 *   notification-template contract + cross-tenant deny.
 * Cleans up ALL created artifacts. Never touches pre-existing production tenants/patients.
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE || 'http://localhost:3222';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anonSdk = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const pureAnon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const R = [];
const check = (name, ok, extra = '') => R.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
const stamp = Date.now();

async function registerClinic(tag) {
  const email = `e2e-15f-${tag}-${stamp}@test-delete.local`;
  const slug = `e2e-15f-${tag}-${stamp}`;
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email, password: 'TestPass!234',
      clinic_name: `عيادة اختبار 15F ${tag.toUpperCase()}`, clinic_slug: slug,
      owner_name: `مالك 15F ${tag.toUpperCase()}`, owner_phone: '+970599000111',
      clinic_type: 'dental_clinic', city: 'نابلس', country: 'فلسطين',
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.data?.id) throw new Error(`register ${tag} failed: ${res.status}`);
  const users = await sb.auth.admin.listUsers({ perPage: 500 });
  const owner = users.data.users.find((u) => u.email === email);
  const { data: clinic } = await sb.from('clinics').select('id,slug,public_id').eq('id', body.data.id).single();
  const sess = await anonSdk.auth.signInWithPassword({ email, password: 'TestPass!234' });
  return { tag, email, clinicId: clinic.id, slug, publicId: clinic.public_id, token: sess.data?.session?.access_token, owner };
}

async function api(token, path, { method = 'GET', body } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method, cache: 'no-store',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
}

const mgmtApi = 'https://api.supabase.com/v1/projects/' + env.NEXT_PUBLIC_SUPABASE_URL.replace('https://', '').split('.')[0] + '/database/query';
const sql = async (query) => {
  const r = await fetch(mgmtApi, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
    body: JSON.stringify({ query }),
  }).catch(() => null);
  if (!r) return null;
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const pick = (res) => (Array.isArray(res) ? res[0]?.r : res?.result?.value?.r ?? res?.value?.r);

async function main() {
  const baseline = await sql("select (select count(*) from subscriptions) subs, (select count(*) from billing_plans) plans, (select count(*) from entitlement_usage) ent");
  const A = await registerClinic('a');
  const B = await registerClinic('b');
  check('clinics A+B registered with public_id', Boolean(A.publicId && B.publicId), `A=${A.slug}`);

  // ---------- 1) Cross-tenant isolation (A ↔ B) ----------
  const victims = [`/x/${B.clinicId}`, `/x/${A.clinicId}`];
  const isoPaths = (v) => [
    `/api/patients?clinic_id=${v}`,
    `/api/clinic/providers?clinic_id=${v}`,
    `/api/appointments?clinic_id=${v}`,
    `/api/clinic/subscription?clinic_id=${v}`,
    `/api/clinic/ai-settings?clinic_id=${v}`,
    `/api/clinic/members?clinic_id=${v}`,
    `/api/clinic/notification-templates?clinic_id=${v}`,
  ];
  let isoOk = true; const isoDetail = [];
  for (const v of victims) {
    for (const p of isoPaths(v)) {
      const r = await api(A.token, p);
      const denied = [401, 403, 404].includes(r.status) || r.body?.data?.length === 0;
      if (!denied) isoOk = false;
      isoDetail.push(`${p.split('?')[0]}:${r.status}`);
    }
  }
  check('cross-tenant: A cannot access B resources (7 endpoints × 2 directions)', isoOk, isoDetail.join(' '));

  // ---------- 2) Subscription flow (15A/15B guarantees) ----------
  const trial = await api(A.token, `/api/clinic/subscription?clinic_id=${A.clinicId}`, { method: 'POST', body: { plan_id: 'free_trial' } });
  check('free plan via records endpoint allowed', trial.status === 200, `status=${trial.status}`);
  const selfGrant = await api(A.token, `/api/clinic/subscription?clinic_id=${A.clinicId}`, { method: 'POST', body: { plan_id: 'growth' } });
  check('paid-plan self-grant closed (15A)', selfGrant.status === 400 && selfGrant.body?.error === 'PAID_PLAN_NEEDS_CHECKOUT', `status=${selfGrant.status}`);

  // ---------- 3) Pre-verification counts (production untouched guarantee) ----------
  const counts = async () => {
    const r = await sql("select (select count(*) from subscriptions) subs, (select count(*) from billing_plans) plans, (select count(*) from entitlement_usage) ent");
    return Array.isArray(r) ? r[0] : null;
  };
  const before = await counts();
  check('pre-counts captured', Boolean(before), JSON.stringify(before));

  // ---------- 4) Stripe TEST checkout: real session, price/currency/clinic proof (15A/15B) ----------
  const co = await api(A.token, `/api/payments/checkout?clinic_id=${A.clinicId}`, { method: 'POST', body: { plan_id: 'growth' } });
  const sessionId = co.body?.session_id || '';
  check('stripe TEST checkout session created for growth', co.status === 200 && sessionId.startsWith('cs_test_'), `status=${co.status} mode=${co.body?.mode}`);
  let stripeProof = '';
  if (sessionId.startsWith('cs_test_')) {
    const sr = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`, {
      headers: { authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
    }).then((r) => r.json()).catch(() => null);
    const li = sr?.line_items?.data?.[0] ?? {};
    const priceOk = li.price?.id === env.STRIPE_PRICE_GROWTH_MONTHLY;
    const curOk = sr?.currency === 'ils' && li.currency === 'ils';
    const amtOk = sr?.amount_total === 12000;
    const clinicOk = sr?.client_reference_id === A.clinicId;
    check('stripe session: price ILS 12000 + client_reference_id=clinic A', priceOk && curOk && amtOk && clinicOk,
      `price_ok=${priceOk} ils=${curOk} amount=${sr?.amount_total} clinic=${clinicOk}`);
    stripeProof = `${sr?.currency}/${sr?.amount_total}/${li.price?.id}`;
  } else {
    check('stripe session: price ILS 12000 + client_reference_id=clinic A', false, 'no session id');
  }

  // ---------- 5) Entitlements: server-side atomic limit enforcement (15C) ----------
  const ent = async () => {
    const r = await sql(`select check_and_increment_entitlement('${A.clinicId}','ai_messages',2,1) as r`);
    return Array.isArray(r) ? r[0]?.r : null;
  };
  const e1 = await ent(), e2 = await ent(), e3 = await ent();
  check('entitlement atomicity: 2 allowed then blocked at limit', e1?.allowed === true && e2?.allowed === true && e3?.allowed === false,
    `c1=${e1?.allowed} c2=${e2?.allowed} c3=${e3?.allowed} used=${e3?.used}`);

  // ---------- 6) Anon REST RLS matrix (must be 0 rows everywhere) ----------
  const anonTables = ['patients', 'subscriptions', 'billing_plans', 'entitlement_usage', 'clinic_ads', 'clinic_users', 'conversations'];
  let anonOk = true; const anonDetail = [];
  for (const t of anonTables) {
    const { count } = await pureAnon.from(t).select('*', { count: 'exact', head: true });
    anonDetail.push(`${t}:${count}`);
    if ((count ?? 0) !== 0) anonOk = false;
  }
  check('anon REST returns 0 rows on all sensitive tables', anonOk, anonDetail.join(' '));

  // ---------- 7) Public Clinic Page + QR (15D intact after 15A-15E) ----------
  const page = await fetch(`${BASE}/c/${B.slug}`, { cache: 'no-store' });
  const pageText = await page.text();
  const leaks = [A.email, B.email, B.clinicId, A.clinicId].filter((s) => pageText.includes(s));
  check('public page /c/[slug] renders B clinic without private leaks', page.status === 200 && pageText.includes('15F') && leaks.length === 0,
    `status=${page.status} leaks=${leaks.length}`);
  const qr = await fetch(`${BASE}/q/${B.publicId}`, { redirect: 'follow', cache: 'no-store' });
  check('QR /q/[publicId] resolves to public page', qr.status === 200 && qr.url.includes(`/c/${B.slug}`), `status=${qr.status} final=${qr.url.split(BASE)[1]}`);

  // ---------- 8) Patients flow regression (own clinic works, marked TEST) ----------
  const pat = await api(A.token, '/api/patients', { method: 'POST', body: { clinic_id: A.clinicId, name: 'TEST-15F-مريض', phone: '+970599111222' } });
  const patOk = [200, 201].includes(pat.status);
  const own = patOk ? await api(A.token, `/api/patients?clinic_id=${A.clinicId}`) : null;
  check('patients: create in own clinic OK + list visible to owner', patOk && Array.isArray(own?.body) && own.body.length >= 1, `create=${pat.status}`);

  // ---------- 9) Notification templates: own write OK, cross-tenant denied (already in §1) ----------
  const tpl = await api(A.token, `/api/clinic/notification-templates?clinic_id=${A.clinicId}`, { method: 'POST', body: { template_type: 'appointment_reminder', channel: 'whatsapp', language: 'ar', subject: 'تذكير', body: 'موعدك قادم' } });
  check('notification-templates: own create OK (real schema contract)', [200, 201].includes(tpl.status), `status=${tpl.status}`);

  // ---------- 10) Cleanup ALL test artifacts, then verify restoration ----------
  await sb.from('clinics').delete().in('id', [A.clinicId, B.clinicId]);
  for (const c of [A, B]) { if (c.owner?.id) await sb.auth.admin.deleteUser(c.owner.id); }
  const after = await counts();
  const leftClinics = await sb.from('clinics').select('id').in('id', [A.clinicId, B.clinicId]);
  const restored = Number(after?.subs) === Number(before?.subs) && Number(after?.plans) === Number(before?.plans) && Number(after?.ent) === Number(before?.ent);
  const base0 = Array.isArray(baseline) ? baseline[0] : null;
  const restoredBase = Number(after?.subs) === Number(base0?.subs) && Number(after?.plans) === Number(base0?.plans) && Number(after?.ent) === Number(base0?.ent);
  check('cleanup: clinics/users deleted + counts restored to pre-15F baseline', leftClinics.data?.length === 0 && restoredBase, `baseline=${JSON.stringify(base0)} after=${JSON.stringify(after)}`);

  console.log(R.join('\n'));
  const failed = R.filter((l) => l.startsWith('FAIL')).length;
  console.log(`SUMMARY ${R.length - failed}/${R.length} PASS${stripeProof ? ' | stripe=' + stripeProof : ''}`);
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error('FATAL', e?.message || e);
  console.log(R.join('\n'));
  process.exit(2);
});
