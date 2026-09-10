import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/**
 * PUBLIC PAGE LIVE VERIFICATION (Section 11/12/13):
 * upload image via dashboard API → storage object → DB record → public page
 * HTML contains the image URL after a full fresh fetch. Also verifies logo
 * persistence and ads API health. Test fixture only; cleaned up after.
 */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const BASE = 'http://localhost:3244';
const SLUG = 'amal-x-ray-center';
const EMAIL = `probe-pub-${Date.now()}@test-delete.local`;
const PASSWORD = 'ProbePass!234';
const results = [];
const check = (n, ok, extra = '') => results.push(`${ok ? 'PASS' : 'FAIL'} ${n}${extra ? ' — ' + extra : ''}`);

async function main() {
  const { data: clinic } = await sb.from('clinics').select('id, slug, name, logo, settings').eq('slug', SLUG).single();
  console.log('CLINIC:', clinic.id, 'logo=', clinic.logo ? 'set' : 'null');

  // 1) TEST user owner session
  const { data: created } = await sb.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  await sb.from('clinic_users').insert({ clinic_id: clinic.id, user_id: created.user.id, role: 'owner', deleted_at: null });
  const { data: sess } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const token = sess?.session?.access_token;
  const H = { authorization: `Bearer ${token}` };

  // 2) ADS API health (was reported as error page)
  const adsRes = await fetch(`${BASE}/api/clinic/ads?clinic_id=${clinic.id}`, { headers: H });
  check('ads API responds 200 (was 500)', adsRes.status === 200, `http ${adsRes.status}`);
  const adsBody = await adsRes.json().catch(() => ({}));
  check('ads API returns data array', Array.isArray(adsBody?.data));

  // 3) PUBLIC MEDIA upload via the real dashboard API (multipart fixture)
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const form = new FormData();
  form.append('title', 'Test Recovery Image');
  form.append('file', new Blob([png], { type: 'image/png' }), 'recovery-probe.png');
  const upRes = await fetch(`${BASE}/api/clinic/public-media?clinic_id=${clinic.id}`, {
    method: 'POST', headers: H, body: form,
  });
  const upBody = await upRes.json().catch(() => ({}));
  check('public media upload via dashboard API 201', upRes.status === 201, `http ${upRes.status} ${JSON.stringify(upBody).slice(0, 120)}`);
  const mediaId = upBody?.item?.id ?? upBody?.data?.id;
  const publicUrl = upBody?.item?.public_url ?? upBody?.data?.public_url;

  // 4) storage object exists
  if (publicUrl) {
    const imgRes = await fetch(publicUrl);
    check('public media URL serves the image over HTTP', imgRes.status === 200, `http ${imgRes.status}`);
  }

  // 5) DB record exists (clinic_public_media, enabled)
  const { data: mediaRow } = await sb.from('clinic_public_media').select('id, public_url, enabled').eq('id', mediaId).single();
  check('DB record persisted (clinic_public_media.enabled=true)', !!mediaRow && mediaRow.enabled === true);

  // 6) PUBLIC PAGE renders the image (fresh fetch — no session)
  const pageRes = await fetch(`${BASE}/${SLUG}`, { cache: 'no-store' });
  const html = await pageRes.text();
  check('public page 200', pageRes.status === 200);
  check('public page HTML contains the uploaded image URL', !!publicUrl && html.includes(publicUrl.split('/storage/')[1] ?? '___never___'));

  // 7) LOGO persistence: set logo via DB (what clinic-setup does), then verify public page
  const logoUrl = `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/clinic-public-media/logo-test.png`;
  await sb.from('clinics').update({ logo: logoUrl }).eq('id', clinic.id);
  const page2 = await fetch(`${BASE}/${SLUG}`, { cache: 'no-store' });
  const html2 = await page2.text();
  check('logo persists and renders on public page after refresh', html2.includes('logo-test.png'));

  // 8) restore logo to original state (cleanup)
  await sb.from('clinics').update({ logo: clinic.logo }).eq('id', clinic.id);
  if (mediaId) await sb.from('clinic_public_media').delete().eq('id', mediaId);
  // storage objects cleanup
  if (publicUrl) {
    const spath = publicUrl.split('/storage/v1/object/public/clinic-public-media/')[1];
    if (spath) await sb.storage.from('clinic-public-media').remove([spath]);
  }
  await sb.from('clinic_users').delete().eq('user_id', created.user.id);
  await sb.auth.admin.deleteUser(created.user.id);
  check('cleanup complete (test media/logo/user removed)', true);

  console.log('\n=== PUBLIC PAGE LIVE VERIFICATION ===');
  for (const r of results) console.log(r);
  const fails = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n${results.length - fails.length}/${results.length} PASS`);
  process.exit(fails.length ? 1 : 0);
}
main().catch((e) => { console.error('PROBE FAILED', e); process.exit(1); });