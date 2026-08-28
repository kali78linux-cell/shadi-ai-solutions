import { registerProvider } from '../provider';
import { OpenAIProvider } from './openai';
import { OllamaProvider } from './ollama';
import { AnthropicProvider } from './anthropic';
import { GeminiProvider } from './gemini';

let registered = false;

/** Registers all supported providers once for every server entry point. */
export function ensureAIProviders(): void {
  if (registered) return;
  registerProvider(OpenAIProvider);
  registerProvider(OllamaProvider);
  registerProvider(AnthropicProvider);
  registerProvider(GeminiProvider);
  registered = true;
}
