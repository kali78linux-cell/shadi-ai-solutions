import fs from 'fs';
const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = c.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = get('SUPABASE_ACCESS_TOKEN');
if (!url || !accessToken || url.includes('example')) { console.log('BLOCKED'); process.exit(1); }
const ref = url.replace('https://', '').split('.')[0];
const sql = fs.readFileSync('supabase/migrations/202608240005_flexible_service_pricing.sql', 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ query: sql }),
});
console.log('STATUS=' + res.status);
console.log((await res.text()).slice(0, 400));
