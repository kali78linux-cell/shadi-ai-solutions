import { EmailProvider, EmailMessage } from './provider';

/**
 * Resend transactional email provider.
 *
 * Credentials are read from environment variables only — never hardcoded.
 * Uses the Resend REST API via fetch (no SDK dependency required).
 *
 * Required env vars:
 *   RESEND_API_KEY  — Resend API key
 *   EMAIL_FROM      — sender address, e.g. "Clinic <no-reply@example.com>"
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';

  private readonly apiKey: string;
  private readonly from: string;

  constructor(env: Record<string, string | undefined> = process.env) {
    this.apiKey = env.RESEND_API_KEY || '';
    this.from = env.EMAIL_FROM || '';
  }

  async send(message: EmailMessage): Promise<void> {
    if (!this.apiKey) {
      throw new Error('RESEND_API_KEY is not configured');
    }
    if (!this.from) {
      throw new Error('EMAIL_FROM is not configured');
    }

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Resend API error (${res.status}): ${body}`);
    }
  }
}