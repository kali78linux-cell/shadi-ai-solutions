import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyStaffForHandoff } from '@/lib/services/notificationService';

// Mock dependencies
const mockSupabase = vi.hoisted(() => ({
  supabase: {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
  },
}));
vi.mock('@/lib/supabase', () => mockSupabase);

const mockConversationService = vi.hoisted(() => ({
  getConversationById: vi.fn(),
}));
vi.mock('@/lib/services/conversationService', () => mockConversationService);

const mockLogging = vi.hoisted(() => ({
  logEvent: vi.fn(),
}));
vi.mock('@/lib/server/logging', () => mockLogging);

describe('Notification Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.supabase.from('notifications').insert.mockResolvedValue({ error: null });
    mockConversationService.getConversationById.mockResolvedValue({
      id: 'conv-1',
      clinic_id: 'clinic-1',
      patient_id: 'patient-123',
      session_id: 'sess-1',
      status: 'open',
    });
  });

  it('should create a persistent notification record for handoff', async () => {
    const clinicId = 'clinic-1';
    const conversationId = 'conv-1';

    await notifyStaffForHandoff(clinicId, conversationId);

    expect(mockConversationService.getConversationById).toHaveBeenCalledWith(conversationId);
    expect(mockSupabase.supabase.from).toHaveBeenCalledWith('notifications');
    expect(mockSupabase.supabase.from('notifications').insert).toHaveBeenCalledWith({
      clinic_id: clinicId,
      user_id: null,
      patient_id: 'patient-123',
      channel: 'email',
      type: 'human_handoff',
      payload: { conversation_id: conversationId, reason: 'human_handoff_requested' },
      status: 'pending',
    });
    expect(mockLogging.logEvent).toHaveBeenCalledWith('staff_notification_triggered', expect.any(Object));
  });

  it('should log an error if notification persistence fails', async () => {
    const clinicId = 'clinic-1';
    const conversationId = 'conv-1';
    const dbError = { message: 'DB insert failed' };

    mockSupabase.supabase.from('notifications').insert.mockResolvedValue({ error: dbError });

    await expect(notifyStaffForHandoff(clinicId, conversationId)).rejects.toThrow(
      'Failed to persist handoff notification: DB insert failed'
    );
    expect(mockLogging.logEvent).toHaveBeenCalledWith(
      'notification_persistence_error',
      expect.objectContaining({ error: dbError.message }),
      'error'
    );
  });
});