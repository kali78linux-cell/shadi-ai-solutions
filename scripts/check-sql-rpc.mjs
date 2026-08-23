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
  console.log('=== CHECK SQL RPC AVAILABILITY ===\n');

  // Test if the 'sql' RPC function exists
  const { data, error } = await admin.rpc('sql', {
    sql: 'SELECT 1 AS test',
  });

  if (error) {
    console.log('❌ RPC "sql" NOT available:', error.message);
    console.log('  - This means we cannot use atomic SQL updates via RPC.');
    console.log('  - We need another approach for race-condition protection.');
  } else {
    console.log('✅ RPC "sql" IS available:', JSON.stringify(data));
    console.log('  - We can use atomic SQL updates to prevent race conditions.');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});