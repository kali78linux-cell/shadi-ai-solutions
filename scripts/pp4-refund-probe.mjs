/**
 * PP-4 — apply 20260911_portal_refunds.sql (idempotent, additive) + targeted
 * live DB/RLS verification via a self-rollback DO block.
 *
 * Evidence contract (matches the historical project pattern):
 *   - migration objects present (table / FKs / indexes / RLS enabled / no policies)
 *   - authenticated role sees 0 rows and CANNOT insert (deny-all)
 *   - provider_refund_id unique, (clinic_id, idempotency_key) partial unique
 *   - cross-tenant composite FK blocked at the DB level
 *   - status CHECK values enforced
 *   - the EXISTING refund_payment RPC path books reversals + enforces the cap
 *
 * Never prints credentials. Sandbox/service-role only — no production writes.
 */
import fs from 'fs';

const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};
const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || get('SUPABASE_ACCESS_TOKEN');
if (!url || !accessToken) { console.log('BLOCKED — missing URL/token'); process.exit(1); }

const ref = url.replace('https://', '').split('.')[0];
const apiBase = `https://api.supabase.com/v1/projects/${ref}/database/query`;
async function runQuery(sql) {
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body;
}
const safe = (e) => (e instanceof Error ? e.message : String(e));

// ---------------------------------------------------------------------------
// 1) Apply migration (idempotent / additive — safe to re-run)
// ---------------------------------------------------------------------------
const MIGRATION = process.argv[2] || 'db/migrations/20260911_portal_refunds.sql';
console.log(`Applying ${MIGRATION} ...`);
try {
  await runQuery(fs.readFileSync(MIGRATION, 'utf8'));
  console.log('APPLY: OK (idempotent)');
} catch (e) {
  console.log('APPLY FAILED:', safe(e));
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2) Object/constraint verification
// ---------------------------------------------------------------------------
const objectChecks = [
  ['table exists', "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='clinic_payment_refunds'"],
  ['RLS enabled', "SELECT 1 FROM pg_class WHERE relname='clinic_payment_refunds' AND relrowsecurity"],
  ['zero policies', "SELECT count(*) FROM pg_policies WHERE schemaname='public' AND tablename='clinic_payment_refunds'"],
  ['composite patient FK', "SELECT 1 FROM pg_constraint WHERE conname='fk_cpr_patient'"],
  ['composite invoice FK', "SELECT 1 FROM pg_constraint WHERE conname='fk_cpr_invoice'"],
  ['composite payment FK', "SELECT 1 FROM pg_constraint WHERE conname='fk_cpr_payment'"],
  ['provider_refund_id unique', "SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_payment_refunds'::regclass AND pg_get_constraintdef(oid) LIKE '%provider_refund_id%' AND contype='u'"],
  ['(clinic_id, idempotency_key) partial unique', "SELECT 1 FROM pg_indexes WHERE tablename='clinic_payment_refunds' AND indexname='uq_cpr_idempotency_key'"],
  ['status CHECK', "SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_payment_refunds'::regclass AND pg_get_constraintdef(oid) LIKE '%pending%needs_review%'"],
  ['currency CHECK', "SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_payment_refunds'::regclass AND pg_get_constraintdef(oid) LIKE '%^[a-z]{3}$%'"],
];
let failed = 0;
for (const [name, sql] of objectChecks) {
  try {
    const rows = await runQuery(sql);
    const ok = (() => {
      if (name === 'zero policies') return Number(rows?.[0]?.count ?? 1) === 0;
      return Array.isArray(rows) && rows.length > 0;
    })();
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}`);
    if (!ok) failed += 1;
  } catch (e) {
    console.log(`FAIL | ${name} | ${safe(e)}`);
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// 3) RLS deny-all (authenticated role — own session)
// ---------------------------------------------------------------------------
try {
  const rows = await runQuery("SET ROLE authenticated; SELECT count(*) FROM public.clinic_payment_refunds; RESET ROLE;");
  const n = Number(rows?.[0]?.count ?? -1);
  console.log(`${n === 0 ? 'PASS' : 'FAIL'} | authenticated SELECT → 0 rows (deny-all); got ${n}`);
  if (n !== 0) failed += 1;
} catch (e) {
  console.log(`FAIL | authenticated SELECT → 0 rows | ${safe(e)}`);
  failed += 1;
}
try {
  await runQuery(
    "SET ROLE authenticated; INSERT INTO public.clinic_payment_refunds (clinic_id, patient_id, invoice_id, clinic_payment_id, provider_refund_id, amount, currency) VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 're_deny_probe', 1, 'jod'); RESET ROLE;"
  );
  console.log('FAIL | authenticated INSERT should be blocked');
  failed += 1;
} catch (e) {
  const msg = safe(e);
  console.log(`${/permission denied|row-level security policy/i.test(msg) ? 'PASS' : 'FAIL'} | authenticated INSERT blocked (${msg.slice(0, 110)})`);
  if (!/permission denied|row-level security policy/i.test(msg)) failed += 1;
}

// ---------------------------------------------------------------------------
// 4) Self-rollback DO-block probe (financial round-trip + DB invariants)
// ---------------------------------------------------------------------------
const PROBE_SQL = `
do $pp4$
declare
  v_suffix        text := replace(gen_random_uuid()::text, '-', '');
  v_clinic_a      uuid := gen_random_uuid();
  v_clinic_b      uuid := gen_random_uuid();
  v_patient_a     uuid := gen_random_uuid();
  v_invoice_a     uuid;
  v_payment_a     uuid;
  v_refund_id     uuid;
  v_provider_re_1 text := 're_pp4_' || v_suffix || '_1';
  v_provider_re_2 text := 're_pp4_' || v_suffix || '_2';
  v_key_1         uuid := gen_random_uuid();
begin
  -- two tenants + patients
  insert into public.clinics (id, name, slug)
    values (v_clinic_a, 'PP4 Probe A', 'pp4-probe-a-' || v_suffix),
           (v_clinic_b, 'PP4 Probe B', 'pp4-probe-b-' || v_suffix);
  insert into public.patients (id, clinic_id, full_name, email)
    values (v_patient_a, v_clinic_a, 'PP4 Probe Patient', 'pp4-' || v_suffix || '@probe.local');

  -- invoice + payment through the EXISTING accounting RPCs (Phase A/B).
  -- The Phase A/B overloads share the same base signature (documented
  -- ambiguity) — passing the FULL Phase B arg list (incl. typed defaults)
  -- resolves uniquely to the Phase B function.
  select (public.issue_invoice(
    p_clinic_id => v_clinic_a, p_patient_id => v_patient_a, p_appointment_id => null::uuid,
    p_items => '[{"description":"PP4 probe","quantity":1,"unit_price":100,"amount":100}]'::jsonb,
    p_discount => 0::numeric, p_tax => 0::numeric, p_notes => 'pp4'::text,
    p_due_at => null::timestamptz, p_created_by => null::uuid,
    p_payer_type => null::text, p_payer_ref => null::uuid))->>'invoice_id'::text
    into v_invoice_a;
  if v_invoice_a is null then raise exception 'INVOICE-OK=NO'; end if;

  select (public.record_payment(
    p_clinic_id => v_clinic_a, p_invoice_id => v_invoice_a, p_amount => 100::numeric,
    p_method => 'card'::text, p_reference => ('pi_pp4_' || v_suffix)::text,
    p_idempotency_key => null::uuid, p_recorded_by => null::uuid,
    p_payer_type => null::text, p_payer_ref => null::uuid))->>'payment_id'::text
    into v_payment_a;
  if v_payment_a is null then raise exception 'PAYMENT-OK=NO'; end if;

  -- lifecycle row + distinct partial unique key
  insert into public.clinic_payment_refunds
    (id, clinic_id, patient_id, invoice_id, clinic_payment_id, provider_refund_id,
     amount, currency, status, reason, idempotency_key)
  values
    (gen_random_uuid(), v_clinic_a, v_patient_a, v_invoice_a, v_payment_a, v_provider_re_1,
     20, 'jod', 'pending', 'probe row', v_key_1);

  -- same provider_refund_id → unique violation (idempotency level-2 anchor)
  begin
    insert into public.clinic_payment_refunds
      (clinic_id, patient_id, invoice_id, clinic_payment_id, provider_refund_id, amount, currency)
    values (v_clinic_a, v_patient_a, v_invoice_a, v_payment_a, v_provider_re_1, 5, 'jod');
    raise exception 'unexpected_success';
  exception when others then
    if sqlerrm like '%clinic_payment_refunds_provider_refund_id_key%' then
      raise notice 'PK-UNIQUE-OK';
    else
      raise exception 'PK-UNIQUE-FAILED: %', sqlerrm;
    end if;
  end;

  -- same (clinic_id, idempotency_key) → partial unique violation (level-1 anchor)
  begin
    insert into public.clinic_payment_refunds
      (clinic_id, patient_id, invoice_id, clinic_payment_id, provider_refund_id, amount, currency, idempotency_key)
    values (v_clinic_a, v_patient_a, v_invoice_a, v_payment_a, v_provider_re_2, 5, 'jod', v_key_1);
    raise exception 'unexpected_success';
  exception when others then
    if sqlerrm like '%uq_cpr_idempotency_key%' then
      raise notice 'KEY-UNIQUE-OK';
    else
      raise exception 'KEY-UNIQUE-FAILED: %', sqlerrm;
    end if;
  end;

  -- status CHECK values
  begin
    insert into public.clinic_payment_refunds
      (clinic_id, patient_id, invoice_id, clinic_payment_id, provider_refund_id, amount, currency, status)
    values (v_clinic_a, v_patient_a, v_invoice_a, v_payment_a, 're_pp4_bad_' || v_suffix, 5, 'jod', 'wat');
    raise exception 'unexpected_success';
  exception when others then
    if sqlerrm like '%check%' then
      raise notice 'STATUS-CHECK-OK';
    else
      raise exception 'STATUS-CHECK-FAILED: %', sqlerrm;
    end if;
  end;

  -- PP4-CROSS-TENANT-ANCHOR
  -- cross-tenant: refund in clinic A referencing a payment of clinic B → FK
  declare
    v_patient_b uuid := gen_random_uuid();
    v_invoice_b uuid;
    v_payment_b uuid;
  begin
    insert into public.patients (id, clinic_id, full_name, email)
      values (v_patient_b, v_clinic_b, 'PP4 Probe Patient B', 'pp4b-' || v_suffix || '@probe.local');
    select (public.issue_invoice(
      p_clinic_id => v_clinic_b, p_patient_id => v_patient_b, p_appointment_id => null::uuid,
      p_items => '[{"description":"PP4 probe B","quantity":1,"unit_price":50,"amount":50}]'::jsonb,
      p_discount => 0::numeric, p_tax => 0::numeric, p_notes => 'pp4b'::text,
      p_due_at => null::timestamptz, p_created_by => null::uuid,
      p_payer_type => null::text, p_payer_ref => null::uuid))->>'invoice_id'::text
      into v_invoice_b;
    select (public.record_payment(
      p_clinic_id => v_clinic_b, p_invoice_id => v_invoice_b, p_amount => 50::numeric,
      p_method => 'card'::text, p_reference => ('pi_pp4b_' || v_suffix)::text,
      p_idempotency_key => null::uuid, p_recorded_by => null::uuid,
      p_payer_type => null::text, p_payer_ref => null::uuid))->>'payment_id'::text
      into v_payment_b;
    begin
      insert into public.clinic_payment_refunds
        (clinic_id, patient_id, invoice_id, clinic_payment_id, provider_refund_id, amount, currency)
      values (v_clinic_a, v_patient_a, v_invoice_a, v_payment_b, 're_pp4_x_' || v_suffix, 5, 'jod');
      raise exception 'unexpected_success';
    exception when others then
      if sqlerrm like '%fk_cpr_payment%' then
        raise notice 'CROSS-TENANT-BLOCKED';
      else
        raise exception 'CROSS-TENANT-FAILED: %', sqlerrm;
      end if;
    end;
  end;

  -- accounting reversal through the EXISTING refund_payment RPC (PP-4 path)
  select public.refund_payment(v_clinic_a, v_payment_a, 20, 'PP4 probe refund', null)
    into v_refund_id;
  if v_refund_id is null then raise exception 'BOOK-OK=NO'; end if;
  raise notice 'BOOK-OK';

  -- over-refund cap (net paid 100 − refunded 20 → remaining 80; ask 200)
  begin
    perform public.refund_payment(v_clinic_a, v_payment_a, 200, 'PP4 over probe', null);
    raise exception 'unexpected_success';
  exception when others then
    if sqlerrm like '%REFUND_EXCEEDS_PAID%' then
      raise notice 'REFUND-CAP-OK';
    else
      raise exception 'REFUND-CAP-FAILED: %', sqlerrm;
    end if;
  end;

  raise exception 'PP4_PROBE_ROLLBACK [INVOICE-OK, PAYMENT-OK, ROW-OK, PK-UNIQUE-OK, KEY-UNIQUE-OK, STATUS-CHECK-OK, CROSS-TENANT-BLOCKED, BOOK-OK, REFUND-CAP-OK]';
end;
$pp4$;`;

console.log('\nRunning self-rollback probe ...');
try {
  await runQuery(PROBE_SQL);
  console.log('PROBE UNEXPECTEDLY SUCCEEDED (should have rolled back)');
  failed += 1;
} catch (e) {
  const msg = safe(e);
  if (/PP4_PROBE_ROLLBACK \[/.test(msg)) {
    console.log('PROBE: PASS');
    const marker = msg.slice(msg.indexOf('PP4_PROBE_ROLLBACK'), msg.indexOf('PP4_PROBE_ROLLBACK') + 150).replace(/\n/g, ' ');
    console.log(`LIVE: ${marker}`);
  } else {
    console.log('PROBE FAILED:', msg.slice(0, 500));
    failed += 1;
  }
}

// ---------------------------------------------------------------------------
// 5) Cleanup verification — zero residual probe rows
// ---------------------------------------------------------------------------
try {
  const [refunds, clinics, patients] = await Promise.all([
    runQuery("SELECT count(*) AS n FROM public.clinic_payment_refunds"),
    runQuery("SELECT count(*) AS n FROM public.clinics WHERE slug LIKE 'pp4-probe-%'"),
    runQuery("SELECT count(*) AS n FROM public.patients WHERE email LIKE '%@probe.local'"),
  ]);
  const nR = Number(refunds?.[0]?.n ?? -1);
  const nC = Number(clinics?.[0]?.n ?? -1);
  const nP = Number(patients?.[0]?.n ?? -1);
  if (nR === 0 && nC === 0 && nP === 0) console.log('CLEANUP: PASS (refunds=0 clinics=0 patients=0)');
  else { console.log(`CLEANUP FAIL: refunds=${nR} clinics=${nC} patients=${nP}`); failed += 1; }
} catch (e) {
  console.log(`CLEANUP FAIL: ${safe(e)}`);
  failed += 1;
}

console.log(failed === 0 ? '\n=== PP-4 REFUND PROBE: ALL CHECKS PASS ===' : `\n=== ${failed} CHECK(S) FAILED ===`);
process.exit(failed === 0 ? 0 : 1);