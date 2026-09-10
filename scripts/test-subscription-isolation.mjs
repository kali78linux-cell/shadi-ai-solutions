// Verify tenant isolation + subscription flow for the demo clinic via authenticated owner token.
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
const BASE = process.env.BASE ?? 'http://localhost:3111';
const env = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = env.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const S_URL = get('NEXT_PUBLIC_SUPABASE_URL');
const ANON = get('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const DEMO = '3cf3e588-c044-4d91-8dc8-73118bf3afa3';
const SHADI = '7fe17ccd-8185-407a-8ec4-33bf6e357c2d';

const sdk = createClient(S_URL, ANON, { auth: { persistSession: false } });
const sess = await sdk.auth.signInWithPassword({ email: 'owner.modernsmile@demo.test', password: 'DemoSmile#2026' });
if (!sess.data?.session?.access_token) { console.log('signin failed'); process.exit(1); }
const token = sess.data.session.access_token;
const api = async (path, { method = 'GET', body } = {}) => {
  const h = { 'content-type': 'application/json', authorization: `Bearer ${token}` };
  const r = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
  let b = null; try { b = await r.json(); } catch {}
  return { status: r.status, body: b };
};

// Cross-clinic isolation: demo owner must be FORBIDDEN from Shadi clinic resources.
const forbid = [];
for (const p of ['/api/booking/providers', '/api/clinic/providers', '/api/patients']) {
  const r = await api(`${p}?clinic_id=${SHADI}`);
  forbid.push(`${p}:${r.status}`);
}
console.log('SHADI_ACCESS_FROM_DEMO_OWNER=' + JSON.stringify(forbid));

// Demo owner can read their own clinic.
const mine = await api(`/api/clinic/providers?clinic_id=${DEMO}`);
console.log('OWN_CLINIC_PROVIDERS=' + (mine.body?.data?.length ?? 'ERR'));

// Subscription GET returns plan.
const subGet = await api(`/api/clinic/subscription?clinic_id=${DEMO}`);
console.log('SUB_GET=' + subGet.status + ' ' + JSON.stringify(subGet.body?.data?.plan || subGet.body));

// Free plans via the records endpoint are allowed.
const subTrial = await api(`/api/clinic/subscription?clinic_id=${DEMO}`, { method: 'POST', body: { plan_id: 'free_trial' } });
console.log('SUB_POST_FREE=' + subTrial.status + ' ' + JSON.stringify(subTrial.body));

// Paid plans must go through checkout — self-grant is closed (STEP 15A).
const subPaid = await api(`/api/clinic/subscription?clinic_id=${DEMO}`, { method: 'POST', body: { plan_id: 'growth' } });
console.log('SUB_POST_PAID_REJECTED=' + subPaid.status + ' ' + JSON.stringify(subPaid.body));

// Invalid plan rejected.
const bad = await api(`/api/clinic/subscription?clinic_id=${DEMO}`, { method: 'POST', body: { plan_id: 'nope' } });
console.log('SUB_BAD_PLAN=' + bad.status);

process.exit(0);