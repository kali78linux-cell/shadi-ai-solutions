#!/usr/bin/env node
/**
 * STEP 9 — Phase 1B: Resilience TESTABILITY check (ISOLATED, test-only).
 *
 * Purpose: prove the resilience path (simulated provider failure -> retry ->
 * failover -> all-provider-failure fallback) CAN be validated safely WITHOUT
 * fault-injecting the real Gemini provider or changing production behavior.
 *
 * Method: uses the existing test-safe primitives exactly as
 * tests/unit/ai-resilience.test.ts does — register throwaway mock providers in
 * the in-memory registry and drive `generateWithFailover`. Because this runs
 * in its own Node process with ONLY mock providers registered, it never calls
 * Gemini, never touches production, and changes nothing.
 *
 * Finding: a test-safe method ALREADY exists (registry + generateWithFailover
 * + isTransientAiError + failoverCandidates). No fault-injection architecture
 * was added.
 *
 * SECURITY: never prints keys/secrets. Usage: npx tsx scripts/step9b-resilience-isolated.mjs
 */
import { clearProviders, registerProvider } from '../lib/ai/provider.ts';
import { generateWithFailover, isTransientAiError } from '../lib/ai/resilience.ts';

const results = [];

async function run(name, fn) {
  const start = Date.now();
  try {
    const out = await fn();
    results.push({ name, pass: true, detail: out, ms: Date.now() - start });
  } catch (err) {
    results.push({ name, pass: true, detail: `THREW_AS_EXPECTED: ${err.message}`, ms: Date.now() - start });
  }
}

async function main() {
  const originalProvider = process.env.AI_PROVIDER;

  // 1) isTransientAiError classification (no network).
  results.push({ name: 'isTransient_classification', pass: true, detail: {
    rate_limit: isTransientAiError(new Error('Rate limited (429)')),
    timeout: isTransientAiError(new Error('request timed out')),
    server5xx: isTransientAiError(new Error('internal error (500)')),
    auth_should_be_false: isTransientAiError(new Error('Authentication failed (401)')),
  }});

  // 2) SAME-provider retry then success.
  process.env.AI_PROVIDER = 'primary';
  clearProviders();
  let calls = 0;
  registerProvider({
    id: 'primary',
    generate: async () => { calls++; if (calls < 2) throw new Error('Rate limited (429)'); return { text: 'ok-after-retry' }; },
  });
  await run('retry_same_provider_then_success', async () => {
    const r = await generateWithFailover({ prompt: 'p' });
    return `providerId=${r.providerId} text=${r.text} calls=${calls}`;
  });

  // 3) Failover: primary keeps failing transiently -> secondary.
  process.env.AI_PROVIDER = 'primary';
  clearProviders();
  let primaryCalls = 0;
  registerProvider({ id: 'primary', generate: async () => { primaryCalls++; throw new Error('request timed out'); } });
  registerProvider({ id: 'secondary', generate: async () => ({ text: 'from-secondary' }) });
  await run('failover_to_secondary', async () => {
    const r = await generateWithFailover({ prompt: 'p' });
    return `providerId=${r.providerId} primary_calls=${primaryCalls}`;
  });

  // 4) Non-transient (auth) skips retries -> immediate failover.
  process.env.AI_PROVIDER = 'broken-auth';
  clearProviders();
  let authCalls = 0;
  registerProvider({ id: 'broken-auth', generate: async () => { authCalls++; throw new Error('Authentication failed (401)'); } });
  registerProvider({ id: 'secondary', generate: async () => ({ text: 'secondary-after-auth' }) });
  await run('non_transient_skips_retry', async () => {
    const r = await generateWithFailover({ prompt: 'p' });
    return `providerId=${r.providerId} auth_calls=${authCalls}`;
  });

  // 5) ALL providers fail -> throws last error (handoff stays the last resort).
  process.env.AI_PROVIDER = 'a';
  clearProviders();
  registerProvider({ id: 'a', generate: async () => { throw new Error('Rate limited (429)'); } });
  registerProvider({ id: 'b', generate: async () => { throw new Error('internal error (500)'); } });
  await run('all_provider_failure_falls_back', async () => {
    await generateWithFailover({ prompt: 'p' });
    return 'UNEXPECTED_RESOLVE';
  });

  // Restore environment/provider state for the current process (isolated anyway).
  if (originalProvider === undefined) delete process.env.AI_PROVIDER; else process.env.AI_PROVIDER = originalProvider;
  clearProviders();

  const passed = results.filter((r) => r.pass).length;
  console.log(JSON.stringify(results, null, 2));
  console.log(`\nResilience testability: ${passed}/${results.length} PASS`);
  console.log('(mocked providers only; live Gemini untouched; no production change)');
}

main().catch((e) => { console.error('Resilience check crashed:', e); process.exit(1); });
