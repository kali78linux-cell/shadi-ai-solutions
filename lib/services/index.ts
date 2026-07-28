import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractTextFromBuffer, chunkText } from '../_shared/docParser.ts';
import { getProvider, OpenAIProvider, registerProvider } from '../_shared/provider.ts';

// In a real Supabase project, shared files live in `supabase/functions/_shared/`
// The AIProvider must be registered within the Deno runtime.
registerProvider(new OpenAIProvider());

async function updateDocumentStatus(supabaseAdmin, documentId, status, extra = {}) {
  await supabaseAdmin.from('clinic_knowledge_documents').update({ processing_status: status, ...extra }).eq('id', documentId);
}

Deno.serve(async (req) => {
  const { documentId, storagePath } = await req.json();

  // The service_role key is required for cross-tenant operations in a background job.
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  try {
    await updateDocumentStatus(supabaseAdmin, documentId, 'processing');

    const { data: fileData, error: downloadError } = await supabaseAdmin.storage.from('knowledge_documents').download(storagePath);
    if (downloadError) throw downloadError;

    const fileBuffer = await fileData.arrayBuffer();
    const content = await extractTextFromBuffer(new Uint8Array(fileBuffer));

    await updateDocumentStatus(supabaseAdmin, documentId, 'chunking');
    const chunks = chunkText(content);

    await updateDocumentStatus(supabaseAdmin, documentId, 'embedding');
    const provider = getProvider();
    const { data: doc } = await supabaseAdmin.from('clinic_knowledge_documents').select('clinic_id').eq('id', documentId).single();
    const clinicId = doc?.clinic_id;

    if (!clinicId) throw new Error(`Could not find clinic for document ${documentId}`);

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const { embedding } = await provider.embed!(chunk);
      const { error: chunkError } = await supabaseAdmin.from('clinic_ai_knowledge').insert({
        document_id: documentId,
        clinic_id: clinicId,
        type: 'unstructured',
        content: chunk,
        chunk_index: i,
        embedding_vector: embedding,
      });
      if (chunkError) throw chunkError;
    }

    await updateDocumentStatus(supabaseAdmin, documentId, 'indexed', {
      chunk_count: chunks.length,
      indexed_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    await updateDocumentStatus(supabaseAdmin, documentId, 'error');
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});