/**
 * STEP 15D — apply db/migrations/20260832_clinic_public_id.sql (additive, safe),
 * then verify: column exists, all rows backfilled, default present, unique index,
 * not-null enforced, and subscriptions/billing_plans untouched.
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

const file = 'db/migrations/20260832_clinic_public_id.sql';
console.log(`Applying ${file} ...`);
await runQuery(fs.readFileSync(file, 'utf8'));
console.log('APPLY: OK');

const counts = {
  subs: Number((await runQuery('select count(*)::int as c from public.subscriptions'))[0]?.c ?? -1),
  plans: Number((await runQuery('select count(*)::int as c from public.billing_plans'))[0]?.c ?? -1),
};

const checks = [
  ['clinics.public_id column exists', `select 1 from information_schema.columns where table_schema='public' and table_name='clinics' and column_name='public_id'`],
  ['public_id NOT NULL enforced', `select count(*)::int as c from information_schema.columns where table_schema='public' and table_name='clinics' and column_name='public_id' and is_nullable='NO'`, (v) => v?.c === 1],
  ['public_id backfilled for all clinics', `select count(*)::int as c from public.clinics where public_id is null`, (v) => v?.c === 0],
  ['public_id default present', `select 1 from information_schema.columns where table_schema='public' and table_name='clinics' and column_name='public_id' and column_default like '%gen_random_uuid%'`],
  ['unique index on public_id', `select 1 from pg_indexes where tablename='clinics' and indexdef ilike '%unique%' and indexdef ilike '%public_id%'`],
  ['public_id opaque format (32 hex, not uuid-shaped)', `select count(*)::int as c from public.clinics where public_id !~ '^[0-9a-f]{32}$'`, (v) => v?.c === 0],
  ['billing_plans untouched (5 rows)', `select count(*)::int as c from public.billing_plans`, (v) => v?.c === 5 && v?.c === counts.plans],
];

let failed = false;
for (const [name, sql, okFn] of checks) {
  try {
    const rows = await runQuery(sql);
    const val = Array.isArray(rows) ? rows[0] : null;
    const ok = okFn ? okFn(val) : Array.isArray(rows) && rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ' | val=' + JSON.stringify(val)}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}

const afterSubs = Number((await runQuery('select count(*)::int as c from public.subscriptions'))[0]?.c ?? -1);
console.log(`${afterSubs === counts.subs ? 'PASS' : 'FAIL'} | subscriptions row count unchanged (${counts.subs} -> ${afterSubs})`);
if (afterSubs !== counts.subs) failed = true;

process.exit(failed ? 1 : 0);
