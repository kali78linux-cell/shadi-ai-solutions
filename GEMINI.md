# Project Overview: Dental AI Receptionist

This project is a multi-tenant SaaS application designed for dental clinics, acting as an "AI Receptionist". It's built with Next.js, TypeScript, and Supabase. The application provides an Arabic-language user interface.

The core of the project is an AI-powered chatbot that can handle patient inquiries, book appointments, and answer questions. Its knowledge is derived from documents (like FAQs, service descriptions) uploaded by each clinic, creating a clinic-specific knowledge base.

## Key Architectural Concepts

*   **Framework:** Next.js 14 (App Router)
*   **Database & Auth:** Supabase (PostgreSQL) is used for data storage, authentication, and Row Level Security (RLS) to enforce multi-tenancy.
*   **Styling:** Tailwind CSS
*   **AI Orchestration:** A custom AI orchestrator in `lib/ai/orchestrator.ts` manages the conversation flow. It uses a Retrieval-Augmented Generation (RAG) pattern:
    1.  A user message comes in.
    2.  Context is retrieved from the clinic-specific `knowledge_base` table in Supabase.
    3.  A prompt is constructed using this context.
    4.  The prompt is sent to an AI provider (e.g., OpenAI) to generate a response.
*   **Knowledge Ingestion:** The system can parse `.txt`, `.pdf`, and `.docx` files to populate the knowledge base.
*   **Testing:** The project uses Vitest for unit and integration testing.

## Database Schema

The database schema is defined in `db/schema.sql`. It's a multi-tenant design centered around the `clinics` table. Key tables include:

*   `clinics`: The central tenant table.
*   `clinic_users`: Manages staff access and roles (`owner`, `admin`, `receptionist`).
*   `patients`, `leads`, `appointments`: Core CRM and scheduling tables.
*   `conversations`, `messages`: Stores the history of AI and user interactions.
*   `knowledge_base`: Stores the vectorized and text content for the RAG system.

Row Level Security is heavily used to ensure that clinic staff can only access their own clinic's data.

## Building and Running the Project

### Environment Setup

1.  Create a `.env.local` file by copying `.env.example`.
2.  Fill in the Supabase and AI provider (e.g., `OPENAI_API_KEY`) credentials.

```bash
# Required for Supabase connection
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...

# Required for backend operations and tests
SUPABASE_SERVICE_ROLE_KEY=...

# Required for AI features
OPENAI_API_KEY=...
# or
GEMINI_API_KEY=...
```

### Key Commands

The main scripts are defined in `package.json`:

*   **Run development server:**
    ```bash
    npm run dev
    ```

*   **Run tests:**
    ```bash
    npm run test
    ```

*   **Test the Knowledge Ingestion Pipeline:** This is a crucial test suite for the core AI functionality.
    ```bash
    npm run test:knowledge
    ```

*   **Build for production:**
    ```bash
    npm run build
    ```

*   **Start production server:**
    ```bash
    npm run start
    ```

*   **Lint the code:**
    ```bash
    npm run lint
    ```

## Development Conventions

*   **Path Aliases:** The project uses the `@/*` alias to refer to the root directory (e.g., `import { supabase } from '@/lib/supabase'`). This is configured in `tsconfig.json`.
*   **Testing:** Vitest is the testing framework. Test files are located in the `tests/` directory, with mocks for external libraries in `tests/mocks/`.
*   **UI:** The user interface is primarily in Arabic and uses a Right-to-Left (RTL) layout, configured in `app/layout.tsx`.
*   **Core Logic:**
    *   AI-related logic is centralized in `lib/ai/`.
    *   Supabase client instances are in `lib/supabase.ts` and `lib/supabaseClient.ts`.
    *   Business logic and services are located in `lib/services/`.
    *   Database schema and migrations are in the `db/` directory.
