import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * REGRESSION TESTS for the conversation experience rebuild:
 *
 * 1. GET /api/ai/messages previously returned a hard-coded `{ data: [] }`
 *    stub, so refreshing the authenticated chat ALWAYS lost its history.
 *    It must now return the REAL transcript scoped by clinic (IDOR-safe).
 * 2. GET /api/ai/conversations?id=… must return the enriched staff payload
 *    (summary + appointment + patient) alongside the raw conversation.
 */

const { fromMock, listMessagesMock, getConversationByIdMock, loadDetailExtrasMock, loadSummariesMock, listConversationsMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  listMessagesMock: vi.fn(),
  getConversationByIdMock: vi.fn(),
  loadDetailExtrasMock: vi.fn(),
  loadSummariesMock: vi.fn(),
  listConversationsMock: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: { from: fromMock },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getUser: vi.fn() }, from: fromMock },
}));

vi.mock('@/lib/config', () => ({
  getSupabaseEnvConfig: () => ({ isConfigured: true }),
  isSupabaseConfigured: () => true,
}));

vi.mock('@/lib/services/messageService', () => ({
  receivePatientMessage: vi.fn(),
  listMessagesForConversation: listMessagesMock,
}));

vi.mock('@/lib/services/conversationService', () => ({
  createConversation: vi.fn(),
  getConversationById: getConversationByIdMock,
  listConversationsForClinic: listConversationsMock,
  updateConversationStatus: vi.fn(),
}));

vi.mock('@/lib/services/conversationSummary', () => ({
  loadConversationSummaries: loadSummariesMock,
  loadConversationDetailExtras: loadDetailExtrasMock,
}));

vi.mock('@/lib/services/gateway/security/rate-limiter', () => {
  const limiter = { isAllowed: () => true };
  return { RateLimiter: vi.fn(() => limiter), getClientId: () => 'test-client' };
});

vi.mock('@/lib/services/clinicAuthorization', () => ({
  authorizeClinicRequest: vi.fn(async (_req: Request, clinicId: string) =>
    clinicId === 'clinic-allowed'
      ? { authorized: true as const }
      : { authorized: false as const, status: 403 }
  ),
}));

vi.mock('@/lib/demoState', () => ({
  demoFallbackAllowed: () => false,
  getDemoMessages: () => [],
  createDemoConversation: vi.fn(),
  getDemoConversations: () => [],
}));

// Route modules are imported dynamically inside tests (no top-level await:
// the project's TS module/target does not allow it).

describe('GET /api/ai/messages — chat history restore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the REAL transcript instead of the old empty stub', async () => {
    const { GET: getMessages } = await import('@/app/api/ai/messages/route');
    const transcript = [
      { id: 'm1', role: 'patient', content: 'طاحونتي بتوجعني', created_at: '2026-08-26T10:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'سلامتك. من إمتى بدأ الألم؟', created_at: '2026-08-26T10:00:05Z' },
    ];
    listMessagesMock.mockResolvedValue(transcript);

    const url = 'https://x/api/ai/messages?conversation_id=conv-9&clinic_id=clinic-allowed';
    const response = await getMessages(new Request(url));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(listMessagesMock).toHaveBeenCalledWith('conv-9', 'clinic-allowed');
    expect(payload.data).toEqual(transcript);
    expect(payload.data).not.toEqual([]);
  });

  it('rejects cross-tenant reads (conversation scoped to the authorized clinic)', async () => {
    const { GET: getMessages } = await import('@/app/api/ai/messages/route');
    const url = 'https://x/api/ai/messages?conversation_id=conv-9&clinic_id=clinic-other';
    const response = await getMessages(new Request(url));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(listMessagesMock).not.toHaveBeenCalled();
    expect(payload.error).toBeDefined();
  });

  it('requires both conversation_id and clinic_id', async () => {
    const { GET: getMessages } = await import('@/app/api/ai/messages/route');
    const response = await getMessages(new Request('https://x/api/ai/messages?conversation_id=conv-9'));
    expect(response.status).toBe(400);
    expect(listMessagesMock).not.toHaveBeenCalled();
  });

  it('propagates transcript-load failures as a human-readable error', async () => {
    const { GET: getMessages } = await import('@/app/api/ai/messages/route');
    listMessagesMock.mockRejectedValue(new Error('db down'));
    const url = 'https://x/api/ai/messages?conversation_id=conv-9&clinic_id=clinic-allowed';
    const response = await getMessages(new Request(url));
    const payload = await response.json();

    expect(response.status).toBe(500);
    // Never leak raw driver errors to the client.
    expect(payload.error).not.toContain('db down');
    expect(payload.error).toContain('تعذر');
  });
});

describe('GET /api/ai/conversations — staff control-center payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the enriched summary + appointment + patient for one session', async () => {
    const { GET: getConversations } = await import('@/app/api/ai/conversations/route');
    const conversation = { id: 'conv-1', clinic_id: 'clinic-allowed', status: 'open', session_id: 'public:123' };
    getConversationByIdMock.mockResolvedValue(conversation);
    loadDetailExtrasMock.mockResolvedValue({
      summary: { id: 'conv-1', display_name: 'علي جمال', is_known_visitor: true, needs_attention: false },
      appointment: { id: 'appt-9', service: 'فحص أسنان', status: 'scheduled', provider_name: 'د. أحمد' },
      patient: { id: 'p-1', name: 'علي جمال', phone: '0599', email: null },
    });

    const response = await getConversations(new Request('https://x/api/ai/conversations?id=conv-1'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.id).toBe('conv-1');
    expect(payload.summary.display_name).toBe('علي جمال');
    expect(payload.appointment.id).toBe('appt-9');
    expect(payload.patient.name).toBe('علي جمال');
    // Authorization derives the clinic from the RECORD, not from client input.
    expect(getConversationByIdMock).toHaveBeenCalledWith('conv-1');
  });

  it('list endpoint returns staff-readable summaries', async () => {
    const { GET: getConversations } = await import('@/app/api/ai/conversations/route');
    listConversationsMock.mockResolvedValue([{ id: 'a', clinic_id: 'clinic-allowed' }]);
    loadSummariesMock.mockResolvedValue([{ id: 'a', display_name: null, is_known_visitor: false }]);

    const response = await getConversations(new Request('https://x/api/ai/conversations?clinic_id=clinic-allowed'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data[0].is_known_visitor).toBe(false); // زائر جديد — no fake identity
    expect(loadSummariesMock).toHaveBeenCalledWith([{ id: 'a', clinic_id: 'clinic-allowed' }]);
  });

  it('degrades gracefully when enrichment fails (raw rows still returned)', async () => {
    const { GET: getConversations } = await import('@/app/api/ai/conversations/route');
    listConversationsMock.mockResolvedValue([{ id: 'b', clinic_id: 'clinic-allowed' }]);
    loadSummariesMock.mockRejectedValue(new Error('enrichment down'));

    const response = await getConversations(new Request('https://x/api/ai/conversations?clinic_id=clinic-allowed'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data[0].id).toBe('b');
  });
});

