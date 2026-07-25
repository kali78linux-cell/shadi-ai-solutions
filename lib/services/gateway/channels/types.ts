
import { UnifiedMessage, OutgoingMessage } from '../types';

export interface Channel {
  readonly channelType: string;
  init(): Promise<void>;
  onMessage(handler: (message: UnifiedMessage) => void): void;
  sendMessage(message: OutgoingMessage): Promise<void>;
}
