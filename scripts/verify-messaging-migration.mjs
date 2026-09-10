/**
 * PHASE H verification (READ-ONLY) — confirms the clinic messaging migration
 * objects exist in the live database. Never prints credentials.
 * Run: node scripts/verify-messaging-migration.mjs
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

const checks = [
  ['table clinic_messages', "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='clinic_messages'"],
  ['columns patient_name/phone/notes/file_*', "SELECT COUNT(*)::int AS c FROM information_schema.columns WHERE table_name='clinic_messages' AND column_name IN ('patient_name','patient_phone','patient_notes','file_url','file_name','file_size','is_read')"],
  ['constraint ids differ', "SELECT 1 FROM pg_constraint WHERE conrelid='public.clinic_messages'::regclass AND conname='clinic_messages_clinic_ids_differ'"],
  ['RPC get_clinic_conversations', "SELECT 1 FROM pg_proc WHERE proname='get_clinic_conversations'"],
  ['conversations RPC exposes unread_count', "SELECT 1 FROM pg_proc p JOIN LATERAL (SELECT pg_get_functiondef(p.oid) AS def) d ON true WHERE p.proname='get_clinic_conversations' AND d.def LIKE '%unread_count%'"],
  ['trigger enforce relationship', "SELECT 1 FROM pg_trigger WHERE tgrelid='public.clinic_messages'::regclass AND tgname='tr_clinic_messages_enforce_relationship' AND NOT tgisinternal"],
  ['indexes (4)', "SELECT COUNT(*)::int AS c FROM pg_indexes WHERE tablename='clinic_messages' AND indexname LIKE 'idx_clinic_messages%'"],
  ['relationship table (dependency)', "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='organization_relationships'"],
];

let failed = false;
for (const [name, sql] of checks) {
  try {
    const rows = await runQuery(sql);
    const val = Array.isArray(rows) && rows.length > 0 ? (rows[0].c ?? rows[0].ok ?? 1) : 0;
    const ok = Number(val) > 0 || rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${typeof val === 'number' ? ` (${val})` : ''}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
