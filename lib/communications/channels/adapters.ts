import { ChannelProvider, ChannelMessage, NoopChannelProvider, ConsoleChannelProvider, ChannelType } from './types';
import { sendNotificationEmail } from '../email/sender';

/**
 * Email adapter — reuses the existing booking email builder + Resend/noop/console provider.
 * Delegates to sendNotificationEmail so booking emails retain their proper
 * content and secure confirm/cancel links.
 */
export class EmailChannelAdapter implements ChannelProvider {
  readonly channel: ChannelType = 'email';
  readonly name = 'email';

  async send(message: ChannelMessage): Promise<void> {
    // message.notification carries the full notification_queue item
    const notification = message.notification as any;
    if (notification) {
      await sendNotificationEmail(notification);
      return;
    }
    // Fallback: send a plain message via the configured email provider
    const { getEmailProvider } = await import('../email/provider');
    const provider = getEmailProvider();
    await provider.send({
      to: message.to,
      subject: message.subject ?? '',
      text: message.text,
    });
  }
}

/**
 * SMS adapter — no real provider credentials exist yet.
 * Uses noop/console provider so the queue can mark sent without claiming real delivery.
 */
export class SmsChannelAdapter implements ChannelProvider {
  readonly channel: ChannelType = 'sms';
  readonly name = 'sms';

  private readonly inner: ChannelProvider;

  constructor(env: Record<string, string | undefined> = process.env) {
    const mode = (env.SMS_PROVIDER || 'noop').toLowerCase();
    this.inner = mode === 'console' ? new ConsoleChannelProvider('sms') : new NoopChannelProvider('sms');
  }

  async send(message: ChannelMessage): Promise<void> {
    await this.inner.send(message);
  }
}

/**
 * WhatsApp adapter — no real provider credentials exist yet.
 * Uses noop/console provider so the queue can mark sent without claiming real delivery.
 */
export class WhatsAppChannelAdapter implements ChannelProvider {
  readonly channel: ChannelType = 'whatsapp';
  readonly name = 'whatsapp';

  private readonly inner: ChannelProvider;

  constructor(env: Record<string, string | undefined> = process.env) {
    const mode = (env.WHATSAPP_PROVIDER || 'noop').toLowerCase();
    this.inner = mode === 'console' ? new ConsoleChannelProvider('whatsapp') : new NoopChannelProvider('whatsapp');
  }

  async send(message: ChannelMessage): Promise<void> {
    await this.inner.send(message);
  }
}

/**
 * Telegram adapter — no real provider credentials exist yet.
 * Uses noop/console provider so the queue can mark sent without claiming real delivery.
 */
export class TelegramChannelAdapter implements ChannelProvider {
  readonly channel: ChannelType = 'telegram';
  readonly name = 'telegram';

  private readonly inner: ChannelProvider;

  constructor(env: Record<string, string | undefined> = process.env) {
    const mode = (env.TELEGRAM_PROVIDER || 'noop').toLowerCase();
    this.inner = mode === 'console' ? new ConsoleChannelProvider('telegram') : new NoopChannelProvider('telegram');
  }

  async send(message: ChannelMessage): Promise<void> {
    await this.inner.send(message);
  }
}

/**
 * Resolves the adapter for a channel.
 */
export function getChannelAdapter(channel: ChannelType): ChannelProvider {
  switch (channel) {
    case 'email':
      return new EmailChannelAdapter();
    case 'sms':
      return new SmsChannelAdapter();
    case 'whatsapp':
      return new WhatsAppChannelAdapter();
    case 'telegram':
      return new TelegramChannelAdapter();
    default:
      throw new Error(`Unsupported channel: ${channel}`);
  }
}