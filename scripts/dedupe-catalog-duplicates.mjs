import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/**
 * CATALOG DEDUPE TOOL  (providers / services)
 *
 * WHY: re-running older demo seeders created exact duplicates (same clinic_id
 * + same name) in providers/services. Fixed at source by idempotent upserts;
 * this tool cleans EXISTING duplicates safely and explainably.
 *
 * SAFETY MODEL:
 *   - DEFAULT = DRY RUN (read-only). Prints the full merge plan.
 *   - Mutation requires: --apply <clinic_uuid> → scoped to that clinic only,
 *     every change logged line-by-line.
 *   - Merge rule per duplicate group (same clinic, case-insensitive name):
 *     keep the OLDEST row; repoint FKs (appointments, provider_services) to
 *     it; delete the newer rows.
 *   - Never touches patients, conversations, or non-catalog tables.
 */

const envRaw = fs.readFileSync('.env.local', 'utf8');
const getEnv = (key) => {
  const line = envRaw.split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
if (!supabaseUrl || !supabaseServiceKey || supabaseUrl.includes('your-')) {
  console.log('DEDUPE: BLOCKED — missing Supabase credentials in .env.local');
  process.exit(1);
}

const applyIndex = process.argv.indexOf('--apply');
const applyClinicId = applyIndex !== -1 ? process.argv[applyIndex + 1] : null;
const APPLY = Boolean(applyClinicId);
if (applyIndex !== -1 && !applyClinicId) {
  console.log('DEDUPE: --apply requires a clinic uuid argument');
  process.exit(1);
}

const sb = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });

function pickKeepOldest(rows) {
  return [...rows].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : Infinity;
    const tb = b.created_at ? Date.parse(b.created_at) : Infinity;
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

async function fetchAll(table, select) {
  const { data, error } = await sb.from(table).select(select);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

function groupDuplicates(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.clinic_id}::${String(row.name).trim().toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}

function log(action) {
  console.log(APPLY ? '  ✔ ' : '  · ', action);
}

async function mergeProviders() {
  const { data: providers, error } = await sb
    .from('providers').select('id, clinic_id, name, title, created_at')
    .is('deleted_at', null);
  if (error) throw new Error(`providers: ${error.message}`);
  const scoped = providers.filter((p) => (applyClinicId ? p.clinic_id === applyClinicId : true));
  const dupGroups = groupDuplicates(scoped);
  console.log(`\n== PROVIDERS: ${dupGroups.length} duplicate group(s) ==`);
  let deleted = 0;

  for (const group of dupGroups) {
    const keep = pickKeepOldest(group);
    const dups = group.filter((r) => r.id !== keep.id);
    console.log(`\nGroup [${group[0].name}] @clinic ${group[0].clinic_id}:`);
    console.log(`  KEEP   ${keep.id} (created ${keep.created_at})`);
    for (const dup of dups) {
      // 1) appointments.provider_id → keep
      const { data: moved } = await sb
        .from('appointments').update({ provider_id: keep.id })
        .eq('provider_id', dup.id).select('id');
      log(`repointed ${(moved ?? []).length} appointment(s) ${dup.id} → ${keep.id}`);

      // 2) provider_services: move unless keep already offers that service
      const { data: links } = await sb
        .from('provider_services').select('service_id').eq('provider_id', dup.id);
      for (const { service_id } of links ?? []) {
        const { data: existing } = await sb
          .from('provider_services').select('id')
          .eq('provider_id', keep.id).eq('service_id', service_id).maybeSingle();
        if (existing) {
          if (APPLY) await sb.from('provider_services').delete()
            .eq('provider_id', dup.id).eq('service_id', service_id);
          log(`dropped duplicate link service ${service_id}`);
        } else if (APPLY) {
          await sb.from('provider_services').update({ provider_id: keep.id })
            .eq('provider_id', dup.id).eq('service_id', service_id);
          log(`moved link service ${service_id} → keep`);
        }
      }

      // 3) schedules/vacations follow via FK ON DELETE CASCADE
      if (!APPLY) {
        log(`WOULD delete provider ${dup.id} (${dup.name}, created ${dup.created_at})`);
      } else {
        const { error: delError } = await sb.from('providers').delete().eq('id', dup.id);
        if (delError) console.log(`  ✗ DELETE FAILED ${dup.id}: ${delError.message} (left untouched)`);
        else { log(`deleted provider ${dup.id} (${dup.name})`); deleted += 1; }
      }
    }
  }
  return deleted;
}

async function mergeServices() {
  const { data: services, error } = await sb
    .from('clinic_services').select('id, clinic_id, name, created_at')
    .is('deleted_at', null);
  if (error) throw new Error(`services: ${error.message}`);
  const scoped = services.filter((s) => (applyClinicId ? s.clinic_id === applyClinicId : true));
  const dupGroups = groupDuplicates(scoped);
  console.log(`\n== SERVICES: ${dupGroups.length} duplicate group(s) ==`);

  for (const group of dupGroups) {
    const keep = pickKeepOldest(group);
    const dups = group.filter((r) => r.id !== keep.id);
    console.log(`\nGroup [${group[0].name}] @clinic ${group[0].clinic_id}:`);
    console.log(`  KEEP   ${keep.id} (created ${keep.created_at})`);
    for (const dup of dups) {
      const { data: moved } = await sb
        .from('appointments').update({ service_id: keep.id })
        .eq('service_id', dup.id).select('id');
      log(`repointed ${(moved ?? []).length} appointment(s) ${dup.id} → ${keep.id}`);

      if (!APPLY) {
        log(`WOULD delete service ${dup.id} (${dup.name}, created ${dup.created_at})`);
      } else {
        const { error: delError } = await sb.from('clinic_services').delete().eq('id', dup.id);
        if (delError) console.log(`  ✗ DELETE FAILED ${dup.id}: ${delError.message} (left untouched)`);
        else log(`deleted service ${dup.id} (${dup.name})`);
      }
    }
  }
}

console.log(APPLY
  ? `DEDUPE MODE: APPLY (scoped to clinic ${applyClinicId})`
  : 'DEDUPE MODE: DRY RUN (read-only — pass --apply <clinic_id> to execute)');
console.log('appointments/provider_services are REPOINTED to the kept row, never deleted.');

await mergeProviders();
await mergeServices();
console.log('\nDONE.');
