/**
 * PP-8B-i — apply the provider public profile migration (idempotent).
 * Same pattern as scripts/apply-provider-visibility.mjs: applies ONLY this
 * phase's migration via the Supabase Management API, then probes the schema.
 * Never prints secrets.
 *
 * Run: node scripts/apply-provider-public-profile.mjs
 */
import fs from 'fs';

const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || get('SUPABASE_ACCESS_TOKEN');

if (!url || url.includes('your-') || url.includes('placeholder')) {
  console.log('APPLY: BLOCKED — real URL missing');
  process.exit(1);
}
if (!accessToken) {
  console.log('APPLY: BLOCKED — SUPABASE_ACCESS_TOKEN missing');
  process.exit(1);
}

const ref = url.replace('https://', '').split('.')[0];
const apiBase = 'https://api.supabase.com/v1/projects';
const query = async (sql) => {
  const res = await fetch(`${apiBase}/${ref}/database/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  return { ok: res.ok, text };
};

const sql = fs.readFileSync('db/migrations/20260913_provider_public_profile.sql', 'utf8');
console.log('=== Applying 20260913_provider_public_profile.sql ===');
const apply = await query(sql);
if (!apply.ok) {
  console.log(`FAILED: ${apply.text.slice(0, 500)}`);
  process.exit(1);
}
console.log('APPLY_OK');

const probe = await query(
  "select column_name, data_type, is_nullable from information_schema.columns where table_schema='public' and table_name='providers' and column_name in ('public_slug','specialty','bio','photo_url') order by column_name"
);
console.log('COLUMNS:', probe.ok ? probe.text : `FAILED: ${probe.text.slice(0, 300)}`);

const idx = await query(
  "select indexname from pg_indexes where schemaname='public' and tablename='providers' and indexname='providers_public_slug_key'"
);
console.log('UNIQUE INDEX:', idx.ok ? idx.text : `FAILED: ${idx.text.slice(0, 300)}`);

const slugs = await query('select count(*)::int as with_slug from public.providers where public_slug is not null');
console.log('SLUGS (must be 0 — nothing becomes public in PP-8B-i):', slugs.ok ? slugs.text : `FAILED: ${slugs.text.slice(0, 300)}`);

const rls = await query("select c.relname, c.relrowsecurity from pg_class c where c.relname = 'providers'");
console.log('RLS still enabled:', rls.ok ? rls.text : `FAILED: ${rls.text.slice(0, 300)}`);

console.log('=== PP-8B-i MIGRATION DONE ===');
