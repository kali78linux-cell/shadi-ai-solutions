
import { Channel } from '../types';
import { UnifiedMessage, OutgoingMessage, ChannelType } from '../../types';
import { WebSocketServer } from './server';

export class WebChannel implements Channel {
  readonly channelType: ChannelType = 'web';
  private messageHandler: ((message: UnifiedMessage) => void) | undefined;
  private server: WebSocketServer | undefined;

  async init(): Promise<void> {
    console.log('Initializing web channel');
  }

  setServer(server: WebSocketServer) {
    this.server = server;
  }

  onMessage(handler: (message: UnifiedMessage) => void): void {
    this.messageHandler = handler;
  }

  sendMessage(message: OutgoingMessage): Promise<void> {
    if (this.server) {
      this.server.broadcast(message);
    }
    return Promise.resolve();
  }

  // This is called by the WebSocketServer
  handleIncomingMessage(message: UnifiedMessage) {
    if (this.messageHandler) {
      this.messageHandler(message);
    }
  }
}
