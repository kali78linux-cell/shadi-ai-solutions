import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function run(command, args, opts = {}) {
  return execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=4096',
      ...opts.env,
    },
  });
}

function print(label, value) {
  console.log(`${label}: ${value}`);
}

const env = process.env;
const hasSupabaseUrl = Boolean(env.NEXT_PUBLIC_SUPABASE_URL);
const hasSupabaseAnonKey = Boolean(env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const hasServiceRoleKey = Boolean(env.SUPABASE_SERVICE_ROLE_KEY);
const hasEmbeddingProvider = Boolean(env.OPENAI_API_KEY || env.GEMINI_API_KEY);

print('Environment', 'starting knowledge ingestion verification');
print('NEXT_PUBLIC_SUPABASE_URL', hasSupabaseUrl ? 'configured' : 'missing');
print('NEXT_PUBLIC_SUPABASE_ANON_KEY', hasSupabaseAnonKey ? 'configured' : 'missing');
print('SUPABASE_SERVICE_ROLE_KEY', hasServiceRoleKey ? 'configured' : 'missing');
print('OpenAI/Gemini API key', hasEmbeddingProvider ? 'configured' : 'missing');

async function verifySupabaseConnection() {
  if (!hasSupabaseUrl || !hasSupabaseAnonKey || !hasServiceRoleKey) {
    print('Supabase connection', 'skipped - env not fully configured');
    return false;
  }

  const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const { error } = await client.from('clinic_ai_knowledge').select('id').limit(1);
    if (error) throw error;
    print('Supabase connection', 'success');
    return true;
  } catch (error) {
    print('Supabase connection', `failed - ${error?.message || error}`);
    return false;
  }
}

try {
  await verifySupabaseConnection();

  const output = run('npx', [
    'vitest',
    'run',
    'tests/knowledge/knowledge-ingestion.test.ts',
    '--pool',
    'threads',
    '--poolOptions.threads.singleThread',
    'true',
    '--maxWorkers=1',
    '--minWorkers=1',
    '--no-file-parallelism',
  ]);
  console.log(output);
  console.log('Knowledge ingestion verification completed successfully.');
} catch (error) {
  console.error('Knowledge ingestion verification failed.');
  console.error(error.stdout?.toString() || error.message || error);
  process.exit(1);
}
