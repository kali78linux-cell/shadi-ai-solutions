
export interface WhatsAppMessage {
  object: string;
  entry: {
    id: string;
    changes: {
      value: {
        messaging_product: string;
        metadata: {
          display_phone_number: string;
          phone_number_id: string;
        };
        contacts: {
          profile: {
            name: string;
          };
          wa_id: string;
        }[];
        messages: {
          from: string;
          id: string;
          timestamp: string;
          text?: {
            body: string;
          };
          type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'location' | 'interactive';
        }[];
      };
      field: string;
    }[];
  }[];
}
