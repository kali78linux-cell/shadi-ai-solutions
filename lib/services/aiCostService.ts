/**
 * A pricing map for various AI models.
 * Prices are in USD per 1,000,000 tokens.
 * This structure is ready to be expanded with input/output token pricing.
 * Example: 'gpt-4-turbo': { input: 5.00, output: 15.00 }
 */
const PRICING_MAP: Record<string, Record<string, number>> = {
  openai: {
    'gpt-4-turbo': 10.00, // Blended average for simplicity
    'gpt-4o': 5.00,
    'gpt-3.5-turbo': 0.50,
  },
  google: {
    'gemini-1.5-pro': 7.00,
    'gemini-1.0-pro': 0.50,
  },
};

/**
 * Calculates the estimated cost of an AI API call.
 * @param model The name of the model used (e.g., 'gpt-4o').
 * @param tokens The total number of tokens consumed.
 * @returns The estimated cost in USD, or null if the model is not in the pricing map.
 */
export function calculateCost(model: string | null | undefined, tokens: number): number | null {
  if (!model || tokens <= 0) {
    return null;
  }

  for (const provider in PRICING_MAP) {
    if (model.includes(provider) || Object.keys(PRICING_MAP[provider]).some(m => model.includes(m))) {
      const modelKey = Object.keys(PRICING_MAP[provider]).find(m => model.includes(m));
      if (modelKey) {
        const pricePerMillionTokens = PRICING_MAP[provider][modelKey];
        return (tokens / 1_000_000) * pricePerMillionTokens;
      }
    }
  }

  return null; // Return null if no matching model is found
}