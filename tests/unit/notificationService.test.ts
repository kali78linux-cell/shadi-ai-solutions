import { describe, it, expect, vi, beforeEach } from 'vitest';
import { notifyStaffForHandoff } from '@/lib/services/notificationService';

// Mock dependencies
const mockSupabase = vi.hoisted(() => ({
  supabaseAdmin: {
    from: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
  },
}));
vi.mock('@/lib/supabase/admin', () => mockSupabase);

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
    mockSupabase.supabaseAdmin.from('notifications').insert.mockResolvedValue({ error: null });
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

    expect(mockConversationService.getConversationById).toHaveBeenCalledWith(conversationId, clinicId);
    expect(mockSupabase.supabaseAdmin.from).toHaveBeenCalledWith('notifications');
    expect(mockSupabase.supabaseAdmin.from('notifications').insert).toHaveBeenCalledWith(expect.objectContaining({
      clinic_id: clinicId,
      user_id: null,
      patient_id: 'patient-123',
      channel: 'email',
      type: 'system',
      status: 'pending',
    }));
    // The payload is now a FULL staff summary (Phase 13), not just ids.
    const insertCall = mockSupabase.supabaseAdmin.from('notifications').insert.mock.calls[0][0];
    expect(insertCall.payload.conversation_id).toBe(conversationId);
    expect(insertCall.payload.reason).toBe('human_handoff_requested');
    expect(insertCall.payload.patient).toEqual({ id: 'patient-123', name: null, phone: null, email: null });
    expect(Array.isArray(insertCall.payload.transcript_excerpt)).toBe(true);
    expect(mockLogging.logEvent).toHaveBeenCalledWith('staff_notification_triggered', expect.any(Object));
  });

  it('should log an error if notification persistence fails', async () => {
    const clinicId = 'clinic-1';
    const conversationId = 'conv-1';
    const dbError = { message: 'DB insert failed' };

    mockSupabase.supabaseAdmin.from('notifications').insert.mockResolvedValue({ error: dbError });

    await expect(notifyStaffForHandoff(clinicId, conversationId)).rejects.toThrow(
      'Failed to persist handoff notification: DB insert failed'
    );
    expect(mockLogging.logEvent).toHaveBeenCalledWith(
      'notification_persistence_error',
      expect.objectContaining({ error: dbError.message }),
      'error'
    );
  });

  it('rejects handoff persistence when the conversation is not in the requested clinic', async () => {
    vi.clearAllMocks();
    mockConversationService.getConversationById.mockResolvedValue(null);

    await expect(notifyStaffForHandoff('clinic-a', 'conv-from-clinic-b')).rejects.toThrow('Conversation not found for this clinic');
    expect(mockSupabase.supabaseAdmin.insert).not.toHaveBeenCalled();
  });
});
