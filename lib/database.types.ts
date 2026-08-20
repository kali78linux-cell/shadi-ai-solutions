export type Database = {
  public: {
    Tables: {
      patients: {
        Row: {
          id: string;
          clinic_id: string;
          full_name?: string | null;
          phone_number?: string | null;
          email?: string | null;
          date_of_birth?: string | null;
          metadata?: Record<string, unknown> | null;
          created_at?: string | null;
          updated_at?: string | null;
          deleted_at?: string | null;
        };
        Insert: {
          id?: string;
          clinic_id: string;
          full_name?: string | null;
          phone_number?: string | null;
          email?: string | null;
          date_of_birth?: string | null;
          metadata?: Record<string, unknown> | null;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
        };
        Update: {
          full_name?: string | null;
          phone_number?: string | null;
          email?: string | null;
          date_of_birth?: string | null;
          metadata?: Record<string, unknown> | null;
          updated_at?: string;
          deleted_at?: string | null;
        };
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
  };
};
