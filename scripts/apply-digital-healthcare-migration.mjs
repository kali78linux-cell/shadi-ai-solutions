/**
 * Digital Healthcare Space — apply migration 20260914_digital_healthcare_space.sql
 * and verify (activity_type column/enum, new domain tables, RLS on them, tenant
 * backfill stays 'clinic' for existing rows). Idempotent. Never prints secrets.
 * Run: node scripts/apply-digital-healthcare-migration.mjs
 */
import fs from 'fs';

const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => {
  const line = c.split('\n').find((l) => l.startsWith(k + '='));
  return line ? line.split('=').slice(1).join('=').trim() : '';
};

const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = process.env.SUPABASE_ACCESS_TOKEN || get('SUPABASE_ACCESS_TOKEN');
if (!url || url.includes('placeholder') || !accessToken) {
  console.log('BLOCKED: missing url/token');
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

const sql = fs.readFileSync('db/migrations/20260914_digital_healthcare_space.sql', 'utf8');
console.log('=== Applying 20260914_digital_healthcare_space.sql ===');
const apply = await query(sql);
if (!apply.ok) { console.log('FAILED: ' + apply.text.slice(0, 600)); process.exit(1); }
console.log('APPLY_OK');

const col = await query(
  "select column_name, data_type, column_default from information_schema.columns where table_schema='public' and table_name='clinics' and column_name='activity_type'"
);
console.log('COLUMN:', col.ok ? col.text : 'ERR ' + col.text.slice(0, 200));

const en = await query('select enum_range(null::public.activity_type)');
console.log('ENUM:', en.ok ? en.text : 'ERR ' + en.text.slice(0, 200));

const tenants = await query('select activity_type, count(*)::int from public.clinics group by activity_type order by activity_type');
console.log('TENANTS:', tenants.ok ? tenants.text : 'ERR ' + tenants.text.slice(0, 200));

const tables = await query(
  "select tablename from pg_tables where schemaname='public' and tablename in ('imaging_services','imaging_requests','lab_services','lab_cases') order by tablename"
);
console.log('DOMAIN TABLES:', tables.ok ? tables.text : 'ERR ' + tables.text.slice(0, 200));

const rls = await query(
  "select tablename, rowsecurity from pg_tables where schemaname='public' and tablename in ('imaging_services','imaging_requests','lab_services','lab_cases') order by tablename"
);
console.log('RLS:', rls.ok ? rls.text : 'ERR ' + rls.text.slice(0, 200));
console.log('=== DONE ===');