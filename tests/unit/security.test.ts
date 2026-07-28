import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moderateUserPrompt, ContentFlaggedError } from '../../lib/ai/security';

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Prompt Moderation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('should not throw an error for safe content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ flagged: false }] }),
    });

    await expect(moderateUserPrompt('This is a safe message.')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledWith('https://api.openai.com/v1/moderations', expect.any(Object));
  });

  it('should throw ContentFlaggedError for flagged content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ flagged: true, categories: { hate: true } }] }),
    });

    await expect(moderateUserPrompt('This is harmful content.')).rejects.toThrow(ContentFlaggedError);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('should not block the user if the moderation API itself fails', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    // The function should catch the error, log it, and resolve without throwing.
    await expect(moderateUserPrompt('A normal message.')).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});