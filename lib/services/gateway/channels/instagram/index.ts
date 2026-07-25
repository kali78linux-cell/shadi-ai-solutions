
import { Channel } from '../types';
import { UnifiedMessage, OutgoingMessage, ChannelType } from '../../types';
import { InstagramEvent } from './types';

export class InstagramChannel implements Channel {
  readonly channelType: ChannelType = 'instagram';
  private messageHandler: ((message: UnifiedMessage) => void) | undefined;
  private apiUrl: string;

  constructor(private pageAccessToken: string, private fetch: (url: string, options: any) => Promise<any>) {
    this.apiUrl = `https://graph.facebook.com/v19.0/me/messages?access_token=${pageAccessToken}`;
  }

  async init(): Promise<void> {
    console.log('Initializing Instagram channel');
    // TODO: Set up webhook with Instagram
  }

  onMessage(handler: (message: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    const { recipientId, message: messageData } = message;
    
    const payload = {
      recipient: {
        id: recipientId,
      },
      message: {
        text: messageData.text,
      },
    };

    try {
      const response = await this.fetch(this.apiUrl, {
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
      console.error('Error sending Instagram message:', error);
      throw error;
    }
  }

  handleWebhook(payload: InstagramEvent) {
    if (payload.object === 'instagram') {
      payload.entry.forEach(entry => {
        entry.messaging.forEach(event => {
          if (event.message) {
            const unifiedMessage = this.normalize(event);
            if (this.messageHandler) {
              this.messageHandler(unifiedMessage);
            }
          }
        });
      });
    }
  }

  private normalize(event: any): UnifiedMessage {
    return {
      channel: 'instagram',
      channelId: event.recipient.id,
      conversationId: event.sender.id,
      senderId: event.sender.id,
      recipientId: event.recipient.id,
      timestamp: event.timestamp,
      message: {
        id: event.message.mid,
        type: 'text',
        text: event.message.text,
      },
    };
  }
}
