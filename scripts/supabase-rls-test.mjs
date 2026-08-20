import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Read .env.local safely, never printing values
const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!url || url.includes('your-') || url.includes('placeholder')) {
  console.log('RLS TEST: BLOCKED — real URL missing');
  process.exit(1);
}

console.log('Testing multiple tables with publishable key to isolate RLS recursion...');

const client = createClient(url, anonKey, { auth: { persistSession: false } });

// Test various tables to see which ones trigger "stack depth limit exceeded"
const tables = ['clinics', 'clinic_users', 'providers', 'clinic_services', 'patients', 'appointments', 'conversations', 'messages'];

for (const table of tables) {
  try {
    const { data, error } = await client.from(table).select('id').limit(1);
    if (error) {
      console.log(`  ${table}: ERROR — ${error.message}`);
    } else {
      console.log(`  ${table}: PASS — returned ${Array.isArray(data) ? data.length : 'data'} row(s)`);
    }
  } catch (e) {
    console.log(`  ${table}: EXCEPTION — ${e.message}`);
  }
}

console.log('RLS TEST COMPLETE');