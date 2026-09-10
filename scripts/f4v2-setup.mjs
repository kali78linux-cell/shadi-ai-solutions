import fs from 'fs';
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const BASE = 'http://localhost:3210';
const stamp = Date.now();
const email = `e2e-f4v2-${stamp}@test-delete.local`;
const slug = `e2e-f4v2-${stamp}`;
const r = await fetch(`${BASE}/api/auth/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'TestPass!234', clinic_name: 'عيادة F4V2', clinic_slug: slug, owner_name: 'مالك', owner_phone: '+970599000111', clinic_type: 'dental_clinic', city: 'نابلس', country: 'فلسطين' }),
});
const body = await r.json().catch(() => ({}));
if (!r.ok || !body?.data?.id) { console.log('REG_FAIL', r.status, JSON.stringify(body).slice(0, 200)); process.exit(1); }
const clinic = body.data.id;
const sign = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { 'content-type': 'application/json', apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  body: JSON.stringify({ email, password: 'TestPass!234' }),
}).then((x) => x.json());
if (!sign.access_token) { console.log('LOGIN_FAIL'); process.exit(1); }
const co = await fetch(`${BASE}/api/payments/checkout?clinic_id=${clinic}`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${sign.access_token}` },
  body: JSON.stringify({ plan_id: 'growth' }),
});
const cj = await co.json().catch(() => ({}));
fs.writeFileSync('/tmp/f4sec/v2_clinic', clinic);
fs.writeFileSync('/tmp/f4sec/v2_email', email);
fs.writeFileSync('/tmp/f4sec/v2_session', cj.session_id || '');
console.log('SETUP', JSON.stringify({ register: r.status, checkout: co.status, clinic: clinic.slice(0, 8), session: String(cj.session_id || '').slice(0, 14) }));