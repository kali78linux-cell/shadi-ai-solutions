import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { clinicQrDestination, clinicQrSvg } from '@/lib/qr/clinicQr';

// STEP 15D — QR module: encodes the stable /q/{publicId} destination.

const ORIGINAL_URL = process.env.NEXT_PUBLIC_APP_URL;

beforeEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = 'https://clinics.example.com';
});

afterEach(() => {
  if (ORIGINAL_URL === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
  else process.env.NEXT_PUBLIC_APP_URL = ORIGINAL_URL;
});

describe('15D — clinic QR', () => {
  it('destination encodes the opaque /q/{publicId} route, not the internal UUID', () => {
    const destination = clinicQrDestination({ publicId: 'pub_xyz_99', slug: 'demo-clinic' });
    expect(destination).toBe('https://clinics.example.com/q/pub_xyz_99');
    expect(destination).not.toContain('/c/demo-clinic');
  });

  it('URL-encodes the public id', () => {
    const destination = clinicQrDestination({ publicId: 'a b/c', slug: 'demo-clinic' });
    expect(destination).toBe('https://clinics.example.com/q/a%20b%2Fc');
  });

  it('generates a server-side SVG (QR data is encoded visually, deterministically)', async () => {
    const svg = await clinicQrSvg({ publicId: 'pub_xyz_99', slug: 'demo-clinic' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox');
    expect(svg.length).toBeGreaterThan(500);

    // Deterministic: same input → identical output.
    const again = await clinicQrSvg({ publicId: 'pub_xyz_99', slug: 'demo-clinic' });
    expect(again).toBe(svg);

    // Different destination → different matrix (proves the URL is encoded, not a static image).
    const other = await clinicQrSvg({ publicId: 'pub_other', slug: 'demo-clinic' });
    expect(other).not.toBe(svg);
  });
});