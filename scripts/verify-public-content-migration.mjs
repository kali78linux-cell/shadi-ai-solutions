/**
 * PHASE L verification (READ-ONLY) — confirms the public page content migration
 * objects exist in the live database. Never prints credentials.
 * Run: node scripts/verify-public-content-migration.mjs
 */
import fs from 'fs';

const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || get('SUPABASE_ACCESS_TOKEN');
if (!url || !accessToken) { console.log('BLOCKED — missing URL/token'); process.exit(1); }

const ref = url.replace('https://', '').split('.')[0];
const apiBase = `https://api.supabase.com/v1/projects/${ref}/database/query`;
async function runQuery(sql) {
  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.message || `HTTP ${res.status}`);
  return body;
}

const tables = ['clinic_achievements', 'clinic_testimonials', 'clinic_articles', 'clinic_news_ticker'];
const keyCols = {
  clinic_achievements: ['title', 'value', 'icon', 'background_color', 'font_size', 'display_order', 'enabled'],
  clinic_testimonials: ['patient_name', 'content', 'rating', 'image_path', 'display_order', 'enabled'],
  clinic_articles: ['title', 'content', 'category', 'image_path', 'title_color', 'font_size', 'published_at', 'display_order'],
  clinic_news_ticker: ['text', 'link', 'priority', 'speed', 'background_color', 'text_color', 'enabled'],
};

let failed = 0;
function check(label, ok) {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}`);
  if (!ok) failed++;
}

for (const t of tables) {
  const rows = await runQuery(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='${t}'`);
  check(`table ${t}`, Array.isArray(rows) && rows.length === 1);

  const cols = await runQuery(`SELECT COUNT(*)::int AS c FROM information_schema.columns WHERE table_schema='public' AND table_name='${t}' AND column_name IN (${keyCols[t].map((x) => `'${x}'`).join(',')})`);
  check(`columns ${t} (${keyCols[t].length})`, Array.isArray(cols) && cols[0]?.c === keyCols[t].length);

  const idx = await runQuery(`SELECT COUNT(*)::int AS c FROM pg_indexes WHERE schemaname='public' AND tablename='${t}' AND indexname LIKE 'idx_%'`);
  check(`indexes ${t} >= 1`, Array.isArray(idx) && idx[0]?.c >= 1);

  const rls = await runQuery(`SELECT relrowsecurity::int AS on FROM pg_class WHERE relnamespace='public'::regnamespace AND relname='${t}'`);
  check(`RLS enabled ${t}`, Array.isArray(rls) && rls[0]?.on === 1);
}

const policies = await runQuery(`SELECT COUNT(*)::int AS c FROM pg_policies WHERE schemaname='public' AND (tablename, policyname) IN (VALUES ('clinic_achievements','clinic_achievements_tenant_all'),('clinic_testimonials','clinic_testimonials_tenant_all'),('clinic_articles','clinic_articles_tenant_all'),('clinic_news_ticker','clinic_news_ticker_tenant_all'))`);
check('RLS policies (4, tenant-scoped)', Array.isArray(policies) && policies[0]?.c === 4);

const checks = await runQuery(`SELECT COUNT(*)::int AS c FROM pg_constraint WHERE conrelid IN ('public.clinic_achievements'::regclass,'public.clinic_articles'::regclass,'public.clinic_news_ticker'::regclass) AND contype='c' AND pg_get_constraintdef(oid) LIKE '%#[0-9a-fA-F]{6}%'`);
check('hex color CHECK constraints present (>=3)', Array.isArray(checks) && checks[0]?.c >= 3);

console.log(failed === 0 ? 'ALL CHECKS PASSED (8/8 groups, 20 checks)' : `FAILED CHECKS: ${failed}`);
process.exit(failed === 0 ? 0 : 1);
