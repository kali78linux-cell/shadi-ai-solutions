// A very basic list of phrases to strip to prevent simple prompt injection.
// In a real production system, this would be much more sophisticated.
const INJECTION_PATTERNS = [
  /ignore previous instructions/i,
  /ignore all prior instructions/i,
  /forget what you were told/i,
  /you are now in developer mode/i,
];

/**
 * A lightweight sanitizer to remove common prompt injection phrases from user input.
 * @param text The user's input text.
 * @returns The sanitized text.
 */
export function sanitizeForPrompt(text: string): string {
  let sanitizedText = text;
  for (const pattern of INJECTION_PATTERNS) {
    sanitizedText = sanitizedText.replace(pattern, '');
  }
  return sanitizedText.trim();
}