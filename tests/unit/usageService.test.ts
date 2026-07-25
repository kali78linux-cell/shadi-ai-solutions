import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getClinicUsageSummary } from '../../lib/services/usageService';

// Mock dependencies
const mockSupabase = vi.hoisted(() => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
  },
}));
vi.mock('@/lib/supabase', () => mockSupabase);

describe('Usage Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should correctly aggregate usage data for a clinic', async () => {
    const clinicId = 'clinic-1';
    const from = '2024-01-01T00:00:00Z';
    const to = '2024-01-31T23:59:59Z';

    // Mock message count
    mockSupabase.supabase.from('messages').select.mockResolvedValue({ count: 150, error: null } as any);

    // Mock usage data
    const mockUsageData = [
      { tokens_consumed: 10000, estimated_cost: 0.1 },
      { tokens_consumed: 25000, estimated_cost: 0.25 },
      { tokens_consumed: 5000, estimated_cost: 0.05 },
    ];
    mockSupabase.supabase.from('ai_usage').select.mockResolvedValue({ data: mockUsageData, error: null });

    const summary = await getClinicUsageSummary(clinicId, from, to);

    // Verify message query
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith('messages');
    expect(mockSupabase.supabase.from('messages').select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    expect(mockSupabase.supabase.from('messages').eq).toHaveBeenCalledWith('clinic_id', clinicId);
    expect(mockSupabase.supabase.from('messages').eq).toHaveBeenCalledWith('role', 'assistant');

    // Verify usage query
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith('ai_usage');
    expect(mockSupabase.supabase.from('ai_usage').select).toHaveBeenCalledWith('tokens_consumed, estimated_cost');
    expect(mockSupabase.supabase.from('ai_usage').eq).toHaveBeenCalledWith('clinic_id', clinicId);
    expect(mockSupabase.supabase.from('ai_usage').gte).toHaveBeenCalledWith('created_at', from);
    expect(mockSupabase.supabase.from('ai_usage').lte).toHaveBeenCalledWith('created_at', to);

    // Verify aggregated results
    expect(summary).toEqual({
      clinicId: clinicId,
      dateRange: { from, to },
      totalMessages: 150,
      totalTokens: 40000,
      totalEstimatedCost: 0.4,
    });
  });
});