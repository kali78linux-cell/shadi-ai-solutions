'use client';

import { useEffect, useState, useCallback } from 'react';

export type ClinicAd = {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  cta_text: string;
  cta_link: string | null;
  display_order: number;
};

type Props = {
  clinicId?: string;
  slug?: string;
  limit?: number;
  autoPlay?: boolean;
  intervalMs?: number;
};

export function ClinicAdSpace({ clinicId, slug, limit = 5, autoPlay = false, intervalMs = 5000 }: Props) {
  const [ads, setAds] = useState<ClinicAd[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);

  const fetchAds = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (clinicId) params.set('clinic_id', clinicId);
      if (slug) params.set('slug', slug);
      params.set('limit', String(limit));

      const res = await fetch(`/api/booking/ads?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load ads');
      const body = await res.json();
      setAds(body.data?.ads || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }, [clinicId, slug, limit]);

  useEffect(() => {
    void fetchAds();
  }, [fetchAds]);

  // Auto-play carousel
  useEffect(() => {
    if (!autoPlay || ads.length <= 1) return;
    const timer = setInterval(() => {
      setCurrent((c) => (c + 1) % ads.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [autoPlay, ads, intervalMs]);

  if (loading) {
    return (
      <div className="glass-card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-48 w-full rounded-2xl bg-slate-700/40 sm:h-56" />
          <div className="h-4 w-3/4 rounded bg-slate-700/40" />
          <div className="h-4 w-1/2 rounded bg-slate-700/40" />
        </div>
      </div>
    );
  }

  if (error || ads.length === 0) {
    return (
      <div className="glass-card flex items-center justify-center gap-3 px-6 py-8 text-slate-400">
        <span>📢</span>
        <span className="text-sm">ليس هناك عروض خاصة متاحة حالياً.</span>
      </div>
    );
  }

  const ad = ads[current];
  const next = () => setCurrent((current + 1) % ads.length);
  const prev = () => setCurrent(current === 0 ? ads.length - 1 : current - 1);

  return (
    <div className="relative">
      {/* Carousel track */}
      <div className="relative overflow-hidden rounded-3xl border border-slate-800/90 bg-slate-900/80 shadow-2xl shadow-slate-950/30">
        <div
          className="transition-all duration-500 ease-out"
          key={ad.id}
        >
          <div className="flex flex-col sm:flex-row">
            {/* Image (if present) */}
            {ad.image_url ? (
              <div className="relative h-48 w-full sm:h-auto sm:w-48 flex-shrink-0">
                <img
                  src={ad.image_url}
                  alt={ad.title}
                  className="h-full w-full rounded-l-3xl object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-0 rounded-l-3xl bg-gradient-to-r from-transparent via-transparent to-slate-900/60 sm:hidden" />
              </div>
            ) : (
              <div className="flex h-48 w-full flex-shrink-0 items-center justify-center bg-gradient-to-br from-cyan-500/10 to-emerald-500/10 sm:w-48 sm:rounded-l-3xl">
                <span className="text-3xl">🎉</span>
              </div>
            )}

            {/* Content */}
            <div className="flex-1 p-6">
              <h3 className="text-xl font-bold text-white">{ad.title}</h3>
              {ad.description && (
                <p className="mt-2 text-sm leading-6 text-slate-300">{ad.description}</p>
              )}
              {ad.cta_link && ad.cta_link.startsWith('http') ? (
                <a
                  href={ad.cta_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-coral/90 px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-coral hover:scale-105 shadow-glow-coral"
                >
                  {ad.cta_text || 'إقرأ المزيد'}
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6h10M6 6h10v10" />
                  </svg>
                </a>
              ) : (
                <button
                  onClick={() => ad.cta_link && window.location.assign(ad.cta_link || '#')}
                  className="mt-4 inline-flex items-center gap-2 rounded-full bg-coral/90 px-5 py-2 text-sm font-semibold text-white transition-all hover:bg-coral hover:scale-105 shadow-glow-coral"
                >
                  {ad.cta_text || 'إقرأ المزيد'}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Indicator dots (when multiple ads) */}
        {ads.length > 1 && (
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-1.5">
            {ads.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrent(idx)}
                className={`
                  h-2 rounded-full transition-all
                  ${idx === current
                    ? 'w-6 bg-cyan-400'
                    : 'w-2 bg-slate-600 hover:bg-slate-500'}
                `}
                aria-label={`Go to ad ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      {/* Navigation arrows */}
      {ads.length > 1 && (
        <>
          <button
            onClick={next}
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-slate-800/60 p-2 text-slate-300 opacity-60 transition-all hover:opacity-100 hover:bg-slate-700"
            aria-label="Next ad"
          >
            ←
          </button>
          <button
            onClick={prev}
            className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-slate-800/60 p-2 text-slate-300 opacity-60 transition-all hover:opacity-100 hover:bg-slate-700"
            aria-label="Previous ad"
          >
            →
          </button>
        </>
      )}
    </div>
  );
}
