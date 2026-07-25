
export type ChannelType = 'whatsapp' | 'telegram' | 'messenger' | 'instagram' | 'web';

export interface UnifiedMessage {
  channel: ChannelType;
  channelId: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  timestamp: number;
  message: {
    id: string;
    type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'interactive';
    text?: string;
    mediaUrl?: string;
    caption?: string;
    location?: {
      latitude: number;
      longitude: number;
      name?: string;
      address?: string;
    };
    interactive?: {
      type: 'button' | 'list';
      header?: string;
      body: string;
      footer?: string;
      action: {
        buttons: {
          id: string;
          title: string;
        }[];
      };
    };
    quickReplies?: {
      id: string;
      title: string;
    }[];
  };
  metadata?: Record<string, any>;
}

export interface OutgoingMessage {
    channel: ChannelType;
    recipientId: string;
    message: {
      type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'template' | 'interactive';
      text?: string;
      mediaUrl?: string;
      template?: {
        name: string;
        language: string;
        components: any[];
      };
      interactive?: any;
    };
}
