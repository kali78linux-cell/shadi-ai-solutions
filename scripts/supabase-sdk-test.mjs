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
const serviceKey = get('SUPABASE_SERVICE_ROLE_KEY');

if (!url || url.includes('your-') || url.includes('placeholder')) {
  console.log('SDK TEST: BLOCKED — real URL missing');
  process.exit(1);
}

console.log('Testing via @supabase/supabase-js SDK (v2.39+ supports new key format)...');

// Test 1: Client with anon/publishable key (public client)
const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
try {
  const { data, error } = await anonClient.from('clinics').select('id').limit(1);
  if (error) {
    console.log('  anon client query: ERROR —', error.message);
  } else {
    console.log('  anon client query: PASS — returned', Array.isArray(data) ? data.length : 'data', 'row(s)');
  }
} catch (e) {
  console.log('  anon client query: EXCEPTION —', e.message);
}

// Test 2: Admin client with service role key (server-side)
const adminClient = createClient(url, serviceKey, { auth: { persistSession: false } });
try {
  const { data, error } = await adminClient.from('clinics').select('id').limit(1);
  if (error) {
    console.log('  service-role client query: ERROR —', error.message);
  } else {
    console.log('  service-role client query: PASS — returned', Array.isArray(data) ? data.length : 'data', 'row(s)');
  }
} catch (e) {
  console.log('  service-role client query: EXCEPTION —', e.message);
}

console.log('SDK TEST COMPLETE');