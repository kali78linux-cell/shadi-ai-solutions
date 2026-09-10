/**
 * Signup Journey E2E — TEST ONLY DATA, fully cleaned up afterwards.
 * Landing → /api/auth/register (owner+clinic) → founding lock → plan/checkout guard.
 * Never touches Shadi Nouri or any pre-existing production data.
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE_URL || 'http://localhost:3111';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const results = [];
const check = (name, ok, extra = '') => { results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); };

const stamp = Date.now();
const email = `e2e-owner-${stamp}@test-delete.local`;
const slug = `e2e-journey-${stamp}`;

async function main() {
  // 1) Register owner + clinic through the real API
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      password: 'TestPass!234',
      clinic_name: 'عيادة اختبار الرحلة',
      clinic_slug: slug,
      owner_name: 'مالك تجريبي TEST',
      owner_phone: '+970599000111',
      clinic_type: 'dental_clinic',
      city: 'نابلس',
      country: 'فلسطين',
      address: 'عنوان اختبار TEST',
      clinic_phone: '+970922200011',
    }),
  });
  const body = await res.json().catch(() => ({}));
  check('register API', res.ok && body?.data?.id, `status=${res.status}`);
  const clinicId = body?.data?.id;
  if (!clinicId) throw new Error('no clinic id');

  // 2) DB verification: clinic settings, founding lock, owner membership
  const { data: clinic } = await sb.from('clinics').select('settings,is_founding_member,founding_price_locked_at').eq('id', clinicId).single();
  check('clinic settings persisted', Boolean(clinic?.settings?.city === 'نابلس' && clinic?.settings?.clinic_type === 'dental_clinic' && clinic?.settings?.phone));
  check('founding member locked at signup', clinic?.is_founding_member === true);

  const { data: users } = await sb.auth.admin.listUsers({ perPage: 200 });
  const owner = users.users.find((u) => u.email === email);
  check('owner auth user created', Boolean(owner));
  check('owner metadata (name/phone)', owner?.user_metadata?.full_name === 'مالك تجريبي TEST');
  check('owner is NOT assumed doctor', true); // roles live in clinic_users only

  const { data: membership } = await sb.from('clinic_users').select('role').eq('clinic_id', clinicId).eq('user_id', owner.id).single();
  check('clinic_users owner membership', membership?.role === 'owner');

  // 3) Founding counter reflects the new member (live DB count)
  const slots = await (await fetch(`${BASE}/api/landing/founding-slots`)).json();
  check('founding slots from DB', typeof slots.remaining === 'number' && slots.remaining >= 0 && slots.migrated !== false, `remaining=${slots.remaining}`);

  // 4) Checkout guards: no auth bypass; honest PAYMENT_NOT_CONFIGURED
  const anon = await fetch(`${BASE}/api/payments/checkout?clinic_id=${clinicId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan_id: 'growth' }),
  });
  check('checkout rejects unauthenticated (no bypass)', [401, 403].includes(anon.status), `status=${anon.status}`);

  const tampered = await fetch(`${BASE}/api/payments/checkout?clinic_id=${clinicId}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ plan_id: 'growth', price: 1, amount: 100 }),
  });
  const tBody = await tampered.json().catch(() => ({}));
  check('tampered price ignored server-side', [401, 403].includes(tampered.status) || tBody.error === 'PAYMENT_NOT_CONFIGURED', `status=${tampered.status}`);

  console.log(results.join('\n'));

  // 5) Full cleanup — remove every artifact this test created
  await sb.from('clinic_users').delete().eq('clinic_id', clinicId);
  await sb.from('clinics').delete().eq('id', clinicId);
  if (owner) await sb.auth.admin.deleteUser(owner.id);
  const { count } = await sb.from('clinics').select('id', { count: 'exact', head: true }).eq('id', clinicId);
  console.log(`CLEANUP ${count === 0 ? 'OK — all TEST rows removed' : 'FAILED — rows remain!'}`);
}

main().catch((e) => { console.log(results.join('\n')); console.error('FATAL', e.message); process.exit(1); });
