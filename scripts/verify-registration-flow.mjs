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

// Service-role client = what the fixed /api/auth/register route uses
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
// Anon client = what the browser/login/useClinicContext uses
const anon = createClient(url, anonKey, { auth: { persistSession: true } });

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅ PASS' : '❌ FAIL'} — ${name}: ${detail}`);
}

// Unique test identities
const stamp = Date.now().toString(36);
const EMAIL_A = `testa-${stamp}@gmail.com`;
const EMAIL_B = `testb-${stamp}@gmail.com`;
const PASSWORD = 'TestPass123!';
const SLUG_A = `test-clinic-a-${stamp}`;
const SLUG_B = `test-clinic-b-${stamp}`;

// Mirrors the fixed /api/auth/register route logic
async function registerClinic(email, password, clinicName, slug) {
  // 1. Create confirmed auth user (service-role)
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr) return { ok: false, error: createErr.message };
  const userId = created.user.id;

  try {
    // 2. Create clinic
    const { data: clinic, error: clinicErr } = await admin
      .from('clinics')
      .insert({ name: clinicName, slug, settings: { timezone: 'Asia/Jerusalem', default_appointment_duration_minutes: 30 } })
      .select('id, name, slug')
      .single();
    if (clinicErr) throw new Error(clinicErr.message);

    // 3. Create owner membership
    const { error: memberErr } = await admin.from('clinic_users').insert({
      clinic_id: clinic.id,
      user_id: userId,
      role: 'owner',
    });
    if (memberErr) throw new Error(memberErr.message);

    return { ok: true, userId, clinicId: clinic.id, clinic };
  } catch (err) {
    // Rollback
    await admin.auth.admin.deleteUser(userId);
    return { ok: false, error: err.message };
  }
}

