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

async function generate(prompt) {
  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { num_predict: 200, temperature: 0.2 },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Ollama error ${res.status}: ${t.slice(0, 200)}`);
  }
  const json = await res.json();
  return json.response || '';
}

// Arabic test
console.log('=== ARABIC TEST ===');
const arabicPrompt = `You are a helpful AI assistant for a dental clinic.
Answer the user's question based ONLY on the following information.
If the information to answer the question is not in the context, say "I'm sorry, I don't have that information." and do not add any other details.
Be concise and professional.

Context:
---
[Source: knowledge base, ID: N/A, Chunk: N/A]
We offer dental cleaning services. Our clinic is open Monday to Friday from 9am to 5pm.
---

Question: مرحبا، بدي أحجز موعد لتنظيف الأسنان`;

const arabicResponse = await generate(arabicPrompt);
console.log('Response received:', arabicResponse ? 'YES' : 'NO');
console.log('Response:', arabicResponse);

// English test
console.log('\n=== ENGLISH TEST ===');
const englishPrompt = `You are a helpful AI assistant for a dental clinic.
Answer the user's question based ONLY on the following information.
If the information to answer the question is not in the context, say "I'm sorry, I don't have that information." and do not add any other details.
Be concise and professional.

Context:
---
[Source: knowledge base, ID: N/A, Chunk: N/A]
We offer dental cleaning services. Our clinic is open Monday to Friday from 9am to 5pm.
---

Question: Hello, I want to book a dental cleaning appointment.`;

const englishResponse = await generate(englishPrompt);
console.log('Response received:', englishResponse ? 'YES' : 'NO');
console.log('Response:', englishResponse);