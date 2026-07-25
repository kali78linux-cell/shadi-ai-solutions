import { describe, it, expect } from 'vitest';
import { calculateCost } from '../../lib/services/aiCostService';

describe('AI Cost Service', () => {
  it('should calculate cost for a known OpenAI model', () => {
    // gpt-4o is $5.00 per 1M tokens
    const cost = calculateCost('gpt-4o', 100000); // 100k tokens
    expect(cost).toBeCloseTo(0.5);
  });

  it('should calculate cost for a known Google model', () => {
    // gemini-1.5-pro is $7.00 per 1M tokens
    const cost = calculateCost('gemini-1.5-pro-001', 200000); // 200k tokens
    expect(cost).toBeCloseTo(1.4);
  });

  it('should return null for an unknown model', () => {
    const cost = calculateCost('unknown-model-xyz', 100000);
    expect(cost).toBeNull();
  });

  it('should return null for zero tokens', () => {
    const cost = calculateCost('gpt-4o', 0);
    expect(cost).toBeNull();
  });

  it('should return null for a null model', () => {
    const cost = calculateCost(null, 1000);
    expect(cost).toBeNull();
  });
});