import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: the health/readiness endpoint must never leak internals and
// must degrade to 503 when the DB is unreachable (for uptime monitors).
const mockState = vi.hoisted(() => ({ dbError: null as any }));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: () => ({ limit: () => Promise.resolve({ error: mockState.dbError }) }),
    })),
  },
}));
import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    mockState.dbError = null;
  });

  it('returns 200 healthy with no internals when DB is reachable', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('healthy');
    expect(body.components.db).toBe('ok');
    expect(JSON.stringify(body)).not.toMatch(/service_role|SUPABASE_SERVICE|sk_|whsec/i);
  });

  it('returns 503 unhealthy when DB check fails, without leaking the error', async () => {
    mockState.dbError = { message: 'FATAL: password authentication failed for user "secret-user"' };
    const res = await GET();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.status).toBe('unhealthy');
    expect(body.components.db).not.toBe('ok');
    expect(JSON.stringify(body)).not.toContain('secret-user');
    expect(JSON.stringify(body)).not.toContain('password');
  });
});

