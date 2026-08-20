import fs from 'fs';

// Read .env.local without printing values
const content = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of content.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const baseUrl = env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const model = env.OLLAMA_MODEL || 'qwen2.5-coder:14b';

console.log('Ollama base URL:', baseUrl);
console.log('Model:', model);
console.log('Making REAL Ollama request...');

// First check available models
const tagsRes = await fetch(`${baseUrl}/api/tags`);
const tagsJson = await tagsRes.json();
const models = (tagsJson.models || []).map((m) => m.name);
console.log('Installed models:', models.join(', '));
if (!models.includes(model)) {
  console.log(`ERROR: Model "${model}" is NOT installed.`);
  process.exit(1);
}
console.log(`Model "${model}" is installed. Proceeding...`);

// Real generate request
const res = await fetch(`${baseUrl}/api/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    prompt: 'Say hello in one word.',
    stream: false,
    options: { num_predict: 20, temperature: 0.2 },
  }),
});

console.log('HTTP status:', res.status);

if (!res.ok) {
  const t = await res.text();
  console.log('ERROR BODY:', t.slice(0, 300));
  process.exit(1);
}

const json = await res.json();
const text = json.response || '';
console.log('Response received:', text ? 'YES' : 'NO');
console.log('Response text:', text);
console.log('Prompt eval count:', json.prompt_eval_count);
console.log('Eval count:', json.eval_count);
console.log('Done:', json.done);