
import { Channel } from '../types';
import { UnifiedMessage, OutgoingMessage, ChannelType } from '../../types';
import { WhatsAppMessage } from './types';

export class WhatsAppChannel implements Channel {
  readonly channelType: ChannelType = 'whatsapp';
  private messageHandler: ((message: UnifiedMessage) => void) | undefined;

  constructor(private token: string, private webhookVerifyToken: string) {}

  async init(): Promise<void> {
    console.log('Initializing WhatsApp channel');
    // TODO: Set up webhook with WhatsApp
  }

  onMessage(handler: (message: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    const { recipientId, message: messageData } = message;

    const payload = {
      messaging_product: 'whatsapp',
      to: recipientId,
      type: messageData.type,
      [messageData.type]: {
        body: messageData.text,
      },
    };

    try {
      const response = await fetch(`https://graph.facebook.com/v19.0/${this.token}/messages`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to send message: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Error sending WhatsApp message:', error);
      throw error;
    }
  }

  handleWebhook(payload: WhatsAppMessage) {
    const unifiedMessage = this.normalize(payload);
    if (this.messageHandler) {
      this.messageHandler(unifiedMessage);
    }
  }

  private normalize(payload: WhatsAppMessage): UnifiedMessage {
    const message = payload.entry[0].changes[0].value.messages[0];
    const contact = payload.entry[0].changes[0].value.contacts[0];
    
    return {
      channel: 'whatsapp',
      channelId: payload.entry[0].id,
      conversationId: contact.wa_id,
      senderId: message.from,
      recipientId: payload.entry[0].changes[0].value.metadata.phone_number_id,
      timestamp: parseInt(message.timestamp, 10),
      message: {
        id: message.id,
        type: message.type,
        text: message.text?.body,
      },
    };
  }

  verifyWebhook(hubMode: string, hubChallenge: string, hubVerifyToken: string): string {
    if (hubMode === 'subscribe' && hubVerifyToken === this.webhookVerifyToken) {
      return hubChallenge;
    } else {
      throw new Error('Failed to verify webhook');
    }
  }
}
