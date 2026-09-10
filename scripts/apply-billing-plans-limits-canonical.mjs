/**
 * STEP 15G-FIX — apply db/migrations/20260836_billing_plans_limits_canonical.sql
 * (additive, idempotent) then verify:
 *   - each plan resolves to the approved canonical limits matrix,
 *   - legacy limits were preserved into metadata.legacy_limits,
 *   - the DB CHECK guard exists,
 *   - subscriptions untouched, billing_plans still 5 rows,
 *   - entitlement_usage still 0 rows (no new production writes).
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

const EXPECTED = {
  free_trial: { ai_messages: 5, bookings: 50, patients: 5, providers: 2, users: 2, knowledge_docs: 5, conversations: null },
  starter: { ai_messages: 100, bookings: 50, patients: null, providers: 2, users: 2, knowledge_docs: 3, conversations: null },
  growth: { ai_messages: null, bookings: null, patients: null, providers: null, users: 10, knowledge_docs: null, conversations: null },
  founding: { ai_messages: null, bookings: null, patients: null, providers: null, users: 10, knowledge_docs: null, conversations: null },
  pro: { ai_messages: null, bookings: null, patients: null, providers: null, users: null, knowledge_docs: null, conversations: null },
};

const file = 'db/migrations/20260836_billing_plans_limits_canonical.sql';
console.log(`Applying ${file} ...`);
await runQuery(fs.readFileSync(file, 'utf8'));
console.log('APPLY: OK');

let failed = false;
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${ok ? '' : extra ? ' | ' + extra : ''}`);
  if (!ok) failed = true;
};

// 1) every plan == the approved matrix
for (const [planId, expected] of Object.entries(EXPECTED)) {
  const rows = await runQuery(`select limits from public.billing_plans where plan_id='${planId}'`);
  const actual = Array.isArray(rows) && rows[0] ? rows[0].limits : null;
  const keys = Object.keys(expected);
  const ok = actual !== null && keys.every((k) => actual[k] === expected[k]) && Object.keys(actual).sort().join(',') === keys.sort().join(',');
  check(`limits canonical ${planId}`, ok, `actual=${JSON.stringify(actual)}`);
}

// 2) legacy preserved into metadata.legacy_limits
const legacyRows = await runQuery(`select plan_id, metadata->'legacy_limits' as legacy from public.billing_plans where plan_id in ('free_trial','starter','founding','growth','pro')`);
const legacy = Array.isArray(legacyRows) ? legacyRows : [];
const freeTrialLegacy = legacy.find((r) => r.plan_id === 'free_trial');
const growthLegacy = legacy.find((r) => r.plan_id === 'growth');
check('legacy limits preserved (free_trial has legacy max_patients/ai_messages_per_day)', Boolean(freeTrialLegacy?.legacy?.max_patients) && Boolean(freeTrialLegacy?.legacy?.ai_messages_per_day));
check('legacy limits preserved (growth has legacy max_team)', Boolean(growthLegacy?.legacy?.max_team));

// 3) DB CHECK guard exists
const guard = await runQuery(`select 1 from pg_constraint where conname='billing_plans_limits_only_canonical_keys'`);
check('DB guard constraint exists', Array.isArray(guard) && guard.length > 0);

// 4) data safety: subscriptions unchanged, billing_plans still 5, entitlement_usage 0
const before = await runQuery('select (select count(*)::int from public.subscriptions) subs,(select count(*)::int from public.billing_plans) plans,(select count(*)::int from public.entitlement_usage) ent');
const b = Array.isArray(before) && before[0] ? before[0] : {};
check('subscriptions untouched (4)', Number(b.subs) === 4, `subs=${b.subs}`);
check('billing_plans still 5 rows', Number(b.plans) === 5, `plans=${b.plans}`);
check('entitlement_usage still 0 rows', Number(b.ent) === 0, `ent=${b.ent}`);

process.exit(failed ? 1 : 0);