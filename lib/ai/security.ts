import { logEvent } from '@/lib/server/logging';

export class ContentFlaggedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentFlaggedError';
  }
}

/**
 * Moderates user input using the OpenAI Moderation API to prevent prompt injection and harmful content.
 * @param text The user's input text.
 * @throws {ContentFlaggedError} If the content is flagged by the moderation API.
 */
export async function moderateUserPrompt(text: string): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('OPENAI_API_KEY is not set, skipping moderation.');
    return;
  }

  try {
    const response = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: text }),
    });

    if (!response.ok) throw new Error(`Moderation API failed with status: ${response.status}`);

    const data = await response.json();
    if (data.results[0].flagged) {
      logEvent('prompt_moderation_flagged', { categories: data.results[0].categories }, 'warn');
      throw new ContentFlaggedError('User input was flagged by the moderation service.');
    }
  } catch (error) {
    // Re-throw ContentFlaggedError so callers can block flagged content.
    if (error instanceof ContentFlaggedError) throw error;
    // If the moderation API itself fails, we log it but don't block the user by default.
    // This can be changed to a stricter policy if needed.
    logEvent('prompt_moderation_error', { error: error instanceof Error ? error.message : String(error) }, 'error');
  }
}