import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRateLimiter, authGetUser, fromMock, createConversationMock, receivePatientMessageMock, getConversationByIdMock, listConversationsForClinicMock, updateConversationStatusMock } = vi.hoisted(() => ({
  mockRateLimiter: { isAllowed: vi.fn() },
  authGetUser: vi.fn(),
  fromMock: vi.fn(),
  createConversationMock: vi.fn(),
  receivePatientMessageMock: vi.fn(),
  getConversationByIdMock: vi.fn(),
  listConversationsForClinicMock: vi.fn(),
  updateConversationStatusMock: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getUser: authGetUser },
    from: fromMock,
  },
}));

// Mock supabaseAdmin so code that imports from @/lib/supabase/admin
// (streamingOrchestrator, messageService, clinicAuthorization, etc.)
// uses the same chainable mocks instead of hitting a real Supabase instance.
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    auth: { getUser: authGetUser },
    from: fromMock,
  },
}));

vi.mock('@/lib/services/gateway/security/rate-limiter', () => ({
  RateLimiter: vi.fn(() => mockRateLimiter),
}));

vi.mock('@/lib/services/conversationService', () => ({
  createConversation: createConversationMock,
  getConversationById: getConversationByIdMock,
  listConversationsForClinic: listConversationsForClinicMock,
  updateConversationStatus: updateConversationStatusMock,
}));

vi.mock('@/lib/services/messageService', () => ({
  receivePatientMessage: receivePatientMessageMock,
}));

// Force Supabase as "configured" so the real auth/rate-limit code paths
// execute instead of the demo-mode fallbacks.
vi.mock('@/lib/config', () => ({
  getSupabaseEnvConfig: () => ({ isConfigured: true }),
  isSupabaseConfigured: () => true,
}));

import { GET as getConversations, PATCH as patchConversations } from '@/app/api/ai/conversations/route';
import { POST as postMessages } from '@/app/api/ai/messages/route';

describe('api hardening regressions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRateLimiter.isAllowed.mockReturnValue(true); // Default to allowed
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    getConversationByIdMock.mockResolvedValue({ id: 'conv-1', clinic_id: 'clinic-1', status: 'open' });
    listConversationsForClinicMock.mockResolvedValue([]);
    updateConversationStatusMock.mockResolvedValue({ id: 'conv-1', clinic_id: 'clinic-1', status: 'closed' });
    fromMock.mockImplementation((table: string) => {
      if (table === 'clinic_users') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  limit: () => ({
                    single: async () => ({ data: null, error: { message: 'no access' } }),
                maybeSingle: async () => ({ data: null, error: { message: 'no access' } }),
                  }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
        insert: () => ({
          select: () => ({ single: async () => ({ data: { id: 'conv-1' }, error: null }) }),
        }),
        update: () => ({
          eq: () => ({
            select: () => ({ single: async () => ({ data: { id: 'conv-1', clinic_id: 'clinic-1', status: 'closed' }, error: null }) }),
          }),
        }),
      };
    });
  });

  it('rejects direct conversation fetch when the caller is not a member of that clinic', async () => {
    const response = await getConversations(new Request('https://example.com/api/ai/conversations?id=conv-1', {
      headers: { authorization: 'Bearer token' },
    }));
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('rejects conversation status updates for a clinic the user cannot access', async () => {
    const response = await patchConversations(new Request('https://example.com/api/ai/conversations', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'conv-1', status: 'closed' }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    }));

    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error).toBe('Forbidden');
  });

  it('rejects oversized AI message payloads', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const longText = 'a'.repeat(5000);

    const response = await postMessages(new Request('https://example.com/api/ai/messages', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: '11111111-1111-1111-1111-111111111111', text: longText, conversation_id: 'conv-1' }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    }));

    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBeDefined();
  });

  it('rejects messages when rate limit is exceeded', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'clinic_users') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  limit: () => ({ single: async () => ({ data: { role: 'owner' }, error: null }), maybeSingle: async () => ({ data: { role: 'owner' }, error: null }) }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ single: async () => ({ data: { role: 'owner' }, error: null }) }) }) }) }),
      };
    });
    mockRateLimiter.isAllowed.mockReturnValue(false); // Simulate rate limit exceeded

    const response = await postMessages(new Request('https://example.com/api/ai/messages', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: '11111111-1111-1111-1111-111111111111', text: 'hello', conversation_id: 'conv-1' }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    }));

    const payload = await response.json();

    expect(mockRateLimiter.isAllowed).toHaveBeenCalledWith('user-1');
    expect(response.status).toBe(429);
    expect(payload.error).toBe('Too many requests');
  });

  it('returns a service-unavailable response when the AI runtime is not configured', async () => {
    authGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    fromMock.mockImplementation((table: string) => {
      if (table === 'clinic_users') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                is: () => ({
                  limit: () => ({ single: async () => ({ data: { role: 'owner' }, error: null }), maybeSingle: async () => ({ data: { role: 'owner' }, error: null }) }),
                }),
              }),
            }),
          }),
        };
      }
      return {
        select: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ single: async () => ({ data: { role: 'owner' }, error: null }) }) }) }) }),
      };
    });

    // Delete all provider API keys so getProviderHealth() reports "not configured"
    const previousKeys = {
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      ollama: process.env.OLLAMA_MODEL,
    };
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OLLAMA_MODEL;

    const response = await postMessages(new Request('https://example.com/api/ai/messages', {
      method: 'POST',
      body: JSON.stringify({ clinic_id: '11111111-1111-1111-1111-111111111111', text: 'hello', conversation_id: 'conv-1' }),
      headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    }));

    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(payload.error).toContain('AI runtime is not configured');

    // Restore keys
    if (previousKeys.openai) process.env.OPENAI_API_KEY = previousKeys.openai;
    if (previousKeys.anthropic) process.env.ANTHROPIC_API_KEY = previousKeys.anthropic;
    if (previousKeys.ollama) process.env.OLLAMA_MODEL = previousKeys.ollama;
  });
});
