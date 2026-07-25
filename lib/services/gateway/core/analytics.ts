import { UnifiedMessage } from '../types';

export class GatewayAnalytics {
  async trackMessage(message: UnifiedMessage): Promise<void> {
    console.log('Tracking message:', message);
    // TODO: Implement analytics tracking
  }

  async trackFailedMessage(message: UnifiedMessage): Promise<void> {
    console.log('Tracking failed message:', message);
    // TODO: Implement failure tracking
  }
}
