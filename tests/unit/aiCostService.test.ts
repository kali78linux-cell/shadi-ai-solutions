import { describe, it, expect } from 'vitest';
import { calculateCost } from '../../lib/services/aiCostService';

describe('AI Cost Service', () => {
  it('should calculate cost for a known OpenAI model', () => {
    // gpt-4o is $5.00 per 1M tokens
    const cost = calculateCost('gpt-4o', 80000, 20000); // 80k in, 20k out
    const expectedCost = (80000 / 1000000 * 5.00) + (20000 / 1000000 * 15.00); // 0.40 + 0.30
    expect(cost).toBeCloseTo(expectedCost); // 0.70
  });

  it('should calculate cost for a known Google model', () => {
    // gemini-1.5-pro is $3.50 (in) and $10.50 (out) per 1M tokens
    const cost = calculateCost('gemini-1.5-pro-001', 150000, 50000); // 150k in, 50k out
    const expectedCost = (150000 / 1000000 * 3.50) + (50000 / 1000000 * 10.50); // 0.525 + 0.525
    expect(cost).toBeCloseTo(expectedCost); // 1.05
  });

  it('should return null for an unknown model', () => {
    const cost = calculateCost('unknown-model-xyz', 100000, 50000);
    expect(cost).toBeNull();
  });

  it('should return null for zero tokens', () => {
    const cost = calculateCost('gpt-4o', 0, 0);
    expect(cost).toBeNull();
  });

  it('should return null for a null model', () => {
    const cost = calculateCost(null, 1000, 1000);
    expect(cost).toBeNull();
  });
});