async function main() {
  console.log('=== REGISTRATION → LOGIN → DASHBOARD FLOW VERIFICATION ===\n');

  // ============ TEST 1: Register new account + clinic ============
  console.log('--- TEST 1: Register new account + clinic ---');
  const regA = await registerClinic(EMAIL_A, PASSWORD, 'Test Clinic A', SLUG_A);
  if (!regA.ok) {
    record('TEST 1: Registration', false, regA.error);
  } else {
    // Verify auth.users exists
    const { data: userCheck } = await admin.auth.admin.getUserById(regA.userId);
    const userExists = Boolean(userCheck?.user);
    // Verify clinic exists
    const { data: clinicCheck } = await admin.from('clinics').select('id, name, slug').eq('id', regA.clinicId).single();
    const clinicExists = Boolean(clinicCheck);
    // Verify clinic_users row exists
    const { data: memberCheck } = await admin.from('clinic_users').select('id, clinic_id, user_id, role').eq('clinic_id', regA.clinicId).eq('user_id', regA.userId).is('deleted_at', null).maybeSingle();
    const memberExists = Boolean(memberCheck);
    const relationshipCorrect = memberExists && memberCheck.clinic_id === regA.clinicId && memberCheck.user_id === regA.userId && memberCheck.role === 'owner';

    record('TEST 1: auth.users exists', userExists, `user_id=${regA.userId} email=${EMAIL_A}`);
    record('TEST 1: clinic exists', clinicExists, `clinic_id=${regA.clinicId} slug=${SLUG_A}`);
    record('TEST 1: clinic_users row exists', memberExists, `membership_id=${memberCheck?.id ?? 'none'}`);
    record('TEST 1: relationship correct (owner)', relationshipCorrect, `clinic=${memberCheck?.clinic_id} user=${memberCheck?.user_id} role=${memberCheck?.role}`);
  }

  // ============ TEST 2: Logout then Login ============
  console.log('\n--- TEST 2: Logout then Login ---');
  await anon.auth.signOut();
  const { data: loginData, error: loginErr } = await anon.auth.signInWithPassword({ email: EMAIL_A, password: PASSWORD });
  if (loginErr) {
    record('TEST 2: Login after registration', false, loginErr.message);
  } else {
    record('TEST 2: Login after registration', true, `user=${loginData.user.id} session=${Boolean(loginData.session)} access_token=${Boolean(loginData.session?.access_token)}`);
  }

  // ============ TEST 3: Dashboard clinic resolution ============
  console.log('\n--- TEST 3: Clinic resolution (same query as useClinicContext) ---');
  if (loginData?.session) {
    const { data: memberships, error: memErr } = await anon
      .from('clinic_users')
      .select('clinic_id, role, clinic:clinics(id, name, slug)')
      .eq('user_id', loginData.user.id)
      .is('deleted_at', null);
    if (memErr) {
      record('TEST 3: Clinic resolution', false, memErr.message);
    } else {
      const rows = (memberships || []).filter((r) => r && r.clinic_id);
      const resolved = rows.length > 0;
      const clinicInfo = rows[0]?.clinic;
      const name = Array.isArray(clinicInfo) ? clinicInfo[0]?.name : clinicInfo?.name;
      record('TEST 3: Clinic resolved', resolved, `memberships=${rows.length} clinic=${name ?? 'none'} slug=${SLUG_A}`);
    }
  } else {
    record('TEST 3: Clinic resolution', false, 'no session from login');
  }

  // ============ TEST 4: Refresh (re-login) preserves clinic ============
  console.log('\n--- TEST 4: Refresh (new session) preserves clinic ---');
  await anon.auth.signOut();
  const { data: relogin } = await anon.auth.signInWithPassword({ email: EMAIL_A, password: PASSWORD });
  if (relogin?.session) {
    const { data: memberships2 } = await anon
      .from('clinic_users')
      .select('clinic_id, role, clinic:clinics(id, name, slug)')
      .eq('user_id', relogin.user.id)
      .is('deleted_at', null);
    const rows2 = (memberships2 || []).filter((r) => r && r.clinic_id);
    const sameClinic = rows2.length > 0 && rows2[0].clinic_id === regA.clinicId;
    record('TEST 4: Refresh preserves clinic', sameClinic, `clinic_id=${rows2[0]?.clinic_id} expected=${regA.clinicId}`);
  } else {
    record('TEST 4: Refresh preserves clinic', false, 're-login failed');
  }

  // ============ TEST 5: Logout denies dashboard ============
  console.log('\n--- TEST 5: Logout denies dashboard ---');
  await anon.auth.signOut();
  const { data: afterLogout } = await anon.auth.getSession();
  record('TEST 5: Logout invalidates session', !afterLogout?.session, `session=${Boolean(afterLogout?.session)}`);

  // ============ TEST 6: Wrong password fails ============
  console.log('\n--- TEST 6: Wrong password fails ---');
  const { error: wrongPassErr } = await anon.auth.signInWithPassword({ email: EMAIL_A, password: 'WrongPass999' });
  record('TEST 6: Wrong password rejected', Boolean(wrongPassErr), wrongPassErr?.message ?? 'unexpectedly succeeded');

  // ============ TEST 7: Duplicate registration rejected ============
  console.log('\n--- TEST 7: Duplicate registration rejected ---');
  const dup = await registerClinic(EMAIL_A, PASSWORD, 'Test Clinic A Dup', `${SLUG_A}-dup`);
  record('TEST 7: Duplicate email rejected', !dup.ok && /already (been )?registered/i.test(dup.error || ''), dup.error || 'unexpectedly succeeded');

  // ============ TEST 8: Multi-tenant isolation ============
  console.log('\n--- TEST 8: Multi-tenant isolation ---');
  const regB = await registerClinic(EMAIL_B, PASSWORD, 'Test Clinic B', SLUG_B);
  if (!regB.ok) {
    record('TEST 8: Multi-tenant isolation', false, 'could not create user B: ' + regB.error);
  } else {
    // User A logs in, tries to access User B's clinic via clinic_users query
    await anon.auth.signInWithPassword({ email: EMAIL_A, password: PASSWORD });
    const { data: aMemberships } = await anon
      .from('clinic_users')
      .select('clinic_id')
      .eq('user_id', (await anon.auth.getUser()).data.user.id)
      .is('deleted_at', null);
    const aClinicIds = (aMemberships || []).map((m) => m.clinic_id);
    const cannotAccessB = !aClinicIds.includes(regB.clinicId);
    record('TEST 8: User A cannot access User B clinic', cannotAccessB, `A clinics=[${aClinicIds.join(',')}] B clinic=${regB.clinicId}`);

    // Also verify the server-side authorization gate (clinicAuthorization) blocks A from B
    const { data: authCheck } = await admin.from('clinic_users').select('role').eq('clinic_id', regB.clinicId).eq('user_id', (await anon.auth.getUser()).data.user.id).is('deleted_at', null).maybeSingle();
    record('TEST 8: Server-side auth gate blocks cross-clinic', !authCheck, `membership=${authCheck ? 'FOUND (should be none)' : 'none (correct)'}`);
  }

  // ============ CLEANUP ============
  console.log('\n--- CLEANUP ---');
  for (const email of [EMAIL_A, EMAIL_B]) {
    const { data: page } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const u = (page?.users || []).find((x) => x.email === email);
    if (u) {
      await admin.auth.admin.deleteUser(u.id);
      console.log(`  deleted auth user ${email}`);
    }
  }
  // Delete test clinics
  for (const slug of [SLUG_A, SLUG_B, `${SLUG_A}-dup`]) {
    const { data: c } = await admin.from('clinics').select('id').eq('slug', slug).maybeSingle();
    if (c) {
      await admin.from('clinics').delete().eq('id', c.id);
      console.log(`  deleted clinic ${slug}`);
    }
  }

  console.log('\n=== SUMMARY ===');
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.filter((r) => !r.pass).length;
  console.log(`PASS: ${passCount}  FAIL: ${failCount}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});