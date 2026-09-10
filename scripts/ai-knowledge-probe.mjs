import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/** LIVE behavioral probe: ask the imaging center's public AI about pricing. */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const BASE = 'http://localhost:3244';
const SLUG = 'amal-x-ray-center';

async function main() {
  // 1) verify tenant resolution — no demo fallback
  const res = await fetch(`${BASE}/api/booking/clinic?slug=${SLUG}`);
  const clinic = (await res.json())?.data;
  console.log('TENANT:', clinic?.id, '·', clinic?.name);

  // 2) send the pricing question through the public AI endpoint
  const post = await fetch(`${BASE}/api/public/ai/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ clinic_slug: SLUG, text: 'كم سعر صورة البانوراما؟' }),
  });
  const status = post.status;
  const body = await post.json().catch(() => null);
  const reply = body?.assistant_message?.content ?? body?.message ?? JSON.stringify(body).slice(0, 300);
  console.log('HTTP', status);
  console.log('REPLY:', typeof reply === 'string' ? reply.slice(0, 400) : JSON.stringify(reply).slice(0, 400));

  // 3) checks
  const has30 = typeof reply === 'string' && /30/.test(reply);
  const unavailable = typeof reply === 'string' && (reply.includes('غير متوفر') || reply.includes('غير متوفرة'));
  console.log('\nCHECK price=30 mentioned:', has30);
  console.log('CHECK "not available" hallucination avoided:', !unavailable || has30);
}
main().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });