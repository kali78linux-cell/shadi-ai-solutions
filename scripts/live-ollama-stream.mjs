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

console.log('=== REAL OLLAMA STREAMING TEST ===');
console.log(`Model: ${model}`);
console.log(`Base URL: ${baseUrl}`);

const res = await fetch(`${baseUrl}/api/generate`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    prompt: 'Count from 1 to 5, one number per line.',
    stream: true,
    options: { num_predict: 100, temperature: 0.2 },
  }),
});

console.log('HTTP status:', res.status);
if (!res.ok) {
  const t = await res.text();
  console.log('ERROR BODY:', t.slice(0, 300));
  process.exit(1);
}

console.log('Reading stream...');
const reader = res.body.getReader();
const decoder = new TextDecoder();
let fullText = '';
let chunkCount = 0;

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  const chunk = decoder.decode(value, { stream: true });
  // Ollama NDJSON: each line contains { "response": "..." }
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      if (typeof json.response === 'string' && json.response) {
        fullText += json.response;
        chunkCount++;
        process.stdout.write(json.response);
      }
    } catch {
      // skip partial lines
    }
  }
}

console.log('\n');
console.log('Stream completed. Chunks received:', chunkCount);
console.log('Full text non-empty:', fullText.trim().length > 0 ? 'YES' : 'NO');
console.log('Full text:', fullText.trim());