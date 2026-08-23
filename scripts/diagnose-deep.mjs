import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envRaw = fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8');
function getEnv(key) {
  const line = envRaw.split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

const url = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = createClient(url, anonKey, { auth: { persistSession: true } });

async function main() {
  console.log('=== DEEP DIAGNOSTIC ===');

  // 1. List ALL auth users
  console.log('\n--- 1. All auth users ---');
  const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.log('listUsers FAILED:', listErr.message);
  } else {
    for (const u of page.users || []) {
      console.log('  USER:', u.id, '|', u.email, '| confirmed_at:', u.email_confirmed_at ?? 'NULL', '| created:', u.created_at);
    }
  }

  // 2. Cross-check: do clinic_users.user_id values map to existing auth users?
  console.log('\n--- 2. Cross-check clinic_users.user_id vs auth.users ---');
  const authIds = new Set((page?.users || []).map((u) => u.id));
  const { data: memberships } = await admin.from('clinic_users').select('id, clinic_id, user_id, role, deleted_at').limit(200);
  for (const m of memberships || []) {
    const exists = authIds.has(m.user_id);
    console.log(`  membership ${m.id} → user ${m.user_id} ${exists ? 'EXISTS in auth' : '*** ORPHAN (not in auth.users) ***'} | clinic ${m.clinic_id} | role ${m.role} | deleted ${m.deleted_at ?? 'no'}`);
  }

  // 3. All clinics
  console.log('\n--- 3. All clinics ---');
  const { data: clinics } = await admin.from('clinics').select('id, name, slug, deleted_at').limit(100);
  for (const c of clinics || []) {
    console.log('  CLINIC:', c.id, '|', c.slug, '|', c.name, '| deleted:', c.deleted_at ?? 'no');
  }

  // 4. Test signUp with a well-formed email to check email confirmation mode
  console.log('\n--- 4. signUp with real-shaped email (check session presence) ---');
  const testEmail = `regtest-${Date.now().toString(36)}@gmail.com`;
  const { data: signUpData, error: signUpErr } = await anon.auth.signUp({
    email: testEmail,
    password: 'testpass123',
    options: { data: { source: 'diagnostic' } },
  });
  if (signUpErr) {
    console.log('SIGNUP ERROR:', signUpErr.message, '| status:', signUpErr.status ?? 'n/a');
  } else {
    console.log('SIGNUP OK');
    console.log('  user id:', signUpData.user?.id ?? 'NONE');
    console.log('  user email:', signUpData.user?.email ?? 'NONE');
    console.log('  email_confirmed_at:', signUpData.user?.email_confirmed_at ?? 'NULL');
    console.log('  session:', signUpData.session ? `PRESENT (access_token len ${signUpData.session.access_token.length})` : 'NULL — EMAIL CONFIRMATION REQUIRED');
    console.log('  identities:', JSON.stringify(signUpData.user?.identities?.map((i) => ({ provider: i.provider, id: i.id, created_at: i.created_at }))));
  }

  // 5. If a session WAS returned, immediately delete this test user to leave no junk
  if (signUpData?.session) {
    console.log('\n--- 5. Cleaning up test signup user ---');
    const { error: delErr } = await admin.auth.admin.deleteUser(signUpData.user.id);
    console.log(delErr ? 'CLEANUP FAILED: ' + delErr.message : 'CLEANUP OK — test user removed');
  }

  console.log('\n=== DEEP DIAGNOSTIC COMPLETE ===');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});