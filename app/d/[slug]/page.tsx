import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getDoctorPublicProfile,
  doctorPublicUrl,
} from '@/lib/services/doctorPublicProfile';
import { buildDoctorJsonLd } from '@/lib/services/doctorJsonLd';

/**
 * PP-8B-ii — Public Doctor Profile page (/d/{publicSlug}).
 *
 * A Professional Digital Presence + Conversion Surface — NOT a CRUD page.
 * Psychology-first structure (owner direction): Hero answers "من هو؟ ما تخصصه؟
 * أين يعمل؟ ماذا يقدم؟ ما الإجراء التالي؟" in the first viewport, then the
 * page moves Identity → Authority → Relevance → Trust → Action. PR-EMO governs
 * copy and hierarchy — honest by design: no fake reviews/ratings/counts/claims.
 *
 * Renders ONLY the deny-by-default allow-list from getDoctorPublicProfile
 * (the single projection 8C/8D will reuse). Visibility contract:
 *   private   → 404 (never resolves)
 *   noindex   → reachable by link, robots noindex/nofollow
 *   indexable → fully public + indexable
 * Booking/chat CTAs reuse the existing public paths — zero 15D impact.
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
  const m = Number(match[2]);
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export type DoctorPublicPageProps = { params: { slug: string } };

export async function generateMetadata({
  params,
}: DoctorPublicPageProps): Promise<Metadata> {
  const profile = await getDoctorPublicProfile({ slug: params.slug });
  if (!profile) {
    return { title: 'الطبيب غير موجود', robots: { index: false, follow: false } };
  }
  const title = profile.specialty
    ? `${profile.name} — ${profile.specialty}`
    : profile.name;
  const description =
    profile.bio?.slice(0, 160) ??
    (profile.specialty
      ? `${profile.specialty} في ${profile.clinic.name} — احجز موعدك أو تحدث مع الاستقبال الذكي.`
      : `${profile.clinic.name} — احجز موعدك أو تحدث مع الاستقبال الذكي.`);
  const canonical = doctorPublicUrl(profile.slug);
  return {
    title,
    description,
    alternates: { canonical },
    // Visibility contract enforced at the page level from day one (PP-8B):
    robots:
      profile.visibility === 'noindex'
        ? { index: false, follow: false }
        : { index: true, follow: true },
    openGraph: {
      title,
      description,
      type: 'profile',
      url: canonical,
      siteName: profile.clinic.name,
    },
  };
}

function HeroCtas({ bookingUrl, chatUrl }: { bookingUrl: string; chatUrl: string }) {
  return (
    <div className="w-full">
      <div className="flex flex-col justify-center gap-3 sm:flex-row">
        <a
          href={bookingUrl}
          className="rounded-lg bg-teal-500 px-8 py-3 text-center font-semibold text-stone-900 transition hover:bg-teal-400"
        >
          احجز موعدًا
        </a>
        <a
          href={chatUrl}
          className="rounded-lg border border-stone-600 px-8 py-3 text-center font-semibold text-stone-100 transition hover:border-stone-400"
        >
          تحدث مع الاستقبال الذكي
        </a>
      </div>
      <p className="mt-3 text-center text-xs text-stone-500">
        الحجز يتم عبر نظام العيادة مباشرة — بدون مكالمات أو انتظار، ويعمل على مدار الساعة.
      </p>
    </div>
  );
}

export default async function DoctorPublicPage({ params }: DoctorPublicPageProps) {
  const profile = await getDoctorPublicProfile({ slug: params.slug });
  if (!profile) {
    notFound();
  }

  const hasServices = profile.services.length > 0;
  const hasHours = profile.workingHours.length > 0;
  const locationBits = [profile.clinic.city, profile.clinic.area].filter(Boolean);
  const jsonLd = buildDoctorJsonLd(profile);

  return (
    <main dir="rtl" className="min-h-screen bg-stone-950 text-stone-100">
      {/* PP-8C — structured data baseline (built from the public projection only). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
      {/* ============ HERO — من هو؟ ماذا يفعل؟ أين؟ لماذا أثق؟ ماذا أفعل الآن؟ ============ */}
      <section className="border-b border-stone-800 bg-gradient-to-b from-stone-900 to-stone-950">
        <div className="mx-auto flex max-w-3xl flex-col items-center px-4 py-12 text-center sm:py-16">
          {profile.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.photo_url}
              alt={`صورة ${profile.name}`}
              className="mb-5 h-28 w-28 rounded-full border-2 border-teal-500/60 object-cover shadow-lg"
            />
          ) : (
            <div className="mb-5 flex h-28 w-28 items-center justify-center rounded-full border-2 border-teal-500/40 bg-stone-800 text-3xl font-bold text-teal-300">
              {profile.name.charAt(0)}
            </div>
          )}

          <h1 className="text-3xl font-bold text-white sm:text-4xl">{profile.name}</h1>
          <p className="mt-2 text-lg font-medium text-teal-300">
            {[profile.title, profile.specialty].filter(Boolean).join(' · ') || 'مقدم رعاية أسنان'}
          </p>

          <p className="mt-3 text-sm text-stone-400">
            <span>{profile.clinic.name}</span>
            {locationBits.length > 0 && <span> · {locationBits.join(' — ')}</span>}
          </p>

          <p className="mt-4 max-w-xl text-sm leading-relaxed text-stone-300">
            استقبال ذكي يرد على أسئلتك ويساعدك على الحجز في أي وقت — وخدمات واضحة
            وساعات عمل معلنة، حتى تعرف تمامًا ماذا تتوقع قبل زيارتك.
          </p>

          <div className="mt-6 w-full">
            <HeroCtas bookingUrl={profile.bookingUrl} chatUrl={profile.chatUrl} />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-3xl px-4 py-10">
        {/* ============ EMPATHY (PR-EMO) ============ */}
        <section className="mb-10 rounded-xl border border-stone-800 bg-stone-900 p-5 text-center">
          <p className="text-sm leading-relaxed text-stone-300">
            مشغول في العمل؟ لا وقت للمكالمات؟ اكتب مشكلتك للاستقبال الذكي وسيساعدك على
            اختيار الخدمة المناسبة وحجز الوقت المناسب — خطوة بخطوة ودون ضغط.
          </p>
        </section>

        {/* ============ AUTHORITY — عن الطبيب ============ */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold text-white">عن الطبيب</h2>
          {profile.bio ? (
            <p className="whitespace-pre-line rounded-xl border border-stone-800 bg-stone-900 p-5 text-sm leading-relaxed text-stone-300">
              {profile.bio}
            </p>
          ) : (
            <p className="rounded-xl border border-dashed border-stone-700 p-4 text-sm text-stone-500">
              لم تُضف النبذة المهنية بعد.
            </p>
          )}
        </section>

        {/* ============ RELEVANCE — الخدمات ومجالات الممارسة ============ */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold text-white">الخدمات ومجالات الممارسة</h2>
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
                  {(service.price != null || service.price_min != null) && (
                    <span className="shrink-0 font-semibold text-teal-300">
                      {service.price != null
                        ? `${service.price} ₪`
                        : `${service.price_min ?? ''}${service.price_min != null && service.price_max != null ? '–' : ''}${service.price_max != null ? `${service.price_max} ₪` : ''}`}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-stone-700 p-4 text-sm text-stone-500">
              لا توجد خدمات منشورة بعد — تواصل مع الاستقبال للاستفسار عن الخدمات المتاحة.
            </p>
          )}
        </section>

        {/* ============ TRUST — ساعات العمل ============ */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold text-white">ساعات العمل</h2>
          {hasHours ? (
            <ul className="space-y-2 rounded-xl border border-stone-800 bg-stone-900 p-4">
              {profile.workingHours.map((hour) => (
                <li key={hour.weekday} className="flex justify-between text-sm">
                  <span className="text-stone-300">{WEEKDAY_NAMES_AR[hour.weekday] ?? '—'}</span>
                  <span className="text-stone-400" dir="ltr">
                    {formatTime(hour.start_time)} — {formatTime(hour.end_time)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="rounded-xl border border-dashed border-stone-700 p-4 text-sm text-stone-500">
              لم تُحدّث ساعات العمل بعد.
            </p>
          )}
        </section>

        {/* ============ TRUST — مكان العمل والتواصل ============ */}
        <section className="mb-10">
          <h2 className="mb-3 text-xl font-semibold text-white">مكان العمل</h2>
          <div className="rounded-xl border border-stone-800 bg-stone-900 p-5">
            <p className="font-semibold text-stone-100">{profile.clinic.name}</p>
            {locationBits.length > 0 && (
              <p className="mt-1 text-sm text-stone-400">{locationBits.join(' — ')}</p>
            )}
            {profile.clinic.address && (
              <p className="mt-1 text-sm text-stone-400">{profile.clinic.address}</p>
            )}
            {profile.clinic.phone && (
              <p className="mt-1 text-sm text-teal-300" dir="ltr">
                {profile.clinic.phone}
              </p>
            )}
            <a
              href={profile.clinic.pageUrl}
              className="mt-3 inline-flex items-center gap-1 text-sm text-teal-300 hover:underline"
            >
              صفحة العيادة العامة
            </a>
          </div>
        </section>

        {/* ============ ACTION — CTA ختامي مبرَّر ============ */}
        <section className="mb-10 rounded-xl border border-teal-500/30 bg-stone-900 p-6 text-center">
          <h2 className="text-xl font-semibold text-white">جاهز للخطوة التالية؟</h2>
          <p className="mt-2 text-sm text-stone-400">
            اختر الوقت المناسب لك عبر الحجز المباشر، أو اسأل الاستقبال الذكي عن أي خدمة قبل أن تحدد.
          </p>
          <div className="mt-5">
            <HeroCtas bookingUrl={profile.bookingUrl} chatUrl={profile.chatUrl} />
          </div>
        </section>

        <footer className="mt-4 text-center text-xs text-stone-600">
          © AI-Receptions · الصفحة العامة للطبيب ·{' '}
          <a href="/" className="hover:underline">
            منصة الاستقبال الذكي للعيادات
          </a>
        </footer>
      </div>
    </main>
  );
}

