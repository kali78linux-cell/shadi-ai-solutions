import { ResendEmailProvider } from './resendProvider';

/**
 * Email provider interface.
 *
 * The actual provider is selected via environment variables.
 * No credentials are hardcoded in source code.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * No-op provider used when no email provider is configured.
 * Logs the message and resolves successfully so the queue can mark it sent.
 */
export class NoopEmailProvider implements EmailProvider {
  readonly name = 'noop';

  async send(message: EmailMessage): Promise<void> {
    // Intentionally does nothing — used when EMAIL_PROVIDER is not set.
    // The queue will mark the notification as sent.
  }
}

/**
 * Console provider for development — prints the message to stdout.
 * Never used in production.
 */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console';

  async send(message: EmailMessage): Promise<void> {
    console.log(`[Email] To: ${message.to}`);
    console.log(`[Email] Subject: ${message.subject}`);
    console.log(`[Email] Body: ${message.text}`);
  }
}

/**
 * Resolves the configured email provider from environment variables.
 *
 * Supported providers:
 *   - EMAIL_PROVIDER=resend  → ResendEmailProvider (production)
 *   - EMAIL_PROVIDER=console → ConsoleEmailProvider (dev)
 *   - EMAIL_PROVIDER=noop    → NoopEmailProvider (default when unset)
 *
 * Additional providers can be added here without changing the booking logic.
 */
export function getEmailProvider(env: Record<string, string | undefined> = process.env): EmailProvider {
  const provider = (env.EMAIL_PROVIDER || 'noop').toLowerCase();
  switch (provider) {
    case 'resend':
      return new ResendEmailProvider(env);
    case 'console':
      return new ConsoleEmailProvider();
    case 'noop':
    default:
      return new NoopEmailProvider();
  }
}