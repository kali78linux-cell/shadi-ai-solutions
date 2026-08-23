import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envRaw = fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8');
function getEnv(key) {
  const line = envRaw.split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

const url = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!url || !serviceKey) {
  console.error('BLOCKED: Supabase env vars missing');
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

async function main() {
  console.log('=== FOUNDING SLOTS DEBUG CHECK ===\n');

  // 1. GET the endpoint
  console.log('--- 1. GET /api/landing/founding-slots ---');
  let endpointResult = null;
  try {
    const res = await fetch('http://localhost:3100/api/landing/founding-slots', { cache: 'no-store' });
    endpointResult = await res.json();
    console.log(`HTTP ${res.status}:`, JSON.stringify(endpointResult));
  } catch (err) {
    console.error('Endpoint fetch failed:', err.message);
  }

  // 2. Direct DB count
  console.log('\n--- 2. Direct DB COUNT (is_founding_member=true, deleted_at IS NULL) ---');
  const { count, error } = await admin
    .from('clinics')
    .select('id', { count: 'exact', head: true })
    .eq('is_founding_member', true)
    .is('deleted_at', null);
  if (error) {
    console.error('DB count error:', error.message);
  } else {
    console.log(`DB founding_count = ${count}`);
  }

  // 3. Compare
  console.log('\n--- 3. COMPARISON ---');
  const dbCount = count ?? 0;
  const expectedRemaining = 100 - dbCount;
  const endpointRemaining = endpointResult?.remaining;
  const endpointTotal = endpointResult?.total;

  console.log(`DB founding_count: ${dbCount}`);
  console.log(`Expected remaining: ${expectedRemaining}`);
  console.log(`Endpoint remaining: ${endpointRemaining}`);
  console.log(`Endpoint total: ${endpointTotal}`);
  console.log(`Endpoint migrated: ${endpointResult?.migrated}`);

  const match = endpointRemaining === expectedRemaining;
  console.log(`\n${match ? '✅ PASS' : '❌ FAIL'} — Endpoint remaining matches DB: ${match}`);

  if (!match) {
    console.log('\n--- DIAGNOSIS ---');
    console.log('If endpoint returns 100 but DB has founding_count > 0:');
    console.log('  - Check for Next.js caching (force-dynamic should be present)');
    console.log('  - Check if the endpoint query is hitting the right table/column');
    console.log('  - Check if there is a fallback returning FOUNDING_SLOTS_TOTAL');
  }

  process.exit(match ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});