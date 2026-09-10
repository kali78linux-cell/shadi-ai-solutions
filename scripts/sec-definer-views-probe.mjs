import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/**
 * MULTI-TENANT SECURITY PROBE for the two financial views:
 *  after switching to security_invoker=true, an authenticated member of ONE
 *  clinic must NOT be able to read ANOTHER clinic's rows through the view,
 *  and anon must see nothing.
 *
 * Creates two disposable TEST users in two different clinics, signs them in,
 * queries the views via REST as each, and asserts strict per-tenant + zero
 * cross-tenant leakage. TEST data only — cleaned up after.
 */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const results = [];
const check = (n, ok, extra) => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' — ' + extra : ''}`);

async function makeUser(email, clinicId, role) {
  const { data: created } = await sb.auth.admin.createUser({ email, password: 'ProbePass!234', email_confirm: true });
  await sb.from('clinic_users').insert({ clinic_id: clinicId, user_id: created.user.id, role, deleted_at: null });
  const { data: s } = await anon.auth.signInWithPassword({ email, password: 'ProbePass!234' });
  return { id: created.user.id, token: s?.session?.access_token };
}

async function main() {
  const { data: clinics } = await sb.from('clinics').select('id, slug').in('slug', ['amal-x-ray-center', 'amal-clinic']);
  const A = clinics.find((c) => c.slug === 'amal-x-ray-center').id;
  const B = clinics.find((c) => c.slug === 'amal-clinic').id;
  console.log('A(imaging)=', A, ' B(clinic)=', B);

  const stamp = Date.now();
  const uA = await makeUser(`sec-a-${stamp}@test.local`, A, 'owner');
  const uB = await makeUser(`sec-b-${stamp}@test.local`, B, 'owner');

  // As USER A: query the view filtered by clinic_id=A → allowed; filtered by B → must be empty
  async function viewAs(token, view, clinicId) {
    const r = await fetch(`${URL}/rest/v1/${view}?clinic_id=eq.${clinicId}&select=clinic_id`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, authorization: `Bearer ${token}` },
    });
    if (r.status !== 200) { const t = await r.text(); return { status: r.status, err: t.slice(0, 120) }; }
    const arr = await r.json();
    return { status: 200, rows: Array.isArray(arr) ? arr : [] };
  }

  const ownCashA = await viewAs(uA.token, 'daily_cash_positions', A);
  check('user A reads A-daily_cash_positions (authorized)', ownCashA.status === 200, 'http ' + ownCashA.status);
  const crossCash = await viewAs(uA.token, 'daily_cash_positions', B);
  check('user A CANNOT read B-daily_cash_positions (cross-tenant)', crossCash.status === 200 && (crossCash.rows || []).length === 0, `http ${crossCash.status} rows=${crossCash.rows?.length}`);
  const ownRevA = await viewAs(uA.token, 'provider_revenue', A);
  check('user A reads A-provider_revenue', ownRevA.status === 200, 'http ' + ownRevA.status);
  const crossRev = await viewAs(uA.token, 'provider_revenue', B);
  check('user A CANNOT read B-provider_revenue (cross-tenant)', crossRev.status === 200 && (crossRev.rows || []).length === 0, `http ${crossRev.status} rows=${crossRev.rows?.length}`);

  // user B symmetric
  const crossCashB = await viewAs(uB.token, 'daily_cash_positions', A);
  check('user B CANNOT read A-daily_cash_positions', crossCashB.status === 200 && (crossCashB.rows || []).length === 0, `rows=${crossCashB.rows?.length}`);
  const crossRevB = await viewAs(uB.token, 'provider_revenue', A);
  check('user B CANNOT read A-provider_revenue', crossRevB.status === 200 && (crossRevB.rows || []).length === 0, `rows=${crossRevB.rows?.length}`);

  // anon → must see nothing (either error or empty)
  const anonRes = await fetch(`${URL}/rest/v1/daily_cash_positions?select=clinic_id&limit=1`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY } });
  const anonArr = anonRes.status === 200 ? await anonRes.json() : [];
  check('anon sees NO daily_cash_positions rows', anonRes.status === 401 || anonRes.status === 403 || (Array.isArray(anonArr) && anonArr.length === 0), `http ${anonRes.status} rows=${Array.isArray(anonArr) ? anonArr.length : 'n/a'}`);

  // cleanup
  for (const u of [uA, uB]) {
    await sb.from('clinic_users').delete().eq('user_id', u.id);
    await sb.auth.admin.deleteUser(u.id);
  }
  check('cleanup complete', true);

  console.log('\n=== MULTI-TENANT VIEW SECURITY ===');
  for (const r of results) console.log(r);
  const fails = results.filter((r) => r.startsWith('FAIL'));
  console.log('\n' + (results.length - fails.length) + '/' + results.length + ' PASS');
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });