/**
 * cleanup-e2e-data.mjs — removes E2E/test probe patients and ALL their
 * dependent rows (FK-safe order). Targets:
 *   - full_name LIKE 'E2E PROBE%' / 'E2E imaging%'
 *   - phone_number = '+970599111222'
 * If a hard delete hits an FK wall, the patient is soft-deleted (deleted_at)
 * so it disappears from every list while keeping referential integrity.
 * Usage: node scripts/cleanup-e2e-data.mjs [--dry]
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const dry = process.argv.includes('--dry');

function loadEnv() {
  try {
    const raw = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* .env.local optional */ }
}
loadEnv();

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(URL_, KEY, { auth: { persistSession: false } });

async function count(table, col, val) {
  const { count } = await sb.from(table).select('id', { count: 'exact', head: true }).eq(col, val);
  return count ?? 0;
}

async function del(table, col, val) {
  if (dry) { const c = await count(table, col, val); console.log(`  [dry] ${table}.${col}=${String(val).slice(0, 8)}… → ${c}`); return c; }
  const { error, count: n } = await sb.from(table).delete().eq(col, val).select('id', { count: 'exact' });
  if (error) { console.log(`  ! ${table}: ${error.message}`); return -1; }
  return n ?? 0;
}

async function purgePatient(pid) {
  const steps = [
    ['notification_queue', 'patient_id'],
    ['notifications', 'patient_id'],
    ['recall_assignments', 'patient_id'],
    ['medical_files', 'patient_id'],
    ['imaging_results', 'patient_id'],
    ['imaging_requests', 'patient_id'],
    ['clinic_payments', 'patient_id'],
    ['invoice_items', 'patient_id'],
    ['clinic_invoices', 'patient_id'],
    ['financial_transactions', 'patient_id'],
    ['appointments', 'patient_id'],
  ];
  for (const [t, c] of steps) await del(t, c, pid);
  // conversations/messages (messages have no patient_id — go via conversations)
  const { data: convs } = await sb.from('conversations').select('id').eq('patient_id', pid);
  for (const conv of convs ?? []) {
    await del('messages', 'conversation_id', conv.id);
    await del('conversations', 'id', conv.id);
  }
  await del('audit_logs', 'patient_id', pid);
  return del('patients', 'id', pid);
}

const { data: targets, error } = await sb
  .from('patients')
  .select('id, clinic_id, full_name, phone_number')
  .or('full_name.ilike.E2E PROBE%,full_name.ilike.E2E imaging%,phone_number.eq.+970599111222');
if (error) { console.error('query error:', error.message); process.exit(1); }

console.log(`Found ${targets?.length ?? 0} E2E/test patients:`);
for (const p of targets ?? []) console.log(` - ${p.full_name} (${p.phone_number}) id=${p.id}`);

let ok = 0, soft = 0, failed = 0;
for (const p of targets ?? []) {
  if (dry) { await purgePatient(p.id); continue; }
  const res = await purgePatient(p.id);
  if (res >= 0) { ok++; continue; }
  // Hard delete blocked → soft delete fallback
  const { error: softErr } = await sb.from('patients').update({ deleted_at: new Date().toISOString() }).eq('id', p.id);
  if (softErr) { failed++; console.log(`  !! soft-delete failed for ${p.id}: ${softErr.message}`); }
  else { soft++; console.log(`  → soft-deleted ${p.id}`); }
}

if (!dry) {
  const { count: remaining } = await sb
    .from('patients')
    .select('id', { count: 'exact', head: true })
    .or('full_name.ilike.E2E PROBE%,full_name.ilike.E2E imaging%,phone_number.eq.+970599111222')
    .is('deleted_at', null);
  console.log(`\nDONE — hard:${ok} soft:${soft} failed:${failed} remaining_visible:${remaining ?? '?'}`);
}
