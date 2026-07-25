# shadi-ai-solutions

This project uses Next.js and Supabase.

## Knowledge ingestion tests

Run the local knowledge-ingestion harness with:

```bash
npm run test:knowledge
```

This command performs the following verification steps:

- Environment configuration checks for Supabase and embedding provider variables
- Optional Supabase database connectivity verification (if env vars are present)
- Document ingestion flow for TXT, PDF, and DOCX fixtures
- Chunking and embedding behavior
- Knowledge storage and tenant isolation behavior using the test harness

### Required environment variables

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` or `GEMINI_API_KEY`

If Supabase environment variables are missing, the harness will still run local ingestion tests, but Supabase connectivity verification is skipped.

### Expected output

A successful run prints the environment status and a Vitest summary for the knowledge ingestion suite.

Example output:

```bash
Environment: starting knowledge ingestion verification
NEXT_PUBLIC_SUPABASE_URL: configured
NEXT_PUBLIC_SUPABASE_ANON_KEY: configured
SUPABASE_SERVICE_ROLE_KEY: configured
OpenAI/Gemini API key: configured
Supabase connection: success

> npx vitest run tests/knowledge/knowledge-ingestion.test.ts --maxWorkers=1 --minWorkers=1

  PASS  tests/knowledge/knowledge-ingestion.test.ts > knowledge ingestion test suite
    ✓ parses a plain text fixture
    ✓ parses the pricing fixture
    ✓ parses the FAQ fixture
    ✓ parses a PDF fixture
    ✓ parses a DOCX fixture
    ✓ chunks text with overlap
    ✓ generates embeddings through the registered provider
    ✓ ingests document content, stores it, and enables retrieval
    ✓ keeps tenant data isolated between clinics
    ✓ can ingest structured knowledge items
    ✓ reports environment and provider status

Knowledge ingestion verification completed successfully.
```
