import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { extractTextFromBuffer, chunkText } from '../_shared/docParser.ts';
import { getProvider, OpenAIProvider } from '../_shared/provider.ts';

// Note: In a real Supabase project, shared files like docParser and provider
// would live in `supabase/functions/_shared/` and be imported as above.
// The AIProvider would also need to be registered here.
registerProvider(OpenAIProvider);

async function updateDocumentStatus(supabase, documentId, status) {
  await supabase.from('clinic_knowledge_documents').update({ processing_status: status }).eq('id', documentId);
}

Deno.serve(async (req) => {
  const { documentId, storagePath } = await req.json();
  const authHeader = req.headers.get('Authorization')!;

  // Create a Supabase client with the user's auth token
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } } }
  );

  // The service_role key is required for downloading from storage and writing to the knowledge base
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

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = await provider.generateEmbedding(chunk);
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

    await supabaseAdmin.from('clinic_knowledge_documents').update({ processing_status: 'indexed', chunk_count: chunks.length, indexed_at: new Date().toISOString() }).eq('id', documentId);

    return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`Error processing document ${documentId}:`, error);
    await updateDocumentStatus(supabaseAdmin, documentId, 'error');
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});