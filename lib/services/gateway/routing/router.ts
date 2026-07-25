import { UnifiedMessage, OutgoingMessage, ChannelType } from '../types';
import { Channel } from '../channels/types';

export class MessageRouter {
  private channels: Map<ChannelType, Channel> = new Map();
  private messageHandler: ((message: UnifiedMessage) => void) | undefined;

  registerChannel(channel: Channel) {
    this.channels.set(channel.channelType as ChannelType, channel);
    channel.onMessage(this.handleIncomingMessage.bind(this));
  }

  private handleIncomingMessage(message: UnifiedMessage) {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }

  onMessage(handler: (message: UnifiedMessage) => void) {
    this.messageHandler = handler;
  }

  async sendMessage(message: OutgoingMessage): Promise<void> {
    const channel = this.channels.get(message.channel);
    if (channel) {
      await channel.sendMessage(message);
    } else {
      throw new Error(`Channel ${message.channel} not registered`);
    }
  }
}
