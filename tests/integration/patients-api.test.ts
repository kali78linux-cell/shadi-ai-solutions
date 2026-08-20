import { describe, expect, test, vi } from 'vitest';
import { GET, POST } from '@/app/api/patients/route';
import { PUT } from '@/app/api/patients/[patientId]/route';

// Force demo mode regardless of environment so the tests are deterministic
// and do not depend on Supabase credentials or a request scope.
vi.mock('@/lib/config', () => ({
  getSupabaseEnvConfig: () => ({ isConfigured: false }),
  isSupabaseConfigured: () => false,
}));

describe('Patients API', () => {
  test('returns a list of patients', async () => {
    const response = await GET(new Request('http://localhost/api/patients?clinic_id=11111111-1111-1111-1111-111111111111'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(Array.isArray(json)).toBe(true);
    expect(json[0]).toMatchObject({ name: expect.any(String) });
  });

  test('creates a patient from the request body', async () => {
    const response = await POST(new Request('http://localhost/api/patients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'سارة أحمد', phone: '0500000000', email: 'sara@example.com', source: 'موقع الويب', status: 'جديد' }),
    }));

    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json).toMatchObject({ name: 'سارة أحمد', phone: '0500000000' });
  });

  test('updates an existing patient from the request body', async () => {
    const existing = await POST(new Request('http://localhost/api/patients', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'مريم', phone: '0555555555', email: 'mariam@example.com', source: 'الهاتف', status: 'قيد المتابعة' }),
    }));
    const patient = await existing.json();

    const response = await PUT(new Request(`http://localhost/api/patients/${patient.id}?clinic_id=11111111-1111-1111-1111-111111111111`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'مريم المحدثة', phone: '0555555555', email: 'mariam@example.com', source: 'الهاتف', status: 'مؤكد' }),
    }));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ name: 'مريم المحدثة', status: 'مؤكد' });
  });
});
