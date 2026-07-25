export type Conversation = {
  id: string;
  clinic_id?: string | null;
  user_id?: string | null;
  message: string;
  role: 'user' | 'assistant' | 'system';
  created_at: string;
};
