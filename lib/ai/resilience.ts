import { getProvider, listProviders, type GenerateParams, type GenerateResult } from './provider';
import { logEvent } from '@/lib/server/logging';

/**
 * AI PROVIDER RESILIENCE (Phase 12)
 *
 * Problem: a single `provider.generate()` call meant ANY transient failure
 * (429 rate limit, timeout, network blip) immediately degraded the patient
 * experience to the human-handoff fallback — a provider hiccup became a
 * lost conversation turn.
 *
 * Fix (bounded, no new credentials, fits the existing registry):
 *  1. Limited retries per provider for TRANSIENT errors with exponential
 *     backoff (300ms → 900ms).
 *  2. Failover to the NEXT configured registered provider before giving up.
 *  3. Non-transient errors (auth/permission/malformed request) skip retries
 *     and move straight to failover.
 *  4. The human-handoff fallback remains the LAST resort — unchanged.
 *
 * Deliberate policy: local Ollama is EXCLUDED from automatic failover. It is
 * documented as unsuitable for production conversational Arabic; silently
 * failing over to it would degrade reply quality without anyone noticing.
 * It remains fully usable when explicitly selected via AI_PROVIDER=ollama.
 */

const MAX_ATTEMPTS_PER_PROVIDER = 2;
const BACKOFF_MS = [300, 900];

/** Matches transient provider/HTTP failures worth retrying or failing over. */
const TRANSIENT_ERROR = /timed?\s*out|timeout|rate limit|429|too many requests|internal error|500|bad gateway|502|unavailable|503|504|overloaded|aborted|abort|network|econn|socket|fetch failed|temporarily/i;

export function isTransientAiError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return TRANSIENT_ERROR.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Providers eligible for automatic failover, ordered: preferred id → the
 * AI_PROVIDER-configured default → other registered cloud providers.
 * Ollama is only included when it IS the explicitly configured provider.
 */
export function failoverCandidates(preferredProviderId?: string | null): Array<{ id: string; provider: NonNullable<ReturnType<typeof getProvider>> }> {
  const all = listProviders();
  const configured = process.env.AI_PROVIDER ?? 'openai';

  const ordered: Array<{ id: string; provider: NonNullable<ReturnType<typeof getProvider>> }> = [];
  const pushUnique = (id: string): void => {
    if (ordered.some((c) => c.id === id)) return;
    const provider = all.find((p) => p.id === id);
    if (provider) ordered.push({ id, provider });
  };

  if (preferredProviderId) pushUnique(preferredProviderId);
  pushUnique(configured);
  for (const p of all) {
    // Automatic failover never lands on local Ollama unless it is the
    // explicitly configured provider (already pushed above).
    if (p.id === 'ollama' && configured !== 'ollama' && preferredProviderId !== 'ollama') continue;
    pushUnique(p.id);
  }
  return ordered;
}

export type FailoverGenerateResult = GenerateResult & { providerId: string };

/**
 * generate() with bounded retry + secondary-provider failover.
 * Throws the LAST error when every candidate fails (callers keep their
 * existing graceful-degradation path).
 */
export type OpenStreamResult = {
  stream: ReadableStream<Uint8Array>;
  providerId: string;
};

/**
 * Resilient OPEN of a provider stream (STEP 8 reliability).
 *
 * Only the stream handshake (the `provider.stream()` call that materializes a
 * ReadableStream) can be retried/failed over — once bytes start flowing we
 * cannot switch providers mid-stream. Transit failures get bounded retry +
 * backoff on the same provider, then failover to the next registered provider
 * that actually implements `stream()`. Returns the first successful stream.
 * Throws the LAST error when every streaming candidate fails so callers keep
 * their existing graceful-degradation path.
 */
export async function openStreamWithFailover(params: GenerateParams & { preferredProviderId?: string | null }): Promise<OpenStreamResult> {
  const { preferredProviderId, ...generateParams } = params;
  const candidates = failoverCandidates(preferredProviderId).filter((c) => typeof c.provider.stream === 'function');
  let lastError: unknown = new Error('No streaming AI provider is registered');

  for (const candidate of candidates) {
    const streamFn = candidate.provider.stream!;
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
      try {
        const stream = await streamFn(generateParams);
        if (attempt > 0 || candidates[0].id !== candidate.id) {
          logEvent('ai_stream_failover_succeeded', { provider: candidate.id, attempt });
        }
        return { stream, providerId: candidate.id };
      } catch (err) {
        lastError = err;
        const transient = isTransientAiError(err);
        logEvent('ai_stream_open_attempt_failed', {
          provider: candidate.id,
          attempt,
          transient,
          error: err instanceof Error ? err.message : String(err),
        }, 'warn');
        if (!transient) break; // auth/perm/malformed → try NEXT provider now
        if (attempt < MAX_ATTEMPTS_PER_PROVIDER - 1) {
          await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
        }
      }
    }
  }

  throw lastError;
}

export async function generateWithFailover(params: GenerateParams & { preferredProviderId?: string | null }): Promise<FailoverGenerateResult> {
  const { preferredProviderId, ...generateParams } = params;
  const candidates = failoverCandidates(preferredProviderId);
  let lastError: unknown = new Error('No AI provider is registered');

  for (const candidate of candidates) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_PROVIDER; attempt++) {
      try {
        const result = await candidate.provider.generate(generateParams);
        if (attempt > 0 || candidates[0].id !== candidate.id) {
          logEvent('ai_failover_succeeded', { provider: candidate.id, attempt });
        }
        return { ...result, providerId: candidate.id };
      } catch (err) {
        lastError = err;
        const transient = isTransientAiError(err);
        logEvent('ai_generate_attempt_failed', {
          provider: candidate.id,
          attempt,
          transient,
          error: err instanceof Error ? err.message : String(err),
        }, 'warn');
        if (!transient) break; // auth/perm/malformed → try NEXT provider now
        if (attempt < MAX_ATTEMPTS_PER_PROVIDER - 1) {
          await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
        }
      }
    }
  }

  throw lastError;
}
