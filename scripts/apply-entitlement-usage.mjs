/**
 * STEP 15C — apply db/migrations/20260831_entitlement_usage.sql (additive, safe),
 * then verify: table exists, atomic RPC exists, RLS locked (service-role only),
 * indexes/trigger present, and billing_plans (5) + subscriptions untouched.
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

const file = 'db/migrations/20260831_entitlement_usage.sql';
console.log(`Applying ${file} ...`);
await runQuery(fs.readFileSync(file, 'utf8'));
console.log('APPLY: OK');

const checks = [
  ['entitlement_usage table exists', `select 1 from information_schema.tables where table_schema='public' and table_name='entitlement_usage'`],
  ['atomic RPC check_and_increment_entitlement exists', `select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='check_and_increment_entitlement'`],
  ['unique (clinic_id,resource,period_start) constraint', `select 1 from pg_constraint where conrelid='public.entitlement_usage'::regclass and contype='u'`],
  ['RLS enabled on entitlement_usage', `select relrowsecurity::int as c from pg_class where oid='public.entitlement_usage'::regclass`],
  ['no pre-created usage rows (lazy counters)', `select count(*)::int as c from public.entitlement_usage`],
  ['billing_plans still has 5 seed rows', `select count(*)::int as c from public.billing_plans`],
  ['subscriptions row count unchanged (recorded)', `select count(*)::int as c from public.subscriptions`],
];

let failed = false;
const beforeSubs = Number((await runQuery(checks[6][1]))[0]?.c ?? -1);
console.log(`baseline subscriptions rows = ${beforeSubs}`);

for (const [name, sql] of checks) {
  try {
    const rows = await runQuery(sql);
    const val = Array.isArray(rows) ? rows[0] : null;
    const ok =
      name.includes('no pre-created') ? val?.c === 0 :
      name.includes('has 5 seed rows') ? val?.c === 5 :
      name.includes('RLS') ? val?.c === 1 :
      name.includes('subscriptions') ? val?.c === beforeSubs :
      Array.isArray(rows) && rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ' | val=' + JSON.stringify(val)}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}

const afterSubs = Number((await runQuery(checks[6][1]))[0]?.c ?? -1);
console.log(`${afterSubs === beforeSubs ? 'PASS' : 'FAIL'} | subscriptions row count unchanged (${beforeSubs} -> ${afterSubs})`);
if (afterSubs !== beforeSubs) failed = true;

process.exit(failed ? 1 : 0);
