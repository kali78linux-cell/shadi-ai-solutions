/**
 * PHASE H — apply db/migrations/20260926_clinic_messaging.sql
 * (additive, idempotent, safe), then verify: table + constraint + RLS,
 * indexes, relationship trigger, and the get_clinic_conversations RPC.
 * Run: node scripts/apply-clinic-messaging.mjs
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

const FILE = 'db/migrations/20260926_clinic_messaging.sql';
if (!fs.existsSync(FILE)) { console.log('BLOCKED — migration file missing'); process.exit(1); }

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

console.log(`Applying ${FILE} ...`);
try {
  await runQuery(fs.readFileSync(FILE, 'utf8'));
  console.log('APPLY: OK');
} catch (e) {
  console.log('APPLY FAILED:', e.message);
  process.exit(1);
}

const checks = [
  ['clinic_messages table', "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='clinic_messages'"],
  ['self-message CHECK constraint', "SELECT 1 FROM pg_constraint WHERE conname='clinic_messages_clinic_ids_differ' AND conrelid='clinic_messages'::regclass"],
  ['RLS enabled on clinic_messages', "SELECT 1 FROM pg_class WHERE relname='clinic_messages' AND relrowsecurity = true"],
  ['relationship enforcement trigger', "SELECT 1 FROM pg_trigger WHERE tgname='tr_clinic_messages_enforce_relationship' AND NOT tgisinternal"],
  ['thread index', "SELECT 1 FROM pg_indexes WHERE indexname='idx_clinic_messages_thread'"],
  ['unread index', "SELECT 1 FROM pg_indexes WHERE indexname='idx_clinic_messages_unread'"],
  ['get_clinic_conversations RPC', "SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.proname='get_clinic_conversations' AND n.nspname='public'"],
];

let failed = false;
for (const [name, sql] of checks) {
  try {
    const rows = await runQuery(sql);
    const ok = Array.isArray(rows) && rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
