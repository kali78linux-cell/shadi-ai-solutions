import type { Metadata } from 'next';
import { getAppBaseUrl } from '@/lib/communications/links';
import {
  getDiscoveryEntries,
  DISCOVERY_PAGE_SIZE,
} from '@/lib/services/doctorPublicProfile';

/**
 * PP-8D — Discovery V1 (/discover): public directory of eligible doctors.
 *
 * READ-ONLY public surface: search (doctor name / specialty / clinic city-or-area)
 * with deterministic ordering and 20-per-page pagination — no ranking, no
 * reviews, no marketplace features (spec §9). Cards link to the existing
 * public profile pages (/d/{slug}); booking/chat CTAs remain untouched.
 *
 * Eligibility is enforced by getDiscoveryEntries (PP-8A opt-in flag +
 * visibility + publishable type + active clinic + active/trialing subscription).
 * D9: entries are entity-kind scoped ('doctor' today).
 */

export const dynamic = 'force-dynamic';

/**
 * PP-8C/8D correctness: the directory must NEVER be served from Next's fetch
 * data cache (a cached subscriptions response would show stale eligibility).
 * Route-scoped opt-out — the shared supabaseAdmin client stays untouched.
 */
export const fetchCache = 'force-no-store';

export const metadata: Metadata = {
  title: 'دليل الأطباء — ابحث عن طبيب أسنان',
  description:
    'دليل عام لأطباء الأسنان المشتركين على منصة AI-Receptions: ابحث بالاسم أو التخصص أو المدينة، وادخل إلى ملف الطبيب المهني.',
  alternates: { canonical: '/discover' },
};

export type DiscoverPageProps = {
  searchParams?: {
    q?: string;
    specialty?: string;
    city?: string;
    page?: string;
  };
};

