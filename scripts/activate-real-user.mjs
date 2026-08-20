import fs from 'fs';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const envRaw = fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8');
function getEnv(key) {
  const line = envRaw.split('\n').find((l) => l.startsWith(key + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
}

const url = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

if (!url || url.includes('placeholder') || url.includes('your-')) {
  console.error('BLOCKED: real NEXT_PUBLIC_SUPABASE_URL missing');
  process.exit(1);
}
if (!serviceKey || serviceKey.includes('placeholder') || serviceKey.includes('your-')) {
  console.error('BLOCKED: SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

// The desired user from the task may not exist in this Supabase project.
// We try multiple candidate emails: first the target, then any existing auth users.
const TARGET_EMAILS = [
  'shadisuad78@gmail.com',
  'clinic-admin@demo.local',
];
// demo-dental-clinic deterministic id (matches scripts/demo-seed.mjs)
const PRIMARY_CLINIC_ID = 'c92da4ab-9a27-a35c-ec35-f511c0110811';

async function main() {
  console.log('=== STEP 1: Find real user by email ===');
  const { data: page, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw new Error('listUsers failed: ' + listErr.message);

  // Prefer the exact target email from the task (shadisuad78@gmail.com).
  let target = (page.users || []).find((u) => u.email === 'shadisuad78@gmail.com');
  if (!target) {
    // The seed.sql intended to create shadisuad78@gmail.com with password 111978.
    console.log('Creating user shadisuad78@gmail.com (password 111978) as the seed intended...');
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email: 'shadisuad78@gmail.com',
      password: '111978',
      email_confirm: true,
    });
    if (createErr) throw new Error('createUser failed: ' + createErr.message);
    target = created.user;
    console.log('USER CREATED: id=' + target.id + ' email=' + target.email);
  }
  console.log('USER FOUND:');
  console.log('  id: ' + target.id);
  console.log('  email: ' + target.email);
  console.log('  created_at: ' + target.created_at);

  console.log('=== STEP 2: Inspect existing clinics ===');
  const { data: clinics, error: clinicsErr } = await sb
    .from('clinics')
    .select('id, name, slug')
    .is('deleted_at', null)
    .order('name');
  if (clinicsErr) throw new Error('clinics select failed: ' + clinicsErr.message);
  console.log('CLINICS (' + (clinics || []).length + '):');
  for (const c of clinics || []) {
    console.log('  - ' + c.slug + ' | ' + c.name + ' | ' + c.id);
  }

  console.log('=== STEP 3: Check existing memberships ===');
  const { data: memberships, error: membershipsErr } = await sb
    .from('clinic_users')
    .select('id, clinic_id, role, user_id')
    .eq('user_id', target.id)
    .is('deleted_at', null);
  if (membershipsErr) throw new Error('clinic_users select failed: ' + membershipsErr.message);
  console.log('MEMBERSHIPS (' + (memberships || []).length + '):');
  for (const m of memberships || []) {
    console.log('  - clinic=' + m.clinic_id + ' role=' + m.role + ' id=' + m.id);
  }

  const alreadyMember = (memberships || []).some((m) => m.clinic_id === PRIMARY_CLINIC_ID);
  if (alreadyMember) {
    console.log('ALREADY a member of Demo Dental Clinic — no action needed.');
    process.exit(0);
  }

  console.log('=== STEP 4: Create owner membership for Demo Dental Clinic ===');
  const { data: clinicRow, error: clinicRowErr } = await sb
    .from('clinics')
    .select('id, name')
    .eq('id', PRIMARY_CLINIC_ID)
    .is('deleted_at', null)
    .single();
  if (clinicRowErr || !clinicRow) {
    console.error('Demo Dental Clinic not found in clinics table. Aborting.');
    process.exit(2);
  }
  console.log('Primary clinic confirmed: ' + clinicRow.name + ' | ' + clinicRow.id);

  const { error: insertErr } = await sb.from('clinic_users').insert({
    id: randomUUID(),
    clinic_id: PRIMARY_CLINIC_ID,
    user_id: target.id,
    role: 'owner',
  });
  if (insertErr) throw new Error('clinic_users insert failed: ' + insertErr.message);
  console.log('MEMBERSHIP CREATED: user=' + target.id + ' clinic=' + PRIMARY_CLINIC_ID + ' role=owner');

  console.log('=== STEP 5: Verify membership ===');
  const { data: verify, error: verifyErr } = await sb
    .from('clinic_users')
    .select('id, clinic_id, role, user_id')
    .eq('user_id', target.id)
    .is('deleted_at', null);
  if (verifyErr) throw new Error('verify failed: ' + verifyErr.message);
  console.log('FINAL MEMBERSHIPS:');
  console.log(JSON.stringify(verify, null, 2));

  console.log('DONE.');
}

main().catch((err) => {
  console.error('ERROR:', err.message);
  process.exit(1);
});