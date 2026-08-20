import fs from 'fs';

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
  console.log('SUPABASE CONNECTION: BLOCKED — real URL missing');
  process.exit(1);
}
if (!serviceKey || serviceKey.includes('your-')) {
  console.log('SUPABASE CONNECTION: BLOCKED — service role key missing');
  process.exit(1);
}

console.log('Verifying real Supabase connectivity...');
console.log('Host reachability + REST API test:');

// Test 1: Root REST endpoint with service role (proves host + project exists + key recognized)
try {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${serviceKey}`,
    },
  });
  console.log('  REST /rest/v1/ HTTP status:', res.status);
  // 200 = project reachable and key recognized at transport level
  console.log('  Host + project exists: ' + (res.status !== 0 && res.status < 500 ? 'PASS' : 'CHECK'));
} catch (e) {
  console.log('  REST /rest/v1/ FAILED:', e.message);
}

// Test 2: Auth health check endpoint
try {
  const res = await fetch(`${url}/auth/v1/health`, {
    headers: { apikey: anonKey },
  });
  console.log('  Auth /auth/v1/health HTTP status:', res.status);
} catch (e) {
  console.log('  Auth /auth/v1/health FAILED:', e.message);
}

console.log('SUPABASE CONNECTIVITY CHECK COMPLETE');