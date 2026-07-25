export type GenerateParams = {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
};

export type GenerateResult = {
  text: string;
  tokens?: number;
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
}

// Simple registry
const providers = new Map<string, AIProvider>();

export function registerProvider(p: AIProvider) {
  providers.set(p.id, p);
}

export function getProvider(id?: string) {
  if (!id) return providers.values().next().value;
  return providers.get(id) ?? providers.values().next().value;
}

export function clearProviders() {
  providers.clear();
}
