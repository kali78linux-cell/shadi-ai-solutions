-- Migration: Adds pgvector support for efficient similarity search.

-- 1. Enable the vector extension.
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add a vector column for embeddings.
-- Assuming OpenAI's text-embedding-ada-002 model, which has 1536 dimensions.
ALTER TABLE public.clinic_ai_knowledge
ADD COLUMN IF NOT EXISTS embedding_vector vector(1536);

COMMENT ON COLUMN public.clinic_ai_knowledge.embedding_vector IS 'Vector representation for similarity search.';

-- 3. Create a function to perform similarity search.
CREATE OR REPLACE FUNCTION match_clinic_documents (
  p_clinic_id UUID,
  p_query_embedding vector(1536),
  p_match_threshold FLOAT,
  p_match_count INT
)
RETURNS TABLE (
  id UUID,
  document_id UUID,
  content TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    k.id,
    k.document_id,
    k.content,
    1 - (k.embedding_vector <=> p_query_embedding) AS similarity
  FROM
    public.clinic_ai_knowledge AS k
  WHERE
    k.clinic_id = p_clinic_id
    AND 1 - (k.embedding_vector <=> p_query_embedding) > p_match_threshold
  ORDER BY
    k.embedding_vector <=> p_query_embedding
  LIMIT p_match_count;
END;
$$;

-- 4. Add an index for approximate nearest neighbor search.
-- The number of lists should be roughly sqrt(N) for N up to 1M rows, and N/1000 for larger datasets.
-- Let's start with a sensible default.
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding
ON public.clinic_ai_knowledge
USING ivfflat (embedding_vector vector_l2_ops)
WITH (lists = 100);

-- Note: After adding data, you might need to re-cluster the index.
-- See pgvector documentation for more details on index creation and tuning.

-- Also, let's backfill the new vector column from the old array column if needed.
-- This is an example of how you could do it. It might be slow.
-- UPDATE public.clinic_ai_knowledge SET embedding_vector = embedding::real[]::vector WHERE embedding_vector IS NULL;
