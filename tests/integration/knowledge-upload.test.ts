// tests/integration/knowledge-upload.test.ts
import { test, expect, describe, vi, beforeAll, afterAll } from 'vitest';
import { POST } from '@/app/api/knowledge/upload/route';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { getActiveClinic } from '@/lib/services/clinics';
import { ingestDocument } from '@/lib/services/knowledgeService';

// Mock dependencies
vi.mock('@/lib/supabase/server');
vi.mock('@/lib/services/clinics');
vi.mock('@/lib/services/knowledgeService');

describe('Knowledge Upload API Endpoint', () => {
  const mockSupabaseClient = {
    auth: {
      getUser: vi.fn(),
    },
  };
  const mockUser = { id: 'user-123', email: 'test@example.com' };
  const mockClinic = { id: 'clinic-456', name: 'Test Clinic' };
  const mockDocument = { id: 'doc-789', original_filename: 'test.txt' };

  beforeAll(() => {
    (createSupabaseServerClient as vi.Mock).mockReturnValue(mockSupabaseClient);
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  test('should return 401 if user is not authenticated', async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: null } });

    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.error).toBe('Unauthorized');
  });

  test('should return 403 if user has no active clinic', async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
    (getActiveClinic as vi.Mock).mockResolvedValue(null);

    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
    });
    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe('No active clinic found');
  });

  test('should return 400 if no file is provided', async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
    (getActiveClinic as vi.Mock).mockResolvedValue(mockClinic);

    const formData = new FormData();
    const request = new Request('http://localhost/api/knowledge/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('No file provided');
  });

  test('should successfully ingest a document and return 200', async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
    (getActiveClinic as vi.Mock).mockResolvedValue(mockClinic);
    (ingestDocument as vi.Mock).mockResolvedValue(mockDocument);

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
    expect(json).toEqual(mockDocument);
    expect(ingestDocument).toHaveBeenCalledWith(
      mockClinic.id,
      mockUser.id,
      expect.any(Buffer),
      'test.txt'
    );
  });

  test('should return 500 if ingestion fails', async () => {
    mockSupabaseClient.auth.getUser.mockResolvedValue({ data: { user: mockUser } });
    (getActiveClinic as vi.Mock).mockResolvedValue(mockClinic);
    (ingestDocument as vi.Mock).mockRejectedValue(new Error('Ingestion failed'));

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
    expect(json.error).toContain('Ingestion failed');
  });
});
