import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

/** Deterministic anon-access test WITH an existing object present. */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function main() {
  const path = 'medical/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/present-anon-test.png';
  await sb.storage.from('medical-files').upload(path, Buffer.alloc(64, 9), { contentType: 'image/png', upsert: true });

  // anon list WITH object present — does RLS hide it?
  const r = await fetch(`${URL}/storage/v1/object/list/medical-files`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: 'medical/00000000-0000-4000-8000-000000000001/', limit: 10 }),
  });
  const body = await r.text();
  console.log('ANON LIST (object present) http', r.status);
  console.log('ANON LIST body length', body.length, body.slice(0, 200));

  const a = await fetch(`${URL}/storage/v1/object/public/medical-files/${path}`);
  const b = await fetch(`${URL}/storage/v1/object/authenticated/medical-files/${path}`, { headers: { apikey: ANON } });
  console.log('ANON GET public http', a.status);
  console.log('ANON GET authenticated http', b.status);

  await sb.storage.from('medical-files').remove([path]);
  console.log('cleaned');
}
main().catch((e) => { console.error(e); process.exit(1); });