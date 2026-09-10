import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envRaw = fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8');
function getEnv(key) {
  const line = envRaw.split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

const url = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!url || !anonKey) {
  console.error('BLOCKED: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY missing');
  process.exit(1);
}

// Uses ONLY the anon key — exactly what the browser does (service-role NOT exposed)
const browserLikeClient = createClient(url, anonKey, {
  auth: { persistSession: true },
});

async function main() {
  console.log('=== Verify real login (anon key only, same as browser) ===');
  const { data, error } = await browserLikeClient.auth.signInWithPassword({
    email: 'shadisuad78@gmail.com',
    // Do NOT hardcode real credentials. Run with:
    //   REAL_LOGIN_PASSWORD=... node scripts/verify-real-login.mjs
    password: process.env.REAL_LOGIN_PASSWORD ?? '',
  });

  if (error) {
    console.log('LOGIN FAILED:', error.message);
    process.exit(2);
  }

  console.log('LOGIN SUCCESS');
  console.log('  user id: ' + data.user.id);
  console.log('  email: ' + data.user.email);
  console.log('  access_token present: ' + Boolean(data.session?.access_token));
  console.log('  refresh_token present: ' + Boolean(data.session?.refresh_token));

  // Now verify the memberships the dashboard's useClinicContext will load
  console.log('=== Verify memberships (same query useClinicContext performs) ===');
  const { data: memberships, error: membershipsError } = await browserLikeClient
    .from('clinic_users')
    .select('clinic_id, role, clinic:clinics(id, name, slug)')
    .eq('user_id', data.user.id)
    .is('deleted_at', null);

  if (membershipsError) {
    console.log('MEMBERSHIPS QUERY FAILED:', membershipsError.message);
  } else {
    console.log('MEMBERSHIPS (' + (memberships || []).length + '):');
    for (const m of memberships || []) {
      const clinicInfo = Array.isArray(m.clinic) ? (m.clinic[0] ?? null) : (m.clinic ?? null);
      console.log('  - clinic_id=' + m.clinic_id + ' role=' + m.role + ' name=' + (clinicInfo?.name ?? '?') + ' slug=' + (clinicInfo?.slug ?? '?'));
    }
  }

  console.log('DONE.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});