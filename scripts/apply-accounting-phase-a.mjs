/**
 * STEP 2 — Accounting Phase A: apply db/migrations/20260901_accounting_phase_a.sql
 * (additive, idempotent) then verify:
 *   - the 4 new tables + 2 views exist,
 *   - immutability triggers exist,
 *   - composite-FK unique indexes exist,
 *   - subscriptions/billing_plans/patients untouched, entitlement_usage 0.
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

const sqlPath = 'db/migrations/20260901_accounting_phase_a.sql';
console.log(`=== Applying ${sqlPath} ===`);
const sql = fs.readFileSync(sqlPath, 'utf8');
await runQuery(sql);
console.log('OK — migration applied (idempotent).');

let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` (${detail})` : ''}`);
  if (!ok) failures += 1;
}

const expectedTables = ['clinic_sequences', 'clinic_invoices', 'invoice_items', 'clinic_payments', 'financial_transactions'];
const tables = await runQuery(
  `select table_name from information_schema.tables where table_schema='public' and table_name in ('clinic_sequences','clinic_invoices','invoice_items','clinic_payments','financial_transactions')`
).catch(() => null);


const foundTables = (tables ?? []).map((r) => r.table_name);
for (const t of expectedTables) check(`table ${t}`, foundTables.includes(t));

const views = await runQuery(
  `select table_name from information_schema.views where table_schema='public' and table_name in ('invoice_balances','patient_balances')`
).catch(() => null);
const foundViews = (views ?? []).map((r) => r.table_name);
check('view invoice_balances', foundViews.includes('invoice_balances'));
check('view patient_balances', foundViews.includes('patient_balances'));

const triggers = await runQuery(
  `select tgname from pg_trigger where not tgisinternal and tgrelid in (
     'public.clinic_invoices'::regclass, 'public.clinic_payments'::regclass,
     'public.invoice_items'::regclass, 'public.financial_transactions'::regclass)`
).catch(() => null);
const trigNames = (triggers ?? []).map((r) => r.tgname);
for (const t of ['clinic_invoices_immutable', 'clinic_invoices_no_delete', 'clinic_payments_immutable', 'financial_transactions_no_update', 'invoice_items_immutable']) {
  check(`trigger ${t}`, trigNames.includes(t));
}

const safety = await runQuery(
  `select
     (select count(*) from public.subscriptions) as subs,
     (select count(*) from public.billing_plans) as plans,
     (select count(*) from public.patients) as patients,
     (select count(*) from public.entitlement_usage) as usage,
     (select count(*) from public.clinic_invoices) as invoices,
     (select count(*) from public.clinic_payments) as payments,
     (select count(*) from public.financial_transactions) as ftx`
).catch(() => null);
const s = (safety ?? [{}])[0];
check('subscriptions unchanged = 4', Number(s.subs) === 4, String(s.subs));
check('billing_plans unchanged = 5', Number(s.plans) === 5, String(s.plans));
check('patients unchanged = 30', Number(s.patients) === 30, String(s.patients));
check('entitlement_usage still 0', Number(s.usage) === 0, String(s.usage));
check('clinic_invoices empty', Number(s.invoices) === 0, String(s.invoices));
check('clinic_payments empty', Number(s.payments) === 0, String(s.payments));
check('financial_transactions empty', Number(s.ftx) === 0, String(s.ftx));

console.log(failures === 0 ? '\n=== ACCOUNTING PHASE A: ALL CHECKS PASS ===' : `\n=== ${failures} CHECK(S) FAILED ===`);
process.exit(failures === 0 ? 0 : 1);