function clampParam(v: string | undefined, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function pageParam(v: string | undefined): number {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

export default async function DiscoverPage({ searchParams }: DiscoverPageProps) {
  const sp = searchParams ?? {};
  const q = clampParam(sp.q, 100);
  const specialty = clampParam(sp.specialty, 120);
  const city = clampParam(sp.city, 100);
  const requestedPage = pageParam(sp.page);

  let result = { entries: [] as import('@/lib/services/doctorPublicProfile').DiscoveryEntry[], total: 0, page: 1, pageSize: DISCOVERY_PAGE_SIZE, totalPages: 1 };
  let loadError: string | null = null;
  try {
    result = await getDiscoveryEntries({ q, specialty, city, page: requestedPage });
  } catch (e) {
    loadError = e instanceof Error ? e.message : 'تعذر تحميل الدليل';
  }

  const hasFilters = Boolean(q || specialty || city);

  return (
    <main dir="rtl" className="min-h-screen bg-stone-950 text-stone-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-white">دليل الأطباء</h1>
          <p className="mt-2 text-sm text-stone-400">
            ابحث عن طبيب أسنان مشترك على المنصة، وادخل إلى ملفه المهني لتحجز أو تتحدث مع
            الاستقبال الذكي.
          </p>
        </header>

        {loadError ? (
          <p className="rounded-xl border border-red-900 bg-red-950 p-4 text-sm text-red-300">
            تعذر تحميل الدليل الآن — جرّب لاحقًا.
          </p>
        ) : null}

        {/* ============ SEARCH — بسيطة وغير معقدة ============ */}
        <form
          method="get"
          className="mb-8 grid gap-3 rounded-xl border border-stone-800 bg-stone-900 p-4 sm:grid-cols-3"
        >
          <label className="block text-xs text-stone-400">
            اسم الطبيب
            <input
              type="text"
              name="q"
              maxLength={100}
              defaultValue={q ?? ''}
              placeholder="مثال: أحمد"
              className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            />
          </label>
          <label className="block text-xs text-stone-400">
            التخصص
            <input
              type="text"
              name="specialty"
              maxLength={120}
              defaultValue={specialty ?? ''}
              placeholder="مثال: تقويم"
              className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            />
          </label>
          <label className="block text-xs text-stone-400">
            المدينة / المنطقة
            <input
              type="text"
              name="city"
              maxLength={100}
              defaultValue={city ?? ''}
              placeholder="مثال: عمّان"
              className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-100"
            />
          </label>
          <div className="flex items-center gap-3 sm:col-span-3">
            <button
              type="submit"
              className="rounded-md bg-teal-500 px-6 py-2 text-sm font-semibold text-stone-900 transition hover:bg-teal-400"
            >
              ابحث
            </button>
            {hasFilters && (
              <a href="/discover" className="text-xs text-stone-400 hover:underline">
                مسح الفلاتر
              </a>
            )}
          </div>
        </form>

        {result.entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-stone-700 p-6 text-center text-sm text-stone-500">
            لا نتائج مطابقة — جرّب اسمًا أو تخصصًا أو مدينة أخرى.
          </p>
        ) : (
          <>
            <p className="mb-4 text-xs text-stone-500">
              {result.total} نتيجة · صفحة {result.page} من {result.totalPages}
            </p>
            <ul className="grid gap-4 sm:grid-cols-2">
              {result.entries.map((entry) => (
                <li key={entry.slug} className="rounded-xl border border-stone-800 bg-stone-900 p-4">
                  <a href={`/d/${encodeURIComponent(entry.slug)}`} className="group block">
                    <div className="flex items-center gap-3">
                      {entry.photo_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={entry.photo_url}
                          alt={`صورة ${entry.name}`}
                          className="h-14 w-14 rounded-full border border-teal-500/40 object-cover"
                        />
                      ) : (
                        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-teal-500/30 bg-stone-800 text-xl font-bold text-teal-300">
                          {entry.name.charAt(0)}
                        </div>
                      )}
                      <div>
                        <h2 className="font-semibold text-stone-100 group-hover:text-teal-300">
                          {entry.name}
                        </h2>
                        <p className="text-sm text-teal-300">
                          {entry.specialty ?? entry.title ?? 'مقدم رعاية أسنان'}
                        </p>
                        <p className="mt-0.5 text-xs text-stone-500">
                          {entry.clinicName}
                          {(entry.city || entry.area) &&
                            ` · ${[entry.city, entry.area].filter(Boolean).join(' — ')}`}
                        </p>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-teal-300/80 group-hover:underline">
                      عرض الملف المهني ↗
                    </p>
                  </a>
                </li>
              ))}
            </ul>

            {result.totalPages > 1 && (
              <nav className="mt-8 flex items-center justify-center gap-4 text-sm">
                {result.page > 1 ? (
                  <a
                    href={`/discover${buildQuery({ q, specialty, city, page: String(result.page - 1) })}`}
                    className="rounded-md border border-stone-700 px-4 py-2 text-stone-200 hover:border-stone-400"
                  >
                    السابق
                  </a>
                ) : (
                  <span className="rounded-md border border-stone-800 px-4 py-2 text-stone-600">السابق</span>
                )}
                <span className="text-stone-500">
                  {result.page} / {result.totalPages}
                </span>
                {result.page < result.totalPages ? (
                  <a
                    href={`/discover${buildQuery({ q, specialty, city, page: String(result.page + 1) })}`}
                    className="rounded-md border border-stone-700 px-4 py-2 text-stone-200 hover:border-stone-400"
                  >
                    التالي
                  </a>
                ) : (
                  <span className="rounded-md border border-stone-800 px-4 py-2 text-stone-600">التالي</span>
                )}
              </nav>
            )}
          </>
        )}

        <footer className="mt-12 text-center text-xs text-stone-600">
          © AI-Receptions · دليل الأطباء العام ·{' '}
          <a href="/" className="hover:underline">
            منصة الاستقبال الذكي للعيادات
          </a>
        </footer>
      </div>
    </main>
  );
}

