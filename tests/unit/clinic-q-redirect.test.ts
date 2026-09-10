import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/q/[publicId]/route';
import { activitySpaceUrl } from '@/lib/services/activityPublicSpace';

vi.mock('@/lib/services/activityPublicSpace', () => ({
  activitySpaceUrl: (slug: string) => `https://clinics.example.com/${slug}`,
}));

// STEP 15D — /q/{publicId} redirect route (QR destination).

const mockState = vi.hoisted(() => ({ clinic: null as { id: string; slug: string; name: string } | null }));
vi.mock('@/lib/services/clinics', () => ({
  resolvePublicClinic: vi.fn(async () => mockState.clinic),
}));

describe('15D — GET /q/[publicId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.clinic = { id: '11111111-1111-1111-1111-111111111111', slug: 'demo-clinic', name: 'Demo' };
  });

  it('redirects (302) to the canonical /{slug} activity space (Phase E)', async () => {
    const res = await GET(new Request('https://clinics.example.com/q/pub_xyz'), {
      params: { publicId: 'pub_xyz' },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://clinics.example.com/demo-clinic');
  });

  it('returns 404 for an unknown public id', async () => {
    mockState.clinic = null;
    const res = await GET(new Request('https://clinics.example.com/q/nope'), {
      params: { publicId: 'nope' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for empty / oversized public ids', async () => {
    const empty = await GET(new Request('https://clinics.example.com/q/'), { params: { publicId: '  ' } });
    expect(empty.status).toBe(404);
    const huge = await GET(new Request('https://clinics.example.com/q/x'), {
      params: { publicId: 'x'.repeat(200) },
    });
    expect(huge.status).toBe(404);
  });
});