export type GenerateParams = {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
};

export type GenerateResult = {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  model?: string;
  raw?: unknown;
};

export type EmbedResult = {
  embedding: number[];
  raw?: unknown;
};

export interface AIProvider {
  id: string;
  generate(params: GenerateParams): Promise<GenerateResult>;
  embed?(input: string): Promise<EmbedResult>;
  stream?(params: GenerateParams): Promise<ReadableStream<Uint8Array>>;
}

// Simple registry
const providers = new Map<string, AIProvider>();

export function registerProvider(p: AIProvider) {
  providers.set(p.id, p);
}

export function getProvider(id?: string) {
  // Explicit provider id takes priority
  if (id) return providers.get(id) ?? providers.values().next().value;

  // Select based on AI_PROVIDER env var (default: openai)
  const configured = process.env.AI_PROVIDER ?? 'openai';
  const selected = providers.get(configured);
  if (selected) return selected;

  // Fall back to the first registered provider
  return providers.values().next().value;
}

export function clearProviders() {
  providers.clear();
}

export type ProviderHealth = {
  configured: boolean;
  providerId: string | null;
  hasApiKey: boolean;
  message: string;
};

/**
 * Resolves the required API key env var for a provider id.
 * Returns null for providers without an API key requirement.
 */
function getProviderKeyEnv(providerId: string): string | null {
  switch (providerId) {
    case 'openai': return 'OPENAI_API_KEY';
    case 'anthropic': return 'ANTHROPIC_API_KEY';
    case 'ollama': return 'OLLAMA_MODEL';
    default: return null;
  }
}

/**
 * Returns a safe health/diagnostic status for the configured AI provider.
 * NEVER returns the API key or any secret.
 */
export function getProviderHealth(): ProviderHealth {
  const provider = getProvider();
  if (!provider) {
    return {
      configured: false,
      providerId: null,
      hasApiKey: false,
      message: 'No AI provider is registered. Set an API key (e.g. OPENAI_API_KEY or ANTHROPIC_API_KEY) and restart the server.',
    };
  }

  const keyEnv = getProviderKeyEnv(provider.id);
  const hasApiKey = keyEnv ? Boolean(process.env[keyEnv]) : true;
  return {
    configured: hasApiKey,
    providerId: provider.id,
    hasApiKey,
    message: hasApiKey
      ? `Provider "${provider.id}" is configured and ready.`
      : `Provider "${provider.id}" is registered but missing ${keyEnv}.`,
  };
}
