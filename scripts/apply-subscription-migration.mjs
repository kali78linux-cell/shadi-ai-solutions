// Apply ONLY the additive subscription unique index via the Supabase admin query API.
import fs from 'fs';
const c = fs.readFileSync('.env.local', 'utf8');
const get = (k) => { const l = c.split('\n').find((x) => x.startsWith(k + '=')); return l ? l.split('=').slice(1).join('=').trim() : ''; };
const url = get('NEXT_PUBLIC_SUPABASE_URL');
const accessToken = get('SUPABASE_ACCESS_TOKEN');
if (!url || !accessToken || url.includes('example')) { console.log('BLOCKED'); process.exit(1); }
const ref = url.replace('https://', '').split('.')[0];
const sql = fs.readFileSync('supabase/migrations/202608240003_subscription_stripe_columns.sql', 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify({ query: sql }),
});
const text = await res.text();
console.log(`STATUS=${res.status}`);
console.log(text.slice(0, 800));
process.exit(0);