import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/**
 * DASHBOARD LIVE ROUTE PROBE — behavioral verification for the imaging center.
 * Creates a disposable TEST owner user in the imaging center tenant, signs in,
 * and probes EVERY dashboard module page + its backing APIs, recording the
 * HTTP status of each. Then cleans up the TEST user (no real-data writes).
 */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = process.env.BASE || 'http://localhost:3244';
const IMG_SLUG = 'amal-x-ray-center';
const EMAIL = `probe-owner-${Date.now()}@test-delete.local`;
const PASSWORD = 'ProbePass!234';

const MODULES = [
  'overview', 'appointments', 'patients', 'conversations', 'leads', 'knowledge-base',
  'providers', 'services', 'team', 'notifications', 'analytics', 'financial-intelligence',
  'growth', 'ai-settings', 'communication-settings', 'ads', 'setup', 'clinic-setup',
  'public-page', 'subscription', 'imaging-requests', 'referring-clinics', 'medical-files',
];

async function main() {
  // 1) find the imaging center
  const { data: clinic } = await sb.from('clinics').select('id, slug, activity_type').eq('slug', IMG_SLUG).single();
  if (!clinic) { console.log('CLINIC NOT FOUND'); process.exit(1); }
  console.log('CLINIC:', clinic.id, clinic.activity_type);

  // 2) create disposable TEST user
  const { data: created, error: createErr } = await sb.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (createErr) { console.log('CREATE USER FAIL:', createErr.message); process.exit(1); }
  const userId = created.user.id;

  // 3) membership as owner
  const { error: mErr } = await sb.from('clinic_users').insert({
    clinic_id: clinic.id, user_id: userId, role: 'owner', deleted_at: null,
  });
  if (mErr) { console.log('MEMBERSHIP FAIL:', mErr.message); await sb.auth.admin.deleteUser(userId); process.exit(1); }

  // 4) sign in (client) to get a real session cookie/token
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: sess } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const token = sess?.session?.access_token;

  // 5) probe pages (server-rendered HTML) + APIs with Bearer
  const results = [];
  for (const mod of MODULES) {
    let status = 0;
    try {
      const res = await fetch(`${BASE}/dashboard/${IMG_SLUG}/${mod}`, {
        headers: token ? { authorization: `Bearer ${token}`, cookie: `sb-access-token=${token}` } : {},
        redirect: 'manual',
      });
      status = res.status;
    } catch (e) { status = -1; }
    results.push({ mod, status });
  }

  // 6) backing APIs the dashboard pages call
  const apis = [
    `/api/clinic/overview?clinic_id=${clinic.id}`,
    `/api/clinic/overview`,
    `/api/patients?clinic_id=${clinic.id}`,
    `/api/appointments?clinic_id=${clinic.id}`,
    `/api/clinic/activity-requests?clinic_id=${clinic.id}&table=imaging_requests`,
    `/api/clinic/organization-relationships?clinic_id=${clinic.id}`,
    `/api/clinic/subscription?clinic_id=${clinic.id}`,
    `/api/clinic/public-page?clinic_id=${clinic.id}`,
    `/api/clinic/services?clinic_id=${clinic.id}`,
    `/api/clinic/ai-settings?clinic_id=${clinic.id}`,
  ];
  const apiResults = [];
  for (const p of apis) {
    let status = 0; let snippet = '';
    try {
      const res = await fetch(`${BASE}${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      status = res.status;
      if (res.status >= 400) snippet = (await res.text()).slice(0, 200);
    } catch (e) { status = -1; snippet = String(e).slice(0, 100); }
    apiResults.push({ path: p.split('?')[0], status, snippet });
  }

  // 7) report
  console.log('\n=== PAGES (expect 200 or 307-login) ===');
  const badPages = results.filter((r) => r.status !== 200 && r.status !== 307);
  for (const r of results) console.log(`${r.status}  ${r.mod}`);
  console.log('\n=== APIS (expect 200) ===');
  for (const r of apiResults) console.log(`${r.status}  ${r.path}${r.status >= 400 ? ' → ' + r.snippet : ''}`);

  const pageFails = results.filter((r) => ![200, 307].includes(r.status));
  const apiFails = apiResults.filter((r) => r.status !== 200);
  console.log(`\nPAGES: ${results.length - pageFails.length}/${results.length} OK · APIS: ${apiResults.length - apiFails.length}/${apiResults.length} OK`);

  // 8) cleanup — delete TEST user (cascade removes clinic_users row via FK)
  await sb.from('clinic_users').delete().eq('user_id', userId);
  await sb.auth.admin.deleteUser(userId);
  console.log('CLEANUP: test user removed');

  process.exit(pageFails.length || apiFails.length ? 1 : 0);
}

main().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });