-- Migration: Adds support for managing knowledge base source documents.
-- Creates a dedicated table for source document metadata and links it to the existing knowledge chunks.

-- 1. Create the new tenant-scoped table for knowledge base source documents.
CREATE TABLE IF NOT EXISTS public.clinic_knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID NOT NULL REFERENCES public.clinics(id) ON DELETE CASCADE,
    uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,

    -- File Metadata
    filename TEXT NOT NULL, -- Name on storage
    original_filename TEXT NOT NULL, -- Original user-provided name
    file_type TEXT, -- E.g., 'pdf', 'docx', 'txt'
    mime_type TEXT,
    file_size BIGINT NOT NULL,
    checksum TEXT, -- SHA-256 for deduplication
    language CHAR(2) DEFAULT 'ar',

    -- Storage & Processing
    storage_path TEXT, -- Path in Supabase/S3
    upload_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'success', 'failed'
    processing_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'chunking', 'embedding', 'indexed', 'error'
    chunk_count INTEGER,
    embedding_model TEXT,

    -- Timestamps
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ, -- For soft deletes

    -- Constraints
    CONSTRAINT uq_clinic_storage_path UNIQUE (clinic_id, storage_path)
);

-- 2. Add indexes for performance.
CREATE INDEX IF NOT EXISTS idx_docs_clinic_id ON public.clinic_knowledge_documents(clinic_id);
CREATE INDEX IF NOT EXISTS idx_docs_upload_status ON public.clinic_knowledge_documents(upload_status);
CREATE INDEX IF NOT EXISTS idx_docs_processing_status ON public.clinic_knowledge_documents(processing_status);

-- 3. Add a foreign key to the existing knowledge chunks table to link back to the parent document.
ALTER TABLE public.clinic_ai_knowledge
ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES public.clinic_knowledge_documents(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_knowledge_document_id ON public.clinic_ai_knowledge(document_id);


-- 4. Set up Row Level Security (RLS) for the new table.
ALTER TABLE public.clinic_knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Docs can be managed by active clinic members"
ON public.clinic_knowledge_documents FOR ALL
USING (public.app_user_is_active_clinic_member(clinic_id))
WITH CHECK (public.app_user_is_active_clinic_member(clinic_id));

-- 5. Add trigger for the 'updated_at' timestamp.
CREATE TRIGGER set_updated_at_clinic_knowledge_documents
BEFORE UPDATE ON public.clinic_knowledge_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. Add a comment to clarify the relationship.
COMMENT ON COLUMN public.clinic_ai_knowledge.document_id IS 'Foreign key to the source document from which this knowledge chunk was derived.';

