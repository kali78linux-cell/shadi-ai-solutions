
export interface MessengerEvent {
  object: string;
  entry: {
    id: string;
    time: number;
    messaging: {
      sender: {
        id: string;
      };
      recipient: {
        id: string;
      };
      timestamp: number;
      message?: {
        mid: string;
        text: string;
        quick_reply?: {
          payload: string;
        };
      };
    }[];
  }[];
}
