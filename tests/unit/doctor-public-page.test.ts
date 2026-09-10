import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateMetadata, DoctorPublicPageProps } from '@/app/d/[slug]/page';

/**
 * PP-8B-ii — /d/{slug} visibility contract + metadata baseline.
 * noindex → robots noindex/nofollow · indexable → index/follow ·
 * private → projection returns null → notFound().
 */

const mockState = vi.hoisted(() => ({ profile: null as any }));
vi.mock('@/lib/services/doctorPublicProfile', () => ({
  getDoctorPublicProfile: vi.fn(async () => mockState.profile),
  doctorPublicUrl: (slug: string) => `https://clinics.example.com/d/${slug}`,
}));
vi.mock('next/navigation', () => ({ notFound: vi.fn() }));

const baseProfile = {
  slug: 'dr-ahmadhassan',
  name: 'Dr. Ahmad Hassan',
  title: 'Dentist (Demo)',
  specialty: 'طب الأسنان العام',
  bio: 'نبذة تجريبية',
  photo_url: null as string | null,
  visibility: 'noindex' as 'noindex' | 'indexable',
  clinic: {
    name: 'Demo Dental Clinic',
    slug: 'demo-dental-clinic',
    city: 'عمّان',
    area: null,
    address: null,
    phone: null,
    pageUrl: 'https://clinics.example.com/c/demo-dental-clinic',
  },
  services: [],
  workingHours: [],
  bookingUrl: '/book?slug=demo-dental-clinic',
  chatUrl: '/chat?clinic=demo-dental-clinic',
  pageUrl: 'https://clinics.example.com/d/dr-ahmadhassan',
};

function props(): DoctorPublicPageProps {
  return { params: { slug: 'dr-ahmadhassan' } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockState.profile = { ...baseProfile };
});

describe('PP-8B-ii — /d/{slug} generateMetadata (visibility contract)', () => {
  it('noindex profile → robots index:false, follow:false + canonical/OG', async () => {
    mockState.profile = { ...baseProfile, visibility: 'noindex' };
    const meta = await generateMetadata(props());
    expect(meta.robots).toEqual({ index: false, follow: false });
    expect(meta.alternates?.canonical).toBe('https://clinics.example.com/d/dr-ahmadhassan');
    expect(meta.openGraph?.url).toBe('https://clinics.example.com/d/dr-ahmadhassan');
    expect(meta.title).toBe('Dr. Ahmad Hassan — طب الأسنان العام');
  });

  it('indexable profile → robots index:true, follow:true', async () => {
    mockState.profile = { ...baseProfile, visibility: 'indexable' };
    const meta = await generateMetadata(props());
    expect(meta.robots).toEqual({ index: true, follow: true });
  });

  it('unresolvable profile (private/missing) → not-found title + noindex', async () => {
    mockState.profile = null;
    const meta = await generateMetadata(props());
    expect(meta.title).toBe('الطبيب غير موجود');
    expect(meta.robots).toEqual({ index: false, follow: false });
  });
});
