// tests/integration/knowledge-upload.test.ts
import { test, expect, describe, vi, beforeAll, afterAll, beforeEach, type Mock } from 'vitest';
import { POST } from '@/app/api/knowledge/upload/route';
import { KnowledgeService } from '@/lib/services/knowledgeService';

// Mock next/headers to prevent cookies() from throwing outside a request scope
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => undefined,
    set: () => {},
  }),
}));

// Mock @supabase/ssr so createServerClient returns our mock client without calling cookies()
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}));

vi.mock('@/lib/services/knowledgeService', () => ({
  KnowledgeService: vi.fn(),
}));

import { createServerClient } from '@supabase/ssr';

describe('Knowledge Upload API Endpoint', () => {
  const mockUser = { id: 'user-123', email: 'test@example.com' };
  const mockClinicId = 'clinic-456';
  const mockDocument = { id: 'doc-789', original_filename: 'test.txt' };

  const mockSupabaseClient = {
    auth: {
      getSession: vi.fn(),
    },
    from: vi.fn(),
  };

  const mockHandleUpload = vi.fn();

  beforeAll(() => {
    (createServerClient as Mock).mockReturnValue(mockSupabaseClient);
    (KnowledgeService as Mock).mockImplementation(() => ({
      handleUpload: mockHandleUpload,
    }));
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    (createServerClient as Mock).mockReturnValue(mockSupabaseClient);
    (KnowledgeService as Mock).mockImplementation(() => ({
      handleUpload: mockHandleUpload,
    }));
  });

  test('should return 401 if user is not authenticated', async () => {
    mockSupabaseClient.auth.getSession.mockResolvedValue({ data: { session: null } });

    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  test('should return 401 if user has no active clinic', async () => {
    mockSupabaseClient.auth.getSession.mockResolvedValue({ data: { session: { user: mockUser } } });
    const chainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    mockSupabaseClient.from.mockReturnValue(chainable);

    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('No active clinic found.');
  });

  test('should return 400 if no file is provided', async () => {
    mockSupabaseClient.auth.getSession.mockResolvedValue({ data: { session: { user: mockUser } } });
    const chainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { clinic_id: mockClinicId }, error: null }),
    };
    mockSupabaseClient.from.mockReturnValue(chainable);

    const formData = new FormData();
    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('No file provided.');
  });

  test('should successfully ingest a document and return 200', async () => {
    mockSupabaseClient.auth.getSession.mockResolvedValue({ data: { session: { user: mockUser } } });
    const chainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { clinic_id: mockClinicId }, error: null }),
    };
    mockSupabaseClient.from.mockReturnValue(chainable);
    mockHandleUpload.mockResolvedValue(mockDocument);

    const fileContent = 'This is a test file.';
    const file = new File([fileContent], 'test.txt', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({ message: 'Upload successful, processing started.', document: mockDocument });
    expect(mockHandleUpload).toHaveBeenCalledWith({
      file: expect.any(File),
      clinicId: mockClinicId,
      userId: mockUser.id,
    });
  });

  test('should return 500 if ingestion fails', async () => {
    mockSupabaseClient.auth.getSession.mockResolvedValue({ data: { session: { user: mockUser } } });
    const chainable = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { clinic_id: mockClinicId }, error: null }),
    };
    mockSupabaseClient.from.mockReturnValue(chainable);
    mockHandleUpload.mockRejectedValue(new Error('Ingestion failed'));

    const fileContent = 'This is a test file.';
    const file = new File([fileContent], 'test.txt', { type: 'text/plain' });
    const formData = new FormData();
    formData.append('file', file);

    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(500);
    // Security: internal ingestion errors must NOT leak to the client.
    expect(json.error).not.toContain('Ingestion failed');
    expect(json.error).toContain('Upload failed');
  });
});
