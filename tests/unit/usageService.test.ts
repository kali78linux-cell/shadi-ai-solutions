import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClinicUsageSummary } from '../../lib/services/usageService';

// Mock dependencies
const mockSupabase = vi.hoisted(() => {
  const chainable = {
    from: vi.fn(),
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    lte: vi.fn(),
  };
  Object.values(chainable).forEach((fn) => fn.mockReturnValue(chainable));
  return { supabase: chainable };
});
vi.mock('@/lib/supabase', () => mockSupabase);

describe('Usage Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-set chainable return values after clearAllMocks
    Object.values(mockSupabase.supabase).forEach((fn) => fn.mockReturnValue(mockSupabase.supabase));
  });

  it('should correctly aggregate usage data for a clinic', async () => {
    const clinicId = 'clinic-1';
    const from = '2024-01-01T00:00:00Z';
    const to = '2024-01-31T23:59:59Z';

    // Mock message count — set on terminal method (lte) to preserve chain
    mockSupabase.supabase.lte.mockResolvedValueOnce({ count: 150, error: null } as any);

    // Mock usage data — set on terminal method (lte) to preserve chain
    const mockUsageData = [
      { total_tokens: 10000, estimated_cost: 0.1 },
      { total_tokens: 25000, estimated_cost: 0.25 },
      { total_tokens: 5000, estimated_cost: 0.05 },
    ];
    mockSupabase.supabase.lte.mockResolvedValueOnce({ data: mockUsageData, error: null });

    const summary = await getClinicUsageSummary(clinicId, from, to);

    // Verify message query
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith('messages');
    expect(mockSupabase.supabase.from('messages').select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    expect(mockSupabase.supabase.from('messages').eq).toHaveBeenCalledWith('clinic_id', clinicId);
    expect(mockSupabase.supabase.from('messages').eq).toHaveBeenCalledWith('role', 'assistant');

    // Verify usage query
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith('ai_usage');
    expect(mockSupabase.supabase.from('ai_usage').select).toHaveBeenCalledWith('total_tokens, estimated_cost');
    expect(mockSupabase.supabase.from('ai_usage').eq).toHaveBeenCalledWith('clinic_id', clinicId);
    expect(mockSupabase.supabase.from('ai_usage').gte).toHaveBeenCalledWith('created_at', from);
    expect(mockSupabase.supabase.from('ai_usage').lte).toHaveBeenCalledWith('created_at', to);

    // Verify aggregated results
    expect(summary).toEqual(expect.objectContaining({
      clinicId: clinicId,
      dateRange: { from, to },
      totalMessages: 150,
      totalTokens: 40000,
    }));
    expect(summary.totalEstimatedCost).toBeCloseTo(0.4, 5);
  });
});