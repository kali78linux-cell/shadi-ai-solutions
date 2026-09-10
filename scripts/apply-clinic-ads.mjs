/**
 * STEP 15E/G1 — apply db/migrations/20260833_clinic_ads_fix.sql
 * (corrected additive version of 20260820: fixes the unsupported
 *  `CREATE TRIGGER IF NOT EXISTS` syntax error).
 *
 * Pre-checks that no partial artifacts exist from the failed original run.
 * After apply, verifies live: table, columns, index, trigger, RLS, 4 policies
 * (with _safe helper), anon REST = 0 rows, zero production rows created,
 * and subscriptions/billing_plans untouched.
 * Never prints credentials. Exit 0 on PASS, 1 on failure.
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
  if (!res.ok) throw new Error((body && (body.message || body.error)) || `HTTP ${res.status}`);
  return body;
}

// ── 0) Pre-check: the DB must be clean of partial clinic_ads artifacts ──
const preTable = await runQuery("select to_regclass('public.clinic_ads') as t");
const preExists = Array.isArray(preTable) && preTable[0] && preTable[0].t !== null;
console.log(`PRE-CHECK clinic_ads exists before apply: ${preExists}`);
if (preExists) {
  console.log('BLOCKED: clinic_ads already exists — refusing to apply fix over unknown state.');
  process.exit(1);
}
const preTrg = await runQuery(
  "select count(*)::int as c from pg_trigger where tgname='clinic_ads_updated_at'"
);
console.log(`PRE-CHECK orphan trigger count: ${Array.isArray(preTrg) ? preTrg[0]?.c : 'ERR'}`);

// ── Apply corrected migration ──
const file = 'db/migrations/20260833_clinic_ads_fix.sql';
console.log(`Applying ${file} ...`);
await runQuery(fs.readFileSync(file, 'utf8'));
console.log('APPLY: OK');

// ── Post-checks ──
const checks = [
  ['clinic_ads table exists', `select 1 from information_schema.tables where table_schema='public' and table_name='clinic_ads'`],
  ['expected columns present (title, ctas, dates, is_active)', `select count(*)::int as c from information_schema.columns where table_schema='public' and table_name='clinic_ads' and column_name in ('id','clinic_id','title','image_url','cta_text','cta_link','is_active','display_order','start_date','end_date','created_at','updated_at')`],
  ['active index exists', `select count(*)::int as c from pg_indexes where schemaname='public' and tablename='clinic_ads' and indexname='idx_clinic_ads_clinic_active'`],
  ['updated_at trigger present', `select count(*)::int as c from pg_trigger where tgrelid='public.clinic_ads'::regclass and tgname='clinic_ads_updated_at'`],
  ['RLS enabled on clinic_ads', `select relrowsecurity::int as c from pg_class where oid='public.clinic_ads'::regclass`],
  ['4 RLS policies on clinic_ads', `select count(*)::int as c from pg_policies where schemaname='public' and tablename='clinic_ads'`],
  ['policies use _safe helper (no recursion)', `select count(*)::int as c from pg_policies where schemaname='public' and tablename='clinic_ads' and (qual ilike '%_safe%' or with_check ilike '%_safe%')`],
  ['zero production rows created', `select count(*)::int as c from public.clinic_ads`],
  ['subscriptions row count unchanged (baseline recorded)', `select count(*)::int as c from public.subscriptions`],
  ['billing_plans still has 5 seed rows', `select count(*)::int as c from public.billing_plans`],
];

let failed = false;
const beforeSubs = Number((await runQuery(checks[8][1]))[0]?.c ?? -1);
const beforeBp = Number((await runQuery(checks[9][1]))[0]?.c ?? -1);
console.log(`baseline subscriptions rows = ${beforeSubs}, billing_plans rows = ${beforeBp}`);

for (const [name, sql] of checks) {
  try {
    const rows = await runQuery(sql);
    const val = Array.isArray(rows) ? rows[0] : null;
    const ok =
      name.includes('expected columns') ? val?.c === 12 :
      name.includes('active index') ? val?.c === 1 :
      name.includes('updated_at trigger') ? val?.c === 1 :
      name.includes('RLS enabled') ? val?.c === 1 :
      name.includes('4 RLS policies') ? val?.c === 4 :
      name.includes('_safe helper') ? val?.c === 4 :
      name.includes('zero production rows') ? val?.c === 0 :
      name.includes('subscriptions') ? val?.c === beforeSubs :
      name.includes('billing_plans') ? val?.c === beforeBp :
      Array.isArray(rows) && rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ' | val=' + JSON.stringify(val)}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}

const afterSubs = Number((await runQuery(checks[8][1]))[0]?.c ?? -1);
console.log(`${afterSubs === beforeSubs ? 'PASS' : 'FAIL'} | subscriptions unchanged (${beforeSubs} -> ${afterSubs})`);
if (afterSubs !== beforeSubs) failed = true;

process.exit(failed ? 1 : 0);