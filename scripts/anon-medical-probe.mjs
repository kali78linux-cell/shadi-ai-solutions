import fs from 'fs';

/** In-depth anonymous attack-surface probe on the private medical bucket. */
const env = Object.fromEntries(
  fs.readFileSync('/home/shadi/Downloads/shadi-ai-solutions/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const MED = 'medical-files';

async function main() {
  // make a fixture
  const fixture = Buffer.alloc(512, 7);
  const path = 'medical/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002/probe-read.png';

  // 1) anon LIST on the private bucket
  const rList = await fetch(`${URL}/storage/v1/object/list/${MED}`, {
    method: 'POST',
    headers: { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' },
    body: JSON.stringify({ prefix: 'medical/00000000-0000-4000-8000-000000000001/', limit: 10 }),
  });
  console.log('ANON LIST http', rList.status);
  console.log('ANON LIST body:', (await rList.text()).slice(0, 400));

  // 2) anon DOWNLOAD a known object → does it leak?
  const rGet = await fetch(`${URL}/storage/v1/object/public/${MED}/${path}`);
  console.log('\nANON DOWNLOAD (public route) http', rGet.status, 'len', (await rGet.arrayBuffer()).byteLength);

  const rGet2 = await fetch(`${URL}/storage/v1/object/${MED}/${path}`);
  console.log('ANON DOWNLOAD (authenticated route) http', rGet2.status);
}
main().catch((e) => { console.error(e); process.exit(1); });