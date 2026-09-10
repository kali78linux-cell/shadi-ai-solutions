import type { ActivityPublicSpace } from '@/lib/services/activityPublicSpace';
import { ActivitySpaceChrome, ContactBlock, WorkingHoursBlock, InitialsBrandMark } from '@/components/public/ActivitySpaceChrome';

/**
 * Clinic / Doctor Clinic public space (Phase C + premium redesign).
 * Reuses and evolves the 15D clinic public experience (identity, services,
 * hours, contact, booking/chat CTAs) — doctor/clinic-oriented.
 *
 * Visual language: light healthcare (white + cyan/emerald), calm floating
 * wellness blobs, premium cards with lift/hover, pill CTAs. Motion is gated
 * behind `prefers-reduced-motion` in globals.css.
 */

export function ClinicPublicSpace({ space }: { space: ActivityPublicSpace }) {
  const hasServices = space.services.length > 0;
  const hasProviders = space.providers.length > 0;
  const hasAds = space.ads.length > 0;
  return (
    <ActivitySpaceChrome
      space={space}
      headline={space.name}
      children={
        <>
          {/* Empathy / pain → solution (PR-EMO) */}
          <section className="mb-10 rounded-3xl border border-brand-cyan/25 bg-gradient-to-l from-brand-cyan/10 via-white to-slate-50 p-6 text-center">
            <p className="text-sm leading-relaxed text-slate-600">
              مشغول في العمل؟ لا وقت للمكالمات؟ اكتب مشكلتك للاستقبال الذكي وسيساعدك على
              اختيار الخدمة المناسبة وحجز الوقت المناسب — خطوة بخطوة ودون ضغط.
            </p>
          </section>

          {/* Announcements / offers (clinic_ads) */}
          {hasAds && (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-bold text-slate-800">عروض وإعلانات</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {space.ads.map((ad) => (
                  <div
                    key={ad.title}
                    className="public-card rounded-2xl border border-brand-cyan/25 bg-white p-5 hover:border-brand-cyan/50"
                  >
                    <h3 className="font-bold text-slate-800">🎉 {ad.title}</h3>
                    {ad.description && <p className="mt-2 text-sm leading-relaxed text-slate-500">{ad.description}</p>}
                    {ad.cta_link && (
                      <a href={ad.cta_link} className="mt-3 inline-block text-sm font-semibold text-brand-cyan hover:text-brand-cyan/80">
                        {ad.cta_text} ←
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Services */}
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-bold text-slate-800">الخدمات ومجالات الممارسة</h2>
            {hasServices ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {space.services.map((service) => (
                  <article
                    key={`${service.name}-${service.duration_minutes ?? 0}`}
                    className="public-card group rounded-2xl border border-slate-200 bg-white p-5 hover:border-brand-cyan/50"
                  >
                    <h3 className="font-bold text-slate-800 transition group-hover:text-brand-cyan">{service.name}</h3>
                    {service.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-slate-500">{service.description}</p>
                    )}
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
                      {service.duration_minutes != null && (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">⏱ {service.duration_minutes} دقيقة</span>
                      )}
                      {service.price != null && (
                        <span className="rounded-full bg-brand-cyan/10 px-2.5 py-1 font-semibold text-brand-cyan">{service.price} ₪</span>
                      )}
                      <a
                        href={space.bookingUrl}
                        className="mr-auto rounded-full bg-brand-cyan/10 px-3 py-1.5 font-semibold text-brand-cyan transition hover:bg-brand-cyan hover:text-white"
                      >
                        احجز
                      </a>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
                لا توجد خدمات منشورة بعد — تحدث مع الاستقبال للاستفسار.
              </p>
            )}
          </section>

          {/* Providers (dentists) */}
          {hasProviders && (
            <section className="mb-10">
              <h2 className="mb-4 text-xl font-bold text-slate-800">الأطباء</h2>
              <div className="grid gap-4 sm:grid-cols-2">
                {space.providers.map((p) => (
                  <div key={p.name} className="public-card flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 hover:border-brand-cyan/50">
                    <InitialsBrandMark name={p.name} className="h-14 w-14 shrink-0 rounded-full text-lg" />
                    <div>
                      <h3 className="font-bold text-slate-800">{p.name}</h3>
                      {(p.title || p.specialty) && (
                        <p className="mt-0.5 text-sm text-slate-500">{[p.title, p.specialty].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Hours */}
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-bold text-slate-800">ساعات العمل</h2>
            <WorkingHoursBlock space={space} />
          </section>

          {/* Contact */}
          <section className="mb-10">
            <h2 className="mb-4 text-xl font-bold text-slate-800">مكان العمل والتواصل</h2>
            <ContactBlock space={space} />
          </section>

          {/* Action */}
          <section className="rounded-3xl border border-brand-cyan/30 bg-gradient-to-l from-brand-cyan/15 via-white to-slate-50 p-6 text-center">
            <h2 className="text-xl font-bold text-slate-800">جاهز للخطوة التالية؟</h2>
            <p className="mt-2 text-sm text-slate-500">
              اختر الوقت المناسب لك عبر الحجز المباشر، أو اسأل الاستقبال الذكي عن أي خدمة أولًا.
            </p>
            <a
              href={space.bookingUrl}
              className="mt-4 inline-flex rounded-full bg-brand-cyan px-6 py-2.5 text-sm font-bold text-white transition hover:-translate-y-0.5 hover:bg-brand-cyan/90"
            >
              احجز موعدًا الآن
            </a>
          </section>
        </>
      }
    />
  );
}
