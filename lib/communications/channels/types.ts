/**
 * Communication channel types and provider interfaces.
 */

export type ChannelType = 'email' | 'sms' | 'whatsapp' | 'telegram';

export type NotificationType = 'appointment_reminder' | 'appointment_confirmation' | 'appointment_cancellation' | 'booking_acknowledgement';

export interface ChannelMessage {
  to: string;
  subject?: string;
  text: string;
  [key: string]: unknown;
}

export interface ChannelProvider {
  readonly channel: ChannelType;
  readonly name: string;
  send(message: ChannelMessage): Promise<void>;
}

/**
 * No-op provider — used when a channel is enabled but no real provider
 * credentials are configured. Resolves successfully so the queue can mark sent.
 * Never claims real delivery.
 */
export class NoopChannelProvider implements ChannelProvider {
  readonly channel: ChannelType;
  readonly name: string;

  constructor(channel: ChannelType) {
    this.channel = channel;
    this.name = `noop-${channel}`;
  }

  async send(message: ChannelMessage): Promise<void> {
    // Intentionally does nothing. Used when no provider credentials exist.
  }
}

/**
 * Console provider for development.
 */
export class ConsoleChannelProvider implements ChannelProvider {
  readonly channel: ChannelType;
  readonly name: string;

  constructor(channel: ChannelType) {
    this.channel = channel;
    this.name = `console-${channel}`;
  }

  async send(message: ChannelMessage): Promise<void> {
    console.log(`[${this.channel.toUpperCase()}] To: ${message.to}`);
    if (message.subject) console.log(`[${this.channel.toUpperCase()}] Subject: ${message.subject}`);
    console.log(`[${this.channel.toUpperCase()}] Body: ${message.text}`);
  }
}