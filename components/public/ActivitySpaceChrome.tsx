'use client';

import { useEffect, useState } from 'react';
import { ACTIVITY_TYPE_LABELS_AR } from '@/lib/services/activityTypes';
import type { ActivityPublicSpace } from '@/lib/services/activityPublicSpace';
import { ShareSection } from '@/components/public/ShareSection';
import { ownerLoginUrl } from '@/lib/services/dashboardPaths';
import FloatingChatWidget from '@/components/chat/FloatingChatWidget';

/**
 * Shared chrome for activity public spaces (Phase C + redesign).
 * Renders tenant identity + CTAs genuinely common across clinic /
 * imaging-center / dental-lab spaces. Activity-specific sections live in
 * the per-activity components, not here.
 *
 * Visual language: modern, premium, medical — dark glass panels, subtle
 * gradient hero, teal/cyan accent, entrance animations gated behind
 * `prefers-reduced-motion`, RTL-first.
 */

const WEEKDAY_NAMES_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const WEEKDAY_NAMES_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatTime(time: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (!match) return time;
  const h = Number(match[1]);
  const m = match[2];
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** Deterministic initials-based brand mark when no logo is uploaded. */
export function themeRadius(shape: string | undefined): number {
  switch (shape) {
    case 'squared': return 10;
    case 'rounded': return 18;
    default: return 9999;
  }
}

export function themePadSize(size: string | undefined): { px: number; py: number; fontSize: number } {
  switch (size) {
    case 'small': return { px:16, py:8, fontSize:13 };
    case 'large': return { px:32, py:16, fontSize:17 };
    default: return { px:22, py:12, fontSize:15 };
  }
}

export function tickerDuration(speed: string | undefined): number {
  switch (speed) {
    case 'slow': return 45;
    case 'fast': return 15;
    default: return 28;
  }
}

export function InitialsBrandMark({
  name,
  className = 'h-20 w-20 text-2xl',
}: {
  name: string;
  className?: string;
}) {
  const trimmed = name.trim();
  const initials = trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join('');
  return (
    <span
      aria-hidden="true"
      className={`flex items-center justify-center rounded-2xl border border-teal-400/40 bg-gradient-to-br from-teal-500/20 via-slate-800 to-slate-900 font-extrabold text-teal-200 shadow-inner ${className}`}
    >
      {initials || name.charAt(0)}
    </span>
  );
}

function BrandLogo({ space, size = 'lg' }: { space: ActivityPublicSpace; size?: 'lg' | 'sm' }) {
  const cls =
    size === 'lg'
      ? 'h-24 w-24 rounded-3xl border-2 border-teal-400/50 object-cover shadow-lg shadow-teal-500/10'
      : 'h-12 w-12 rounded-xl border border-teal-400/40 object-cover';
  if (space.logo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={space.logo} alt={`شعار ${space.name}`} className={cls} />;
  }
  return (
    <InitialsBrandMark name={space.name} className={size === 'lg' ? 'h-24 w-24 text-3xl' : 'h-12 w-12 text-lg'} />
  );
}

function StaggerReveal({
  children,
  delay = 0,
  className = '',
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <div className={`animate-reveal ${className}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

export function ActivitySpaceChrome({
  space,
  headline,
  children,
}: {
  space: ActivityPublicSpace;
  headline: string;
  children: React.ReactNode;
}) {
  const locationBits = [space.city, space.area].filter(Boolean) as string[];
  const hasAddress = Boolean(space.address);
  const ctaLabel = space.activityType === 'clinic' ? 'احجز موعدًا' : 'اطلب خدمة';
  /** Section visibility toggle (default: visible when unset) — owner-controlled. */
  const on = (key: string) => space.sections?.[key] !== false;
  const showBooking = on('bookingCta') || on('hero');
  const showAi = on('aiCta');
  const d = space.display;
  const bodyScale =
    d?.body_text === 'small' ? ' text-sm' : d?.body_text === 'large' ? ' text-lg' : ' text-base';
  const headingCls =
    d?.heading === 'small'
      ? 'text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl'
      : d?.heading === 'large'
        ? 'text-5xl font-extrabold tracking-tight text-slate-900 sm:text-6xl'
        : 'text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl';

  // Public Chat UX (Phase 8): the conversation opens INSIDE this public page
  // via the FloatingChatWidget (embedded ChatInterface) — never a redirect to
  // /chat. The widget keeps clinic scope from the same `space.clinicId`.
  const [chatSignal, setChatSignal] = useState(0);
  const openChat = () => setChatSignal((n) => n + 1);
  useEffect(() => {
    const onOpenChat = () => setChatSignal((n) => n + 1);
    window.addEventListener('clinic-chat:open', onOpenChat as EventListener);
    return () => window.removeEventListener('clinic-chat:open', onOpenChat as EventListener);
  }, []);

  return (
    <div dir="rtl" className={`min-h-screen text-slate-800${bodyScale}`} style={{ backgroundColor: space.theme?.background_color ?? '#f6f8ff' }} >
      {/* Floating wellness blobs + bubbles (calm, reduced-motion safe) */}
      <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 right-[-5%] h-[28rem] w-[28rem] rounded-full bg-brand-cyan/15 blur-3xl animate-float-slow" />
        <div className="absolute top-1/4 left-[-8%] h-80 w-80 rounded-full bg-brand-emerald/10 blur-3xl animate-float-slower" />
        <div className="absolute bottom-[-10%] left-1/3 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl animate-float-slow" />
        <span className="absolute top-[18%] right-[12%] h-3 w-3 rounded-full bg-brand-cyan/30 animate-drift" />
        <span className="absolute top-[30%] left-[18%] h-2 w-2 rounded-full bg-brand-emerald/30 animate-drift" style={{ animationDelay: '2s' }} />
        <span className="absolute top-[12%] left-[38%] h-2.5 w-2.5 rounded-full bg-cyan-400/30 animate-drift" style={{ animationDelay: '4s' }} />
      </div>

      {/* PHASE L — news ticker (owner-managed; bounded colors/speed) */}
      {on('news') && space.news.length > 0 && (
        <div dir="ltr" className="overflow-hidden border-b border-white/10" style={{ backgroundColor: space.theme?.primary_color ?? '#0e7490' }}>
          <div
            className="flex w-max animate-ticker gap-10 px-4 py-2"
            style={{ animationDuration: `${tickerDuration((space.news[0] ?? {}).speed as string | undefined)}s` }}
          >
            {[...space.news, ...space.news].map((n, i) => (
              <a
                key={`${n.id}-${i}`}
                href={n.link ?? undefined}
                target={n.link ? '_blank' : undefined}
                rel="noopener noreferrer"
                className="whitespace-nowrap text-xs font-medium"
                style={{ color: n.text_color ?? '#ffffff' }}
              >
                {n.text}{n.link ? ' ↗' : ''}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Sticky CTA row: booking + owner dashboard entry */}
      <div className="sticky top-3 z-20 mx-auto flex w-fit flex-wrap items-center justify-center gap-3 px-4">
        {showBooking && (
          <a
            href={space.bookingUrl}
            className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-cyan px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-brand-cyan/25 backdrop-blur transition hover:-translate-y-0.5 hover:bg-brand-cyan/90"
            style={{
              backgroundColor: space.theme?.primary_color,
              borderRadius: themeRadius(space.theme?.button_shape),
              padding: `${themePadSize(space.theme?.button_size).py}px ${themePadSize(space.theme?.button_size).px}px`,
              fontSize: themePadSize(space.theme?.button_size).fontSize,
              boxShadow: space.theme?.button_shadow === false ? 'none' : undefined,
            }}
          >
            {ctaLabel} ←
          </a>
        )}
        <a
          href={ownerLoginUrl(space.slug)}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white/80 px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-lg shadow-slate-900/5 backdrop-blur transition hover:-translate-y-0.5 hover:border-brand-cyan/60 hover:text-brand-cyan"
        >
          لوحة التحكم / دخول المالك
        </a>
      </div>

      <main>
        {/* Hero */}
        <section
          className="relative overflow-hidden border-b border-slate-200/70 bg-gradient-to-b from-white via-white to-[#eef4ff] bg-cover bg-center"
          style={
            // PHASE C — storage-backed covers only: social URLs (facebook stories etc.)
            // are not loadable as page images and render broken visuals.
            space.coverUrl && !/facebook\.com|fbcdn\.net|instagram\.com/i.test(space.coverUrl)
              ? {
                  backgroundImage: `linear-gradient(to bottom, rgba(255,255,255,0.93), rgba(238,244,255,0.96)), url('${space.coverUrl.replace(/[^a-zA-Z0-9:/._~?-]/g, '')}')`,
                }
              : undefined
          }
        >
          <div className="mx-auto max-w-5xl px-4 pb-16 pt-12 text-center sm:pt-16">
            <StaggerReveal>
              <div className="mb-6 flex justify-center">
                <BrandLogo space={space} />
              </div>
            </StaggerReveal>
            <StaggerReveal delay={80}>
              <p className="mx-auto mb-3 inline-block rounded-full border border-brand-cyan/30 bg-brand-cyan/10 px-4 py-1 text-xs font-semibold uppercase tracking-widest text-brand-cyan">
                {ACTIVITY_TYPE_LABELS_AR[space.activityType]}
              </p>
            </StaggerReveal>
            <StaggerReveal delay={140}>
              <h1 className={headingCls}>{headline}</h1>
              {space.tagline && <p className="mt-3 text-lg font-medium text-brand-cyan/90">{space.tagline}</p>}
            </StaggerReveal>
            <StaggerReveal delay={200}>
              {locationBits.length > 0 && (
                <p className="mt-3 text-sm font-medium text-slate-500">
                  📍 {locationBits.join(' — ')}
                  {hasAddress && <span className="text-slate-400"> · {space.address}</span>}
                </p>
              )}
            </StaggerReveal>
            {space.description && (
              <StaggerReveal delay={260}>
                <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-600">
                  {space.description}
                </p>
              </StaggerReveal>
            )}
            <StaggerReveal delay={320}>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <a
                  href={space.bookingUrl}
                  className="inline-flex items-center justify-center rounded-full bg-brand-cyan px-8 py-3.5 text-base font-bold text-white shadow-lg shadow-brand-cyan/25 transition hover:-translate-y-0.5 hover:bg-brand-cyan/90 active:translate-y-0"
                  style={{
                    backgroundColor: space.theme?.primary_color,
                    borderRadius: themeRadius(space.theme?.button_shape),
                    padding: `${themePadSize(space.theme?.button_size).py}px ${themePadSize(space.theme?.button_size).px}px`,
                    fontSize: themePadSize(space.theme?.button_size).fontSize,
                    boxShadow: space.theme?.button_shadow === false ? 'none' : undefined,
                  }}
                >
                  {ctaLabel}
                </a>
                {showAi && (
                  <button
                    type="button"
                    onClick={openChat}
                    className="inline-flex items-center justify-center rounded-full border border-cyan-300 bg-white/70 px-8 py-3.5 text-base font-semibold text-slate-700 backdrop-blur transition hover:-translate-y-0.5 hover:border-brand-cyan hover:bg-white"
                  >
                    💬 تحدث مع الاستقبال الذكي
                  </button>
                )}
              </div>
            </StaggerReveal>
            <StaggerReveal delay={380}>
              <p className="mt-4 text-xs text-slate-500">
                أتحدث مباشرة مع نظام {space.name} — بدون وسيط، على مدار الساعة.
              </p>
            </StaggerReveal>
          </div>
        </section>

        {/* PHASE C — Gallery/visual showcase is a PRIMARY element (position 4) */}
        <PublicMediaGallery space={space} />

        {/* PHASE L — achievements trust cards (right after the gallery) */}
        {on('achievements') && space.achievements.length > 0 && (
          <section id="achievements" className="mx-auto w-full max-w-7xl px-4 pt-12">
            <div className="mb-6 text-center">
              <h2 className="text-xl font-bold text-slate-800">إنجازاتنا</h2>
              <p className="mt-1 text-sm text-slate-500">أرقام تعكس العمل والثقة</p>
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {space.achievements.map((a) => (
                <div
                  key={a.id}
                  className="rounded-2xl p-5 text-center text-white shadow-lg"
                  style={{ backgroundColor: a.background_color ?? '#0e7490' }}
                >
                  <div className={`font-extrabold ${a.font_size === 'small' ? 'text-2xl' : a.font_size === 'large' ? 'text-5xl' : 'text-4xl'}`}>{a.value}</div>
                  <p className="mt-1 text-sm font-semibold text-white/90">{a.icon ? `${a.icon} ` : ''}{a.title}</p>
                </div>
              ))}
            </div>
          </section>
        )}


        {/* Owner-managed about (shared across activities) */}
        {on('about') && space.about && (
          <div className="mx-auto max-w-3xl px-4 pt-10">
            <div className="public-card rounded-3xl border border-slate-200 bg-white/80 p-6">
              <h2 className="mb-2 text-lg font-bold text-slate-800">عن المنشأة</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{space.about}</p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="mx-auto max-w-5xl px-4 py-12">{children}</div>

        {/* PHASE L — testimonials + articles (social proof + education, after content) */}
        {on('testimonials') && space.testimonials.length > 0 && (
          <section className="mx-auto w-full max-w-7xl px-4 pb-12">
            <h2 className="mb-6 text-center text-xl font-bold text-slate-800">ماذا يقول مرضانا</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {space.testimonials.map((t) => (
                <figure key={t.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-amber-400" dir="ltr">{'★'.repeat(Math.max(1, Math.min(5, t.rating)))}</div>
                  <blockquote className="mt-2 text-sm leading-relaxed text-slate-600">"{t.content}"</blockquote>
                  <figcaption className="mt-3 flex items-center gap-2">
                    {t.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={t.image_url} alt={t.patient_name} loading="lazy" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-cyan/10 font-bold text-brand-cyan">{t.patient_name.charAt(0)}</span>
                    )}
                    <span className="text-sm font-semibold text-slate-700">{t.patient_name}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        )}
        {on('articles') && space.articles.length > 0 && (
          <section className="mx-auto w-full max-w-7xl px-4 pb-14">
            <h2 className="mb-6 text-center text-xl font-bold text-slate-800">مقالات ومنشورات</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {space.articles.map((art) => (
                <article key={art.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  {art.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={art.image_url} alt={art.title} loading="lazy" className="mb-3 h-36 w-full rounded-xl object-cover" />
                  )}
                  {art.category && <span className="text-xs font-semibold text-brand-cyan">{art.category}</span>}
                  <h3 className="mt-1 font-bold text-slate-800">{art.title}</h3>
                  {art.published_at && (
                    <p className="mt-1 text-xs text-slate-400">{new Date(art.published_at).toLocaleDateString('ar')}</p>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}

        {/* QR / share */}
        {space.publicId && (
          <ShareSection clinicName={space.name} publicId={space.publicId} pageUrl={space.pageUrl} />
        )}

        <footer className="mt-6 border-t border-slate-200 py-10 text-center text-xs text-slate-500">
          © AI-Receptions · مساحة {ACTIVITY_TYPE_LABELS_AR[space.activityType]} ·{' '}
          <a href="/" className="text-brand-cyan/80 hover:text-brand-cyan hover:underline">
            منصة الاستقبال الذكي
          </a>
        </footer>
      </main>

      {/* Public Chat UX (Phase 8): embedded in the SAME page, not a redirect. */}
      {showAi && <FloatingChatWidget clinicId={space.clinicId} clinicName={space.name} externalOpenSignal={chatSignal} />}

    </div>
  );
}

export function WorkingHoursBlock({ space }: { space: ActivityPublicSpace }) {
  if (space.workingHours.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-sm text-slate-500">
        لم تُحدّث ساعات العمل بعد.
      </p>
    );
  }
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {space.workingHours.map((hour) => (
        <li
          key={hour.weekday}
          className="public-card flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm hover:border-brand-cyan/40"
        >
          <span className="font-semibold text-slate-700">{WEEKDAY_NAMES_AR[hour.weekday] ?? WEEKDAY_NAMES_EN[hour.weekday] ?? '—'}</span>
          <span className="text-slate-500" dir="ltr">
            {formatTime(hour.start_time)} — {formatTime(hour.end_time)}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ContactBlock({ space }: { space: ActivityPublicSpace }) {
  return (
    <div className="public-card rounded-2xl border border-slate-200 bg-white p-5">
      <p className="font-bold text-slate-800">{space.name}</p>
      {[space.city, space.area, space.address].filter(Boolean).length > 0 && (
        <p className="mt-1 text-sm text-slate-500">
          {[space.city, space.area, space.address].filter(Boolean).join(' — ')}
        </p>
      )}
      {space.phone && (
        <a href={`tel:${space.phone}`} className="mt-2 inline-block text-sm font-semibold text-brand-cyan hover:text-brand-cyan/80" dir="ltr">
          📞 {space.phone}
        </a>
      )}
      {Object.entries(space.socialLinks ?? {}).filter(([, v]) => Boolean(v)).length > 0 && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {space.socialLinks?.website && (
            <a href={space.socialLinks.website} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-brand-cyan" dir="ltr">
              🌐 الموقع
            </a>
          )}
          {space.socialLinks?.facebook && (
            <a href={space.socialLinks.facebook} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-brand-cyan" dir="ltr">
              Facebook
            </a>
          )}
          {space.socialLinks?.instagram && (
            <a href={space.socialLinks.instagram} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-brand-cyan" dir="ltr">
              Instagram
            </a>
          )}
          {space.socialLinks?.whatsapp && (
            <a href={space.socialLinks.whatsapp} target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-brand-cyan" dir="ltr">
              WhatsApp
            </a>
          )}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href={space.bookingUrl}
          className="rounded-full bg-brand-cyan px-4 py-2 text-sm font-bold text-white transition hover:bg-brand-cyan/90"
        >
          احجز الآن
        </a>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('clinic-chat:open'))}
          className="rounded-full border border-cyan-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-brand-cyan hover:bg-white"
        >
          استشارة
        </button>
      </div>
    </div>
  );
}


export function PublicMediaGallery({ space }: { space: ActivityPublicSpace }) {
  const media = space.media ?? [];
  if (space.sections?.gallery === false || media.length === 0) return null;
  const d = space.display ?? undefined;
  const gap =
    d?.gallery_spacing === 'compact' ? 'gap-2' : d?.gallery_spacing === 'roomy' ? 'gap-5' : 'gap-3';
  const imgH =
    d?.image_size === 'small' ? 'h-36' : d?.image_size === 'large' ? 'h-64' : 'h-48';
  const videoH =
    d?.video_size === 'small' ? 'h-36' : d?.video_size === 'large' ? 'h-64' : 'h-48';
  const titleScale =
    d?.section_title === 'small' ? 'text-base' : d?.section_title === 'large' ? 'text-2xl' : 'text-xl';
  return (
    <section id="gallery" className="mx-auto w-full max-w-7xl px-4 py-12">
      <div className="mb-6 text-center">
        <h2 className={`font-bold text-slate-800 ${titleScale}`}>معرض الأعمال</h2>
        <p className="mt-1 text-sm text-slate-500">لقطات من بيئة المنشأة وخدماتها</p>
      </div>
      <div className={`grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 ${gap}`}>
        {media.map((item) =>
          item.media_type === 'video' ? (
            <video
              key={item.id}
              src={item.public_url}
              controls
              preload="none"
              aria-label={item.title || item.alt_text || 'فيديو'}
              className={`aspect-[4/3] w-full rounded-2xl border border-slate-200 bg-slate-100 object-contain ${videoH}`}
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={item.id}
              src={item.public_url}
              alt={item.alt_text || item.title || 'صورة من المنشأة'}
              loading="lazy"
              className={`aspect-[4/3] w-full rounded-2xl border border-slate-200 bg-slate-100 object-cover transition hover:scale-[1.02] ${imgH}`}
            />
          )
        )}
      </div>
    </section>
  );
}

