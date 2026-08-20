-- Add separate prompt and completion token counts to ai_usage
ALTER TABLE public.ai_usage
ADD COLUMN prompt_tokens INTEGER,
ADD COLUMN completion_tokens INTEGER;

-- Rename tokens_consumed to total_tokens (conditional for idempotency)
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ai_usage' AND column_name = 'tokens_consumed'
  ) THEN
    ALTER TABLE public.ai_usage RENAME COLUMN tokens_consumed TO total_tokens;
  END IF;
END $$;

-- Add prompt_tokens to messages table for per-message analysis
ALTER TABLE public.messages
ADD COLUMN prompt_tokens INTEGER,
ADD COLUMN completion_tokens INTEGER;
