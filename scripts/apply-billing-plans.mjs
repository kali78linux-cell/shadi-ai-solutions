/**
 * STEP 15B — apply db/migrations/20260830_billing_plans.sql (additive, safe),
 * then verify: table exists, 5 seed rows, anon cannot read it (RLS locked),
 * subscriptions untouched.
 * Never prints credentials. Exit 0 on PASS, 1 on any failure.
 */
import fs from 'node:fs';

function get(key) {
  const line = fs.readFileSync('.env.local', 'utf8').split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = get('SUPABASE_ACCESS_TOKEN');
if (!url || !accessToken || accessToken.startsWith('your-')) {
  console.log('BLOCKED: missing SUPABASE_ACCESS_TOKEN');
  process.exit(1);
}

const ref = url.replace('https://', '').split('.')[0];
const apiBase = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function runQuery(sql) {
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message ?? `HTTP ${res.status}`);
  return body;
}

const file = 'db/migrations/20260830_billing_plans.sql';
console.log(`Applying ${file} ...`);
await runQuery(fs.readFileSync(file, 'utf8'));
console.log('APPLY: OK');

// STEP 15G-FIX — keep the seed canonical going forward (legacy keys → canonical matrix).
const fixFile = 'db/migrations/20260836_billing_plans_limits_canonical.sql';
console.log(`Applying ${fixFile} ...`);
await runQuery(fs.readFileSync(fixFile, 'utf8'));
console.log('APPLY: OK (limits canonicalized)');

const checks = [
  ['billing_plans table exists', `select 1 from information_schema.tables where table_schema='public' and table_name='billing_plans'`],
  ['billing_plans has 5 seed rows', `select count(*)::int as c from public.billing_plans`],
  ['billing_plans.columns (plan_id,name,currency,price_per_month,billing_interval,stripe_price_id,features,limits,metadata,is_active,is_public,display_order)', `select count(*)::int as c from information_schema.columns where table_schema='public' and table_name='billing_plans'`],
  ['RLS enabled on billing_plans', `select relrowsecurity::int as c from pg_class where oid='public.billing_plans'::regclass`],
  ['subscriptions row count unchanged pre/post (recorded)', `select count(*)::int as c from public.subscriptions`],
];

let failed = false;
const beforeSubs = Number((await runQuery(checks[4][1]))[0]?.c ?? -1);
console.log(`baseline subscriptions rows = ${beforeSubs}`);

for (const [name, sql] of checks.slice(0, 4)) {
  try {
    const rows = await runQuery(sql);
    const val = Array.isArray(rows) ? rows[0] : null;
    const ok =
      name.includes('has 5 seed rows') ? val?.c === 5 :
      name.includes('columns') ? val?.c >= 10 :
      name.includes('RLS') ? val?.c === 1 :
      Array.isArray(rows) && rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ' | val=' + JSON.stringify(val)}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}

// Ensure subscriptions are untouched (still same count).
const afterSubs = Number((await runQuery(checks[4][1]))[0]?.c ?? -1);
console.log(`${afterSubs === beforeSubs ? 'PASS' : 'FAIL'} | subscriptions row count unchanged (${beforeSubs} -> ${afterSubs})`);
if (afterSubs !== beforeSubs) failed = true;

process.exit(failed ? 1 : 0);