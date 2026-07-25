import { ChannelType } from './types';

export interface ChannelSettings {
  enabled: boolean;
  businessNumber?: string;
  botToken?: string;
  webhookUrl?: string;
  rateLimit?: number;
  workingHours?: {
    start: string;
    end: string;
  };
  autoReply?: {
    [key: string]: string;
  };
}

export class GatewaySettings {
  async getChannelSettings(clinicId: string, channel: ChannelType): Promise<ChannelSettings> {
    console.log(`Getting settings for ${channel} in clinic ${clinicId}`);
    // TODO: Implement settings retrieval from database
    return {
      enabled: true,
    };
  }
}
