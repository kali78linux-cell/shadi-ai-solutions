import fs from 'fs';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// 1. Config loader (reads .env.local, same convention as scripts/demo-seed.mjs)
// ---------------------------------------------------------------------------
const envRaw = fs.readFileSync('.env.local', 'utf8');
const getEnv = (key) => {
  const line = envRaw.split('\n').find((l) => l.startsWith(`${key}=`));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseServiceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || supabaseUrl.includes('your-') || supabaseUrl.includes('placeholder')) {
  console.log('DEMO RESET: BLOCKED — real NEXT_PUBLIC_SUPABASE_URL missing');
  process.exit(1);
}
if (!supabaseServiceKey || supabaseServiceKey.includes('your-') || supabaseServiceKey.includes('placeholder')) {
  console.log('DEMO RESET: BLOCKED — SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

console.log(`Project ref: ${supabaseUrl.replace('https://', '').split('.')[0]}`);

// ---------------------------------------------------------------------------
// 2. Service-role client (bypasses RLS), same as lib/supabase/admin.ts
// ---------------------------------------------------------------------------
const sb = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

// ---------------------------------------------------------------------------
// 3. Deterministic demo identifiers (same as demo-seed.mjs)
// ---------------------------------------------------------------------------
function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function demoUuid(seedKey) {
  const hex = sha256Hex(`demo-seed:${seedKey}`).slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20,32)}`;
}

const CLINIC_KEYS = [
  'demo-dental-clinic',
  'smile-care-dental-center',
  'bright-teeth-clinic',
  'noura-dental-imaging',
];

function clinicId(key) { return demoUuid(key); }

// ---------------------------------------------------------------------------
// 4. Reset demo tenant (soft-delete only — never hard-delete real data)
// ---------------------------------------------------------------------------
async function softDelete(table, clinicId) {
  // The clinics table uses `id` as its primary key, not `clinic_id`
  const idColumn = table === 'clinics' ? 'id' : 'clinic_id';

  // First try soft-delete (tables that have deleted_at)
  const { error: softError } = await sb
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq(idColumn, clinicId)
    .is('deleted_at', null);

  if (softError) {
    // If deleted_at column doesn't exist, fall back to hard-delete scoped to demo clinic
    if (softError.message && softError.message.includes('deleted_at')) {
      const { error: hardError } = await sb.from(table).delete().eq(idColumn, clinicId);
      if (hardError) throw new Error(`Failed to delete ${table}: ${hardError.message}`);
      return;
    }
    // Only treat "no rows" as success; real errors must be surfaced
    if (!softError.message.includes('rows') && !softError.message.includes('No rows')) {
      throw new Error(`Failed to soft-delete ${table}: ${softError.message}`);
    }
  }
}

async function main() {
  console.log('Demo reset started (4 clinics)...');

  const TABLES = [
    'notification_queue', 'messages', 'conversations', 'appointments', 'leads',
    'patients', 'provider_services', 'provider_schedules', 'provider_vacations',
    'clinic_holidays', 'clinic_ai_knowledge', 'clinic_knowledge_documents',
    'clinic_ai_settings', 'clinic_communication_settings',
    'providers', 'clinic_services', 'clinic_users', 'clinics',
  ];

  for (const clinicKey of CLINIC_KEYS) {
    const cid = clinicId(clinicKey);
    console.log(`\nResetting: ${clinicKey} (${cid})`);

    // Soft-delete demo rows in dependency order
    for (const table of TABLES) {
      await softDelete(table, cid);
    }
    console.log('  Clinic reset.');
  }

  console.log('\nDemo reset complete.');
  console.log('Run `npm run demo:seed` to re-seed the demo environment.');
}

main().catch((err) => {
  console.error(`DEMO RESET FAILED: ${err.message}`);
  process.exit(1);
});