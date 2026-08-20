import fs from 'fs';

const c = fs.readFileSync('.env.local', 'utf8');
const lines = c.split('\n');
const vars = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENAI_API_KEY', 'AI_PROVIDER', 'OLLAMA_BASE_URL', 'OLLAMA_MODEL'];

for (const v of vars) {
  const line = lines.find((l) => l.startsWith(v + '='));
  const val = line ? line.split('=').slice(1).join('=').trim() : '';
  const hasValue = val !== '' && !val.includes('your-') && !val.includes('00000000') && !val.includes('placeholder');
  console.log(v + ': ' + (line ? (hasValue ? 'PRESENT' : 'EMPTY/PLACEHOLDER') : 'MISSING'));
}