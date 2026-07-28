/**
 * A pricing map for various AI models.
 * Prices are in USD per 1,000,000 tokens.
 */
const PRICING_MAP: Record<string, Record<string, { input: number; output: number }>> = {
  openai: {
    'gpt-4-turbo': { input: 10.00, output: 30.00 },
    'gpt-4o': { input: 5.00, output: 15.00 },
    'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  },
  google: {
    'gemini-1.5-pro': { input: 3.50, output: 10.50 },
    'gemini-1.0-pro': { input: 0.50, output: 1.50 },
  },
};

/**
 * Calculates the estimated cost of an AI API call.
 * @param model The name of the model used (e.g., 'gpt-4o').
 * @param promptTokens The number of tokens in the prompt.
 * @param completionTokens The number of tokens in the completion.
 * @returns The estimated cost in USD, or null if the model is not in the pricing map.
 */
export function calculateCost(model: string | null | undefined, promptTokens: number, completionTokens: number): number | null {
  if (!model || (promptTokens <= 0 && completionTokens <= 0)) {
    return null;
  }

  for (const provider in PRICING_MAP) {
    if (model.includes(provider) || Object.keys(PRICING_MAP[provider]).some(m => model.includes(m))) {
      const modelKey = Object.keys(PRICING_MAP[provider]).find(m => model.includes(m));
      if (modelKey) {
        const prices = PRICING_MAP[provider][modelKey];
        const inputCost = (promptTokens / 1_000_000) * prices.input;
        const outputCost = (completionTokens / 1_000_000) * prices.output;
        return inputCost + outputCost;
      }
    }
  }

  return null; // Return null if no matching model is found
}