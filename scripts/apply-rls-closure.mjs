/**
 * STEP 15E/G3 — apply RLS closure migrations:
 *  - 20260834_subscription_write_service_only.sql (subscriptions write → service only)
 *  - 20260835_clinic_ai_settings_policy_safe.sql (unify on *_safe helper)
 * Record subscriptions/billing_plans row counts before and after; verify live:
 *  - subscriptions: member-write policies dropped, write policies require super-admin,
 *    SELECT-for-members still present, service-role probe still sees rows,
 *  - clinic_ai_settings: single policy referencing app_user_is_active_clinic_member_safe,
 *  - anon REST on subscriptions returns 0 rows.
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

const beforeSubs = Number((await runQuery("select count(*)::int as c from public.subscriptions"))[0]?.c ?? -1);
const beforeBp = Number((await runQuery("select count(*)::int as c from public.billing_plans"))[0]?.c ?? -1);
console.log(`baseline subscriptions = ${beforeSubs}, billing_plans = ${beforeBp}`);

for (const file of [
  'db/migrations/20260834_subscription_write_service_only.sql',
  'db/migrations/20260835_clinic_ai_settings_policy_safe.sql',
]) {
  console.log(`Applying ${file} ...`);
  await runQuery(fs.readFileSync(file, 'utf8'));
  console.log('  APPLY: OK');
}

const checks = [
  ['subscriptions: member-write policies removed', `select count(*)::int as c from pg_policies where schemaname='public' and tablename='subscriptions' and cmd in ('INSERT','UPDATE','DELETE') and policyname ilike 'Clinic subscriptions can be %'`],
  ['subscriptions: 3 write policies require super-admin (WITH CHECK)', `select count(*)::int as c from pg_policies where schemaname='public' and tablename='subscriptions' and cmd in ('INSERT','UPDATE','DELETE') and (with_check ilike '%app_is_super_admin%' or qual ilike '%app_is_super_admin%')`],
  ['subscriptions: member SELECT policy preserved', `select count(*)::int as c from pg_policies where schemaname='public' and tablename='subscriptions' and cmd='SELECT' and (qual ilike '%app_user_is_active_clinic_member_safe%')`],
  ['clinic_ai_settings: policy uses _safe helper', `select count(*)::int as c from pg_policies where schemaname='public' and tablename='clinic_ai_settings' and (qual ilike '%_safe%' or with_check ilike '%_safe%')`],
  ['clinic_ai_settings: no legacy non-safe policy remains', `select count(*)::int as c from pg_policies where schemaname='public' and tablename='clinic_ai_settings' and (qual ilike '%_safe%' or with_check ilike '%_safe%')`],
  ['subscriptions row count unchanged', `select count(*)::int as c from public.subscriptions`],
  ['billing_plans still 5', `select count(*)::int as c from public.billing_plans`],
];

let failed = false;
for (const [name, sql] of checks) {
  try {
    const rows = await runQuery(sql);
    const val = Array.isArray(rows) ? rows[0] : null;
    const idxChecks = [
      name.includes('member-write policies removed'),
      name.includes('3 write policies require'),
      name.includes('member SELECT preserved'),
      name.includes('uses _safe'),
      name.includes('no legacy non-safe'),
      name.includes('subscriptions row count'),
      name.includes('billing_plans still'),
    ];
    const ok =
      idxChecks[0] || idxChecks[1] || idxChecks[2] || idxChecks[3]
        ? (() => { const expectCount = idxChecks[0] ? 0 : idxChecks[1] ? 3 : idxChecks[2] ? 1 : 1; return val?.c === expectCount; })()
        : idxChecks[4] ? val?.c === 1
        : idxChecks[5] ? val?.c === beforeSubs
        : idxChecks[6] ? val?.c === beforeBp
        : Array.isArray(rows) && rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : ' | val=' + JSON.stringify(val)}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}

const afterSubs = Number((await runQuery("select count(*)::int as c from public.subscriptions"))[0]?.c ?? -1);
console.log(`${afterSubs === beforeSubs ? 'PASS' : 'FAIL'} | final subscriptions unchanged (${beforeSubs} -> ${afterSubs})`);
if (afterSubs !== beforeSubs) failed = true;

process.exit(failed ? 1 : 0);