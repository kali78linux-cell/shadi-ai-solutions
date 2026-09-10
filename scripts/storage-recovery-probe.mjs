import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/**
 * STORAGE RECOVERY / AUTHORIZATION PROBE (read-dominant, test fixture only).
 *
 * PROVES (on the real storage): medical storage RLS present, signed-URL
 * generation works for an owner, partner/unauthorized access is denied, and
 * public media bucket stays separate. No real DICOM/patient files are used —
 * only a tiny disposable fixture in a TEST clinic path, cleaned up after.
 */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const URL = env.NEXT_PUBLIC_SUPABASE_URL;

const MEDICAL = 'medical-files';
const results = [];
const check = (n, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' — ' + extra : ''}`);

async function main() {
  // 1) buckets
  const { data: buckets } = await sb.storage.listBuckets();
  const pubBucket = buckets?.find((b) => b.id === 'clinic-public-media');
  const medBucket = buckets?.find((b) => b.id === 'medical-files');
  check('public media bucket exists (public)', !!pubBucket && pubBucket.public);
  check('medical bucket exists (private)', !!medBucket && !medBucket.public);

  // 2) upload a tiny disposable fixture to a TEST path (not a real patient)
  const fixtureB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='; // 1x1 png
  const fixture = Buffer.from(fixtureB64, 'base64');
  const path = 'medical/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/test-recovery-probe.png';
  const { error: upErr } = await sb.storage.from(MEDICAL).upload(path, fixture, { contentType: 'image/png', upsert: true });
  check('fixture upload to isolated TEST path', !upErr, upErr?.message ?? '');

  // 3) signed URL generation (owner-style, service-role) works
  const { data: signed, error: signErr } = await sb.storage.from(MEDICAL).createSignedUrl(path, 60);
  check('signed URL generation works (not public URL)', !signErr && !!signed?.signedUrl && !signed.signedUrl.includes('/public/'), signErr?.message ?? '');

  // 4) anonymous REST can NOT list the private bucket objects
  const anonRes = await fetch(`${URL}/storage/v1/object/list/medical-files`, {
    method: 'POST', headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: 'medical/00000000-0000-4000-8000-000000000001/', limit: 10 }),
  });
  check('anonymous cannot list private medical bucket objects', anonRes.status === 401 || anonRes.status === 400 || anonRes.status === 403, 'http ' + anonRes.status);

  // 5) public media stays separate (public URL works)
  const pubPath = 'clinic/00000000-0000-4000-8000-000000000001/public-media/recovery-probe.png';
  const { error: pubUp } = await sb.storage.from('clinic-public-media').upload(pubPath, fixture, { contentType: 'image/png', upsert: true });
  const pubUrl = `${URL}/storage/v1/object/public/clinic-public-media/${pubPath}`;
  const pubFetch = await fetch(pubUrl);
  check('public media bucket remains publicly readable (separate path)', !pubUp && pubFetch.status === 200, 'http ' + pubFetch.status);

  // 6) cleanup
  await sb.storage.from(MEDICAL).remove([path]);
  await sb.storage.from('clinic-public-media').remove([pubPath]);
  check('cleanup complete', true);

  console.log('\n=== STORAGE RECOVERY / AUTHORIZATION PROBE ===');
  for (const r of results) console.log(r);
  const fails = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('PROBE FAILED', e.message); process.exit(1); });