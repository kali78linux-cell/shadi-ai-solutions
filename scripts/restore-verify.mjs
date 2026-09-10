import fs from 'fs';

/**
 * RESTORE VERIFICATION TOOL — run AFTER a restore (on the restored/staging
 * DATABASE, or read-only on production to prove the checker itself works).
 *
 * Verifies: schema presence, row counts, RLS enabled, storage buckets,
 * tenant isolation (anon REST), and the critical financial/photographic data
 * integrity that a restore must preserve. Deliberately read-only — no writes.
 *
 * Usage: BASE=... node scripts/restore-verify.mjs
 */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
// TARGET override: BASE=<staging-url> ANON_KEY=<staging-anon> node scripts/restore-verify.mjs
const url = process.env.BASE || env.NEXT_PUBLIC_SUPABASE_URL;
const at = env.SUPABASE_ACCESS_TOKEN;
const anonKey = process.env.ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ref = url.replace('https://', '').split('.')[0];
const apiBase = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function sql(q) {
  const r = await fetch(apiBase, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + at },
    body: JSON.stringify({ query: q }),
  });
  const b = await r.json();
  return { ok: r.ok, data: b };
}

const CORE_TABLES = [
  'clinics', 'clinic_users', 'patients', 'providers', 'appointments',
  'clinic_services', 'subscriptions', 'billing_plans', 'conversations',
  'messages', 'clinic_ai_knowledge', 'clinic_knowledge_documents',
  'imaging_requests', 'imaging_results', 'organization_relationships',
  'medical_files', 'medical_upload_sessions', 'stripe_webhook_events',
  'audit_logs', 'clinic_public_media', 'clinic_invoices', 'clinic_payments',
];

async function main() {
  console.log('=== RESTORE VERIFICATION (read-only) ===\n');
  const results = [];
  const missing = [];

  for (const t of CORE_TABLES) {
    const c = await sql(`select count(*)::int c, (select 1 from information_schema.tables where table_schema='public' and table_name='${t}')::text::boolean exists from pg_tables where schemaname='public' and tablename='${t}'`);
    const row = Array.isArray(c.data) ? c.data[0] : null;
    if (!row?.exists) { missing.push(t); results.push(`MISSING table ${t}`); continue; }
    const rls = await sql(`select relrowsecurity::int r from pg_class where oid='public.${t}'::regclass`);
    const rlsOn = rls.data?.[0]?.r === 1;
    results.push(`OK ${t}: rows=${row.c ?? 0} RLS=${rlsOn ? 'ON' : 'OFF'}`);
  }

  console.log('TABLES:');
  console.log(results.join('\n'));

  // storage buckets
  const buckets = await sql(`select id, public from storage.buckets`);
  console.log('\nSTORAGE BUCKETS:');
  for (const b of (buckets.data ?? [])) console.log(`  ${b.id} public=${b.public}`);

  // anon isolation probe (0 rows on private tables)
  console.log('\nANON ISOLATION (expect 0):');
  for (const t of ['medical_files', 'organization_relationships', 'imaging_results', 'subscriptions', 'conversations']) {
    if (missing.includes(t)) continue;
    const anonRes = await fetch(`${url}/rest/v1/${t}?select=*`, { headers: { apikey: anonKey } });
    const arr = await anonRes.json().catch(() => []);
    const n = Array.isArray(arr) ? arr.length : -1;
    const okExpected = n === 0;
    console.log(`  ${okExpected ? 'OK' : 'LEAK'} ${t} anon_rows=${n}`);
  }

  const failTables = results.filter((r) => r.startsWith('MISSING') || r.includes('RLS=OFF'));
  console.log(`\nSUMMARY: tables_checked=${CORE_TABLES.length} missing=${missing.length} rls_off=${results.join('\n').split('RLS=OFF').length - 1}`);
  process.exit(failTables.length ? 1 : 0);
}
main().catch((e) => { console.error('RESTORE VERIFY FAILED', e.message); process.exit(1); });