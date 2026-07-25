
import { Channel } from '../types';
import { UnifiedMessage, OutgoingMessage, ChannelType } from '../../types';
import { TelegramUpdate } from './types';

export class TelegramChannel implements Channel {
  readonly channelType: ChannelType = 'telegram';
  private messageHandler: ((message: UnifiedMessage) => void) | undefined;
  private apiUrl: string;

  constructor(private token: string, private fetch: (url: string, options: any) => Promise<any>) {
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  async init(): Promise<void> {
    console.log('Initializing Telegram channel');
    // TODO: Set up webhook with Telegram
  }

  onMessage(handler: (message: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    const { recipientId, message: messageData } = message;
    
    const payload = {
      chat_id: recipientId,
      text: messageData.text,
    };

    try {
      const response = await this.fetch(`${this.apiUrl}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending Telegram message:', error);
      throw error;
    }
  }

  handleWebhook(payload: TelegramUpdate) {
    if (payload.message) {
        const unifiedMessage = this.normalize(payload);
        if (this.messageHandler) {
          this.messageHandler(unifiedMessage);
        }
    }
  }

  private normalize(payload: TelegramUpdate): UnifiedMessage {
    const message = payload.message!;
    
    return {
      channel: 'telegram',
      channelId: payload.update_id.toString(),
      conversationId: message.chat.id.toString(),
      senderId: message.from.id.toString(),
      recipientId: '', // Not available in the same way as WhatsApp
      timestamp: message.date,
      message: {
        id: message.message_id.toString(),
        type: 'text', // Assuming text for now
        text: message.text,
      },
    };
  }
}
