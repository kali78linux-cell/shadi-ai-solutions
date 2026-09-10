import fs from 'fs';
import crypto from 'crypto';

const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const BASE = 'http://localhost:3210';
const whsec = process.env.F4_WHSEC || '';
const sk = env.STRIPE_SECRET_KEY;
const clinic = fs.readFileSync('/tmp/f4sec/v2_clinic', 'utf8').trim();
const email = fs.readFileSync('/tmp/f4sec/v2_email', 'utf8').trim();
const sessionId = fs.readFileSync('/tmp/f4sec/v2_session', 'utf8').trim();

const ref = 'https://api.supabase.com/v1/projects/' + env.NEXT_PUBLIC_SUPABASE_URL.replace('https://', '').split('.')[0] + '/database/query';
const sql = async (q) => {
  const r = await fetch(ref, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN },
    body: JSON.stringify({ query: q }),
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
};
const single = (r) => (Array.isArray(r) && r[0]) ? r[0] : null;

function stripeSign(raw) {
  const ts = Math.floor(Date.now() / 1000);
  const v = crypto.createHmac('sha256', whsec).update(`${ts}.${raw}`, 'utf8').digest('hex');
  return `t=${ts},v1=${v}`;
}
async function deliver(raw) {
  const r = await fetch(`${BASE}/api/payments/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': stripeSign(raw) },
    body: raw,
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
const out = [];
async function main() {
  // Fetch the real session from Stripe and rebuild a REAL checkout.session.completed event
  const s = await fetch(`https://api.stripe.com/v1/checkout/sessions/${sessionId}?expand[]=line_items`, {
    headers: { authorization: `Bearer ${sk}` },
  }).then((r) => r.json());
  const li = s?.line_items?.data?.[0] ?? {};
  check('real session from Stripe: ILS 12000 / growth price / clinic A',
    s?.currency === 'ils' && s?.amount_total === 12000 && li.price?.id === env.STRIPE_PRICE_GROWTH_MONTHLY && s?.client_reference_id === clinic,
    `cur=${s?.currency} amt=${s?.amount_total} price=${li.price?.id} clinic=${s?.client_reference_id === clinic}`);

  const evt = {
    id: `evt_f4v2_${sessionId.slice(-6)}`,
    object: 'event', type: 'checkout.session.completed', api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000), livemode: false,
    data: { object: { id: s.id, object: 'checkout.session', client_reference_id: s.client_reference_id, metadata: s.metadata ?? {}, customer: s.customer, subscription: s.subscription } },
  };
  const raw = JSON.stringify(evt);

  // First delivery: activates the subscription (unpaid -> active)
  const d1 = await deliver(raw);
  const row1 = single(await sql(`select plan_id,status,stripe_checkout_session_id,updated_at from subscriptions where clinic_id='${clinic}' and deleted_at is null`));
  check('webhook #1 (real signed event) -> DB ACTIVE/growth', d1.status === 200 && row1?.status === 'active' && row1?.plan_id === 'growth' && row1?.stripe_checkout_session_id === sessionId, `status=${d1.status} plan=${row1?.plan_id} status=${row1?.status}`);

  // Second delivery: idempotency -> zero writes, updated_at unchanged
  const preN = await sql('select (select count(*) from subscriptions) subs');
  const d2 = await deliver(raw);
  const postN = await sql('select (select count(*) from subscriptions) subs');
  const rowsA = await sql(`select id from subscriptions where clinic_id='${clinic}' and deleted_at is null`);
  const row2 = single(await sql(`select updated_at from subscriptions where clinic_id='${clinic}' and deleted_at is null`));
  check('webhook #2 (duplicate event) -> 200 + zero writes',
    d2.status === 200 && Number(preN[0]?.subs) === Number(postN[0]?.subs) && rowsA.length === 1 && row1?.updated_at === row2?.updated_at,
    `status=${d2.status} subs=${preN[0]?.subs}->${postN[0]?.subs} rowsA=${rowsA.length} updated_at_unchanged=${row1?.updated_at === row2?.updated_at}`);
// Entitlements via authenticated API now reflect growth/active (server-side, clinic A only)
  const sign = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'content-type': 'application/json', apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password: 'TestPass!234' }),
  }).then((x) => x.json());
  if (!sign.access_token) {
    check('entitlements growth/active for A', false, `login_fail=${sign.error_description ?? sign.error}`);
  } else {
    const g = await fetch(`${BASE}/api/clinic/subscription?clinic_id=${clinic}`, { headers: { authorization: `Bearer ${sign.access_token}` } });
    const gj = await g.json().catch(() => ({}));
    const ent = gj?.data?.entitlements;
    check('entitlements: growth/active for A (server-side)', g.status === 200 && ent?.planId === 'growth' && ent?.status === 'active', `plan=${ent?.planId}/${ent?.status}`);
  }

  // Cleanup A + any leftover e2e
  await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/clinics?id=eq.${clinic}`, {
    method: 'DELETE', headers: { authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, apikey: env.SUPABASE_SERVICE_ROLE_KEY },
  });
  const fin = single(await sql('select (select count(*) from subscriptions) subs,(select count(*) from billing_plans) plans,(select count(*) from entitlement_usage) ent,(select count(*) from clinics where slug like \'e2e-%\') leftc'));
  check('cleanup: baseline restored (subs=4 plans=5 ent=0 leftc=0)', Number(fin?.subs) === 4 && Number(fin?.plans) === 5 && Number(fin?.ent) === 0 && Number(fin?.leftc) === 0, JSON.stringify(fin));

  console.log(out.join('\n'));
  const failed = out.filter((l) => l.startsWith('FAIL')).length;
  console.log(`SUMMARY ${out.length - failed}/${out.length} PASS`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error('FATAL', e?.message || e);
  console.log(out.join('\n'));
  process.exit(2);
});
const check = (name, ok, extra = '') => out.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);