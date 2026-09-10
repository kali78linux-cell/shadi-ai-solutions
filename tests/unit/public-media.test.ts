import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateMediaFile,
  buildMediaStoragePath,
  mediaPublicUrl,
  deleteClinicMedia,
  MEDIA_BUCKET,
} from '@/lib/services/clinicPublicMedia';
import { validateDisplayPatch, readDisplaySettings } from '@/lib/services/clinicPublicConfig';

/**
 * CLINIC PUBLIC MEDIA + DISPLAY CONTROLS — service tests.
 * Covers: server-side MIME/size/extension validation, tenant-isolated storage
 * paths, delete isolation (other tenant's media can never be touched), and the
 * strictly bounded display settings (enums only — no raw CSS passthrough).
 */

const CID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mockState = vi.hoisted(() => ({
  row: null as any,
  readError: null as any,
  deleteError: null as any,
  removeCall: null as any,
}));

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const chain: any = {};
      chain.select = () => chain;
      chain.is = () => chain;
      chain.eq = () => chain;
      chain.maybeSingle = () => ({ data: mockState.row, error: mockState.readError });
      chain.delete = () => chain;
      chain.update = () => ({ data: null, error: null });
      chain.insert = () => chain;
      chain.order = () => chain;
      chain.limit = () => chain;
      return chain;
    }),
    storage: {
      from: vi.fn(() => ({
        remove: vi.fn(async (paths: string[]) => {
          mockState.removeCall = paths;
          return { error: null };
        }),
      })),
    },
  },
}));

describe('validateMediaFile', () => {
  it('accepts a valid JPEG image', () => {
    const r = validateMediaFile({ name: 'room.jpg', type: 'image/jpeg', size: 1000 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mediaType).toBe('image');
      expect(r.ext).toBe('.jpg');
    }
  });

  it('accepts a valid MP4 video', () => {
    const r = validateMediaFile({ name: 'tour.mp4', type: 'video/mp4', size: 2000 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mediaType).toBe('video');
  });

  it('rejects an unsupported MIME even with a harmless name', () => {
    const r = validateMediaFile({ name: 'script.png', type: 'text/html', size: 100 });
    expect(r.ok).toBe(false);
    if ('message' in r) expect(r.message).toContain('غير مدعوم');
  });

  it('rejects an oversized file', () => {
    const r = validateMediaFile({ name: 'big.png', type: 'image/png', size: 30 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    if ('message' in r) expect(r.message).toContain('25MB');
  });

  it('rejects a mismatched extension', () => {
    const r = validateMediaFile({ name: 'evil.jpg.exe', type: 'image/jpeg', size: 100 });
    expect(r.ok).toBe(false);
    if ('message' in r) expect(r.message).toContain('امتداد');
  });

  it('rejects an empty file', () => {
    const r = validateMediaFile({ name: 'empty.png', type: 'image/png', size: 0 });
    expect(r.ok).toBe(false);
  });
});

describe('buildMediaStoragePath', () => {
  it('isolates each tenant under clinic/{clinic_id}/public-media/', () => {
    const path = buildMediaStoragePath(CID, '.png');
    expect(path.startsWith(`clinic/${CID}/public-media/`)).toBe(true);
    expect(path.endsWith('.png')).toBe(true);
  });

  it('never uses the original filename (injection-safe)', () => {
    const path = buildMediaStoragePath(CID, '.jpg');
    expect(path.includes('..')).toBe(false);
    expect(/[a-f0-9-]{36}\.jpg$/.test(path)).toBe(true);
  });
});

describe('mediaPublicUrl', () => {
  it('builds a stable public storage URL', () => {
    const url = mediaPublicUrl('clinic/x/m.png');
    expect(url).toContain(`/storage/v1/object/public/${MEDIA_BUCKET}/clinic/x/m.png`);
  });
});

describe('deleteClinicMedia — tenant isolation', () => {
  beforeEach(() => {
    mockState.row = null;
    mockState.readError = null;
    mockState.deleteError = null;
    mockState.removeCall = null;
  });

  it('refuses to delete when the media row belongs to another tenant (not found)', async () => {
    mockState.row = null; // .eq(clinic_id, mine) .eq(id, theirs) yields no row
    const r = await deleteClinicMedia(CID, '99999999-9999-4999-8999-999999999999');
    expect(r.ok).toBe(false);
    if ('message' in r) expect(r.message).toBe('Media not found');
    expect(mockState.removeCall).toBeNull(); // never touches storage
  });

  it('deletes own media row + storage object', async () => {
    mockState.row = { storage_path: `clinic/${CID}/public-media/abc.jpg` };
    const r = await deleteClinicMedia(CID, '11111111-1111-4111-8111-111111111111');
    expect(r.ok).toBe(true);
    expect(mockState.removeCall).toEqual([`clinic/${CID}/public-media/abc.jpg`]);
  });
});

describe('display controls — strictly bounded enums', () => {
  it('accepts only allowed enum values per key', () => {
    expect(validateDisplayPatch({ body_text: 'large' }).ok).toBe(true);
    expect(validateDisplayPatch({ gallery_spacing: 'roomy' }).ok).toBe(true);
    const bad = validateDisplayPatch({ body_text: 'huge' } as never);
    expect(bad.ok).toBe(false);
  });

  it('rejects unknown keys (no silent coercion)', () => {
    const r = validateDisplayPatch({ fontSize: '20px' } as never);
    expect(r.ok).toBe(false);
    if ('message' in r) expect(r.message).toContain('unknown display key');
  });

  it('falls back to safe defaults for invalid stored values', () => {
    const d = readDisplaySettings({ public_profile: { display: { body_text: 'gigantic', heading: 'large' } } });
    expect(d.body_text).toBe('medium'); // invalid → default
    expect(d.heading).toBe('large'); // valid → kept
    expect(d.gallery_spacing).toBe('normal'); // missing → default
  });
});