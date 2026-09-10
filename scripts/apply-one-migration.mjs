/**
 * Applies ONE idempotent SQL migration through the Supabase Management API
 * and verifies the expected objects exist afterwards. Prints PASS/FAIL per
 * check; NEVER prints credentials or tokens.
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

const FILE = process.argv[2];
if (!FILE || !fs.existsSync(FILE)) { console.log('BLOCKED — pass a valid .sql path'); process.exit(1); }

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

console.log(`Applying ${FILE} ...`);
try {
  await runQuery(fs.readFileSync(FILE, 'utf8'));
  console.log('APPLY: OK');
} catch (e) {
  console.log('APPLY FAILED:', e.message);
  process.exit(1);
}

// Verification queries (additive schema presence + widened constraint)
const checks = [
  ['clinics.city column', "SELECT 1 FROM information_schema.columns WHERE table_name='clinics' AND column_name='city'"],
  ['clinics.latitude column', "SELECT 1 FROM information_schema.columns WHERE table_name='clinics' AND column_name='latitude'"],
  ['clinics.longitude column', "SELECT 1 FROM information_schema.columns WHERE table_name='clinics' AND column_name='longitude'"],
  ['clinics.area column', "SELECT 1 FROM information_schema.columns WHERE table_name='clinics' AND column_name='area'"],
  ['schedules.shifts column', "SELECT 1 FROM information_schema.columns WHERE table_name='provider_schedules' AND column_name='shifts'"],
  ["roles include receptionist", "SELECT 1::int AS ok WHERE EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.providers'::regclass AND pg_get_constraintdef(oid) LIKE '%receptionist%')"],
];

let failed = false;
for (const [name, sql] of checks) {
  try {
    const rows = await runQuery(sql);
    const ok = Array.isArray(rows) && rows.length > 0;
    console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}`);
    if (!ok) failed = true;
  } catch (e) {
    console.log(`FAIL | ${name} | ${e.message}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
