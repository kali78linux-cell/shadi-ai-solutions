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

if (!url || !anonKey || !serviceKey) {
  console.error('BLOCKED: Supabase env vars missing');
  process.exit(1);
}

console.log('=== LIVE DIAGNOSTIC: Registration → Login → Clinic Resolution ===');
console.log('Supabase URL host:', new URL(url).host);

// Service-role client = what the register API route uses (supabaseAdmin)
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
// Anon client = what the browser/useClinicContext uses
const anon = createClient(url, anonKey, { auth: { persistSession: true } });

// The user reported in the bug
const TARGET_EMAIL = 'allam-clinic@gmail.com';

async function main() {
  // ============================================================
  // STEP A: What does the AUTH layer know about this user?
  // ============================================================
  console.log('\n--- STEP A: auth.users lookup (service-role) ---');
  const { data: page, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) {
    console.log('listUsers FAILED:', listErr.message);
  } else {
    const users = page.users || [];
    console.log('total auth users:', users.length);
    const target = users.find((u) => (u.email || '').toLowerCase() === TARGET_EMAIL.toLowerCase());
    if (target) {
      console.log('TARGET USER FOUND:');
      console.log('  id:', target.id);
      console.log('  email:', target.email);
      console.log('  email_confirmed_at:', target.email_confirmed_at ?? 'NULL (NOT CONFIRMED)');
      console.log('  created_at:', target.created_at);
      console.log('  last_sign_in_at:', target.last_sign_in_at ?? 'never');
      // user_metadata in case clinic id is stored there
      console.log('  user_metadata:', JSON.stringify(target.user_metadata ?? {}));
    } else {
      console.log('TARGET USER NOT FOUND in auth.users');
    }
  }

  // ============================================================
  // STEP B: What does the clinics table have for this user?
  // ============================================================
  console.log('\n--- STEP B: clinics table lookup ---');
  const { data: clinics, error: clinicsErr } = await admin.from('clinics').select('id, name, slug').is('deleted_at', null).limit(50);
  if (clinicsErr) {
    console.log('clinics query FAILED:', clinicsErr.message);
  } else {
    console.log('clinics count:', (clinics || []).length);
    const allam = (clinics || []).filter((c) => (c.name || '').includes('allam') || (c.slug || '').includes('allam'));
    if (allam.length > 0) {
      for (const c of allam) console.log('  MATCH:', c.id, '|', c.slug, '|', c.name);
    } else {
      console.log('  No clinic matching "allam" found');
    }
  }

  // ============================================================
  // STEP C: What does clinic_users have?
  // ============================================================
  console.log('\n--- STEP C: clinic_users lookup ---');
  const { data: allMembers, error: membersErr } = await admin.from('clinic_users').select('id, clinic_id, user_id, role, deleted_at').limit(100);
  if (membersErr) {
    console.log('clinic_users query FAILED:', membersErr.message);
    console.log('  (This error often means the deleted_at column DOES NOT EXIST in the live DB)');
  } else {
    console.log('clinic_users count:', (allMembers || []).length);
    for (const m of allMembers || []) {
      console.log('  membership:', m.id, '| clinic=' + m.clinic_id, '| user=' + m.user_id, '| role=' + m.role, '| deleted_at=' + (m.deleted_at ?? 'null'));
    }
  }

  // ============================================================
  // STEP D: Try login with anon key (same as browser)
  // ============================================================
  console.log('\n--- STEP D: Login attempt (anon key, browser-like) ---');
  const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({
    email: TARGET_EMAIL,
    password: '********', // intentionally wrong; we only want to check the error shape
  });
  if (loginErr) {
    console.log('LOGIN ERROR:', loginErr.message);
    console.log('LOGIN ERROR status:', loginErr.status);
  } else {
    console.log('LOGIN SUCCESS (unexpected with wrong password!)');
  }

  // ============================================================
  // STEP E: Try registering a fresh test user to see the signUp response shape
  // ============================================================
  console.log('\n--- STEP E: signUp response shape test (browser-like) ---');
  const freshEmail = `diag-${Date.now()}@diag.local`;
  const { data: signUpData, error: signUpErr } = await anon.auth.signUp({
    email: freshEmail,
    password: 'testpass123',
  });
  if (signUpErr) {
    console.log('SIGNUP ERROR:', signUpErr.message);
  } else {
    console.log('SIGNUP data keys:', Object.keys(signUpData || {}));
    console.log('  user created:', signUpData.user?.id ?? 'NONE');
    console.log('  session present:', signUpData.session ? 'YES' : 'NO (EMAIL CONFIRMATION REQUIRED — this breaks registration!)');
    console.log('  user.email_confirmed_at:', signUpData.user?.email_confirmed_at ?? 'NULL');
  }

  // ============================================================
  // STEP F: Check whether clinic_users.deleted_at column exists
  // ============================================================
  console.log('\n--- STEP F: Column existence check (clinic_users.deleted_at) ---');
  const { data: colData, error: colErr } = await admin
    .rpc('exec_sql', { sql: "select column_name from information_schema.columns where table_schema='public' and table_name='clinic_users' order by ordinal_position" })
    .catch((e) => ({ data: null, error: e }));
  if (colErr) {
    console.log('RPC unavailable (expected — exec_sql is usually revoked). Falling back to insert-test...');
    // Alternative: attempt the exact same filtered query the useClinicContext hook runs
    const { data: check, error: checkErr } = await anon.from('clinic_users').select('clinic_id').is('deleted_at', null).limit(1);
    if (checkErr) {
      console.log('ANON QUERY WITH deleted_at FILTER FAILED:', checkErr.message);
    } else {
      console.log('ANON QUERY WITH deleted_at FILTER OK, rows:', (check || []).length);
    }
  } else {
    console.log('clinic_users columns:', JSON.stringify(colData));
  }

  console.log('\n=== DIAGNOSTIC COMPLETE ===');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});