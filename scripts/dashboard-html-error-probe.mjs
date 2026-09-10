import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/** Scan rendered dashboard HTML for runtime error markers per module. */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const BASE = 'http://localhost:3244';
const SLUG = 'amal-x-ray-center';
const EMAIL = `probe-html-${Date.now()}@test-delete.local`;
const PASSWORD = 'ProbePass!234';

const MODULES = ['overview', 'appointments', 'patients', 'conversations', 'knowledge-base',
  'providers', 'services', 'team', 'notifications', 'analytics', 'ai-settings',
  'communication-settings', 'ads', 'clinic-setup', 'public-page', 'subscription',
  'imaging-requests', 'referring-clinics'];

const ERR_MARKERS = [
  'حدث خطأ غير متوقع',
  'تعذر تحميل هذا القسم',
  'Application error',
  'Unhandled Runtime Error',
  '__next_error__',
];

async function main() {
  const { data: clinic } = await sb.from('clinics').select('id, slug').eq('slug', SLUG).single();
  const { data: created, error } = await sb.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (error) { console.log('CREATE FAIL', error.message); process.exit(1); }
  await sb.from('clinic_users').insert({ clinic_id: clinic.id, user_id: created.user.id, role: 'owner', deleted_at: null });
  const { data: sess } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const token = sess?.session?.access_token;

  let totalBad = 0;
  for (const mod of MODULES) {
    const res = await fetch(`${BASE}/dashboard/${SLUG}/${mod}`, { headers: { authorization: `Bearer ${token}` } });
    const html = await res.text();
    const found = ERR_MARKERS.filter((m) => html.includes(m));
    const ok = res.status === 200 && found.length === 0;
    if (!ok) totalBad++;
    console.log(`${ok ? 'OK  ' : 'BAD '} ${res.status} ${mod}${found.length ? ' → ' + found.join(', ') : ''}`);
  }

  await sb.from('clinic_users').delete().eq('user_id', created.user.id);
  await sb.auth.admin.deleteUser(created.user.id);
  console.log(totalBad === 0 ? '\nALL MODULES CLEAN — 0 runtime errors' : `\n${totalBad} modules with runtime errors`);
  process.exit(totalBad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });