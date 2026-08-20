import fs from 'fs';

// Read .env.local without printing values
const content = fs.readFileSync('.env.local', 'utf8');
const env = {};
for (const line of content.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

const key = env.OPENAI_API_KEY;
if (!key) {
  console.log('OPENAI_API_KEY missing');
  process.exit(1);
}

const model = env.OPENAI_MODEL || 'gpt-4o-mini';
console.log('Model:', model);
console.log('Making REAL OpenAI request...');

const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${key}`,
  },
  body: JSON.stringify({
    model,
    messages: [{ role: 'user', content: 'Say hello in one word.' }],
    max_tokens: 20,
    temperature: 0.2,
  }),
});

console.log('HTTP status:', res.status);

if (!res.ok) {
  const t = await res.text();
  console.log('ERROR BODY:', t.slice(0, 200));
  process.exit(1);
}

const json = await res.json();
const text = json.choices?.[0]?.message?.content || '';
console.log('Response received:', text ? 'YES' : 'NO');
console.log('Response text:', text);
console.log('Model used:', json.model);
console.log('Usage:', JSON.stringify(json.usage));