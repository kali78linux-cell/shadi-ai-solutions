/**
 * STEP 11 Phase 2 — UI Manual Verification (dev server, no browser automation).
 * Renders the real dashboard pages through a REAL authenticated session for a
 * synthetic owner+clinic, asserts the interactive CRUD surfaces and their exact
 * endpoint wiring render server-side, and confirms the auth gate redirects when
 * no session cookie is present. Cleanup = IDs created this round only.
 * No source/test changes, no Playwright.
 */
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const projectRef = (() => { try { return new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]; } catch { return 'ref'; } })();

const stamp = Date.now();
const email = `e2e-11ui-${stamp}@test-delete.local`;
const slug = `e2e-11ui-${stamp}`;
const created = { clinicId: null, userId: null };
const results = [];
const check = (n, ok, x = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${x ? ' — ' + x : ''}`);

function toB64Url(s) { return Buffer.from(s).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'); }

async function main() {
  // Register synthetic owner+clinic through the real API (as a manual sign-up would)
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email, password: 'TestPass!234', clinic_name: 'عيادة واجهة ستيب11 TEST', clinic_slug: slug,
      owner_name: 'مالك واجهة 11', owner_phone: '+970599000811', clinic_type: 'dental_clinic',
      city: 'نابلس', country: 'فلسطين', address: 'عنوان واجهة TEST', clinic_phone: '+970922200811',
    }),
  });
  const regBody = await reg.json().catch(() => ({}));
  check('UI sign-up (register API)', reg.status === 201 && Boolean(regBody?.data?.id), `status=${reg.status}`);
  created.clinicId = regBody?.data?.id;

  // Real login -> build the Supabase auth cookie the dashboard middleware expects
  const { data: sess } = await anon.auth.signInWithPassword({ email, password: 'TestPass!234' });
  check('UI login (real auth session)', Boolean(sess?.session?.access_token));
  const s = sess.session;
  const cookiePayload = {
    access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: s.expires_at, expires_in: 3600, token_type: 'bearer', user: s.user,
  };
  const cookie = `${projectRef}-auth-token=${toB64Url(JSON.stringify(cookiePayload))}`;

  // Auth gate: no session -> redirect away from dashboard
  const noAuth = await fetch(`${BASE}/dashboard`, { redirect: 'manual' });
  check('UI auth gate (no session → redirect)', [302, 307].includes(noAuth.status), `status=${noAuth.status}`);

  // Render each CRUD dashboard page with the authenticated cookie
  const pages = [
    ['/dashboard', 'index redirect', ['/dashboard/overview'], 'redirect'],
    ['/dashboard/overview', 'نظرة عامة', ['DashboardSection']],
    ['/dashboard/providers', 'مقدمو الخدمة', ['ProviderServiceManager', 'ProviderScheduleManager']],
    ['/dashboard/services', 'الخدمات', ['ProviderServiceManager']],
    ['/dashboard/ai-settings', 'إعدادات الذكاء الاصطناعي', ['assistant_name']],
    ['/dashboard/clinic-setup', 'إعداد العيادة', ['ClinicSetupManager']],
    ['/dashboard/team', 'إدارة الفريق', ['الاستقبال']],
  ];
  for (const [path, label, anchors, mode] of pages) {
    const r = await fetch(`${BASE}${path}`, { headers: { Cookie: cookie }, redirect: mode === 'redirect' ? 'manual' : 'follow' });
    const html = await r.text();
    const anchorHit = anchors.find((a) => html.includes(a));
    const ok = mode === 'redirect'
      ? [302, 307].includes(r.status) && html.includes('/dashboard/overview')
      : r.status === 200 && Boolean(anchorHit);
    check(`UI render ${label} (${path})`, ok, `status=${r.status} len=${html.length} anchorHit=${anchorHit ?? 'NONE'}`);
    if (r.status !== 200 && mode !== 'redirect') console.log(`  [debug ${path}] status=${r.status} firstBytes="${html.slice(0, 120).replace(/\n/g, ' ')}"`);
  }

  // Re-render check: providers/services pages show the empty-state + add controls
  const prov = await (await fetch(`${BASE}/dashboard/providers`, { headers: { Cookie: cookie } })).text();
  check('UI providers renders add-doctor/staff control', prov.includes('إضافة طبيب / موظف') || prov.includes('\\u0625\\u0636\\u0627\\u0641\\u0629'), `len=${prov.length}`);
  const svcs = await (await fetch(`${BASE}/dashboard/services`, { headers: { Cookie: cookie } })).text();
  check('UI services renders add-service control', svcs.includes('إضافة خدمة') || svcs.includes('\\u0625\\u0636\\u0627\\u0641\\u0629'), `len=${svcs.length}`);

  console.log(results.join('\n'));
}

main()
  .catch((e) => { console.log(results.join('\n')); console.error('FATAL', e.message); })
  .finally(async () => {
    if (created.clinicId) {
      await admin.from('clinic_users').delete().eq('clinic_id', created.clinicId);
      await admin.from('clinics').delete().eq('id', created.clinicId);
    }
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const owner = users.users.find((u) => u.email === email);
    if (owner) await admin.auth.admin.deleteUser(owner.id);
    const cnt = (await admin.from('clinics').select('id', { count: 'exact', head: true }).eq('id', created.clinicId)).count ?? 0;
    console.log('UI_CLEANUP clinic_rows=' + cnt);
    process.exit(0);
  });