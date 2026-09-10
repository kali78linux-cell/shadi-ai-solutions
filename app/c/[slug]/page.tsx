import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getPublicClinicProfile,
  publicClinicUrl,
} from '@/lib/services/clinicPublicProfile';
import { activitySpaceUrl } from '@/lib/services/activityPublicSpace';

/**
 * STEP 15D / Digital Healthcare Space — LEGACY COMPATIBILITY page (`/c/{slug}`).
 *
 * Phase E canonical migration: the canonical public space is now `/{slug}`
 * (activity-aware). `/c/{slug}` is preserved as a compatibility surface —
 * it still renders the deny-by-default clinic projection (existing direct
 * links, QR targets and bookmarked URLs keep working) but its metadata
 * canonicals to `/{slug}` and robots noindexes it, so search engines
 * consolidate the canonical identity without breaking any existing link.
 *
 * No tenant logic changed; booking/chat CTAs remain the existing public paths.
 */
export const dynamic = 'force-dynamic';

const WEEKDAY_NAMES_AR = [
  'الأحد',
  'الاثنين',
  'الثلاثاء',
  'الأربعاء',
  'الخميس',
  'الجمعة',
  'السبت',
];

function formatTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!match) return time;
  const h = Number(match[1]);
  const m = match[2];
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

export type ClinicPublicPageProps = { params: { slug: string } };

export async function generateMetadata({
  params,
}: ClinicPublicPageProps): Promise<Metadata> {
  const resolved = await getPublicClinicProfile({ slug: params.slug });
  if (!resolved) {
    return { title: 'العيادة غير موجودة', robots: { index: false, follow: false } };
  }
  const description =
    resolved.description ??
    `صفحة عيادة ${resolved.name} — احجز موعدك أو تحدث مع الاستقبال.`;
  const canonical = activitySpaceUrl(resolved.slug);
  return {
    title: resolved.name,
    description,
    robots: { index: false, follow: false },
    openGraph: {
      title: resolved.name,
      description,
      type: 'website',
      siteName: resolved.name,
      url: publicClinicUrl(resolved.slug),
    },
    alternates: { canonical },
  };
}

export default async function ClinicPublicPage({ params }: ClinicPublicPageProps) {
  const profile = await getPublicClinicProfile({ slug: params.slug });
  if (!profile) {
    notFound();
  }

  const hasLocation = Boolean(profile.city || profile.area || profile.address);
  const hasServices = profile.services.length > 0;
  const hasHours = profile.workingHours.length > 0;

  return (
    <main dir="rtl" className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* Header */}
        <header className="mb-8 flex flex-col items-center text-center">
          {profile.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.logo}
              alt={`شعار ${profile.name}`}
              className="mb-4 h-20 w-20 rounded-full border border-stone-700 object-cover"
            />
          ) : (
            <div className="mb-4 flex h-20 w-20 items-center justify-center rounded-full border border-stone-700 bg-stone-800 text-2xl font-bold text-teal-300">
              {profile.name.charAt(0)}
            </div>
          )}
          <h1 className="text-3xl font-bold text-white">{profile.name}</h1>
          {profile.description && (
            <p className="mt-3 max-w-xl text-stone-300">{profile.description}</p>
          )}
          {hasLocation && (
            <p className="mt-3 text-sm text-stone-400">
              {[profile.city, profile.area, profile.address]
                .filter(Boolean)
                .join(' — ')}
            </p>
          )}
          {profile.phone && (
            <p className="mt-1 text-sm text-teal-300" dir="ltr">
              {profile.phone}
            </p>
          )}
        </header>

        {/* CTAs */}
        <div className="mb-10 flex flex-wrap justify-center gap-3">
          <a
            href={profile.bookingUrl}
            className="rounded-lg bg-teal-500 px-6 py-3 font-semibold text-stone-900 transition hover:bg-teal-600"
          >
            احجز موعدًا
          </a>
          <a
            href={profile.chatUrl}
            className="rounded-lg border border-stone-600 px-6 py-3 font-semibold text-stone-200 transition hover:border-stone-400"
          >
            تحدث مع الاستقبال
          </a>
        </div>
{/* Services */}
        <section className="mb-10">
          <h2 className="mb-4 text-xl font-semibold text-white">الخدمات</h2>
          {hasServices ? (
            <ul className="space-y-3">
              {profile.services.map((service) => (
                <li
                  key={`${service.name}-${service.duration_minutes ?? 0}`}
                  className="flex items-start justify-between gap-4 rounded-lg border border-stone-800 bg-stone-900 p-4"
                >
                  <div>
                    <h3 className="font-semibold text-stone-100">{service.name}</h3>
                    {service.description && (
                      <p className="mt-1 text-sm text-stone-400">{service.description}</p>
                    )}
                    {service.duration_minutes != null && (
                      <p className="mt-1 text-xs text-stone-500">
                        المدة: {service.duration_minutes} دقيقة
                      </p>
                    )}
                  </div>
                  {service.price != null && (
                    <span className="shrink-0 font-semibold text-teal-300">
                      {service.price} ₪
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-stone-700 p-4 text-sm text-stone-500">
              لا توجد خدمات منشورة بعد.
            </p>
          )}
        </section>

        {/* Working hours */}
        <section>
          <h2 className="mb-4 text-xl font-semibold text-white">ساعات العمل</h2>
          {hasHours ? (
            <ul className="space-y-2 rounded-lg border border-stone-800 bg-stone-900 p-4">
              {profile.workingHours.map((hour) => (
                <li key={hour.weekday} className="flex justify-between text-sm">
                  <span className="text-stone-300">
                    {WEEKDAY_NAMES_AR[hour.weekday] ?? '—'}
                  </span>
                  <span className="text-stone-400" dir="ltr">
                    {formatTime(hour.start_time)} — {formatTime(hour.end_time)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-lg border border-dashed border-stone-700 p-4 text-sm text-stone-500">
              لم تُحدّث ساعات العمل بعد.
            </p>
          )}
        </section>

        <footer className="mt-12 text-center text-xs text-stone-600">
          © AI-Receptions · الصفحة العامة للعيادة
        </footer>
      </div>
    </main>
  );
}