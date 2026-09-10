'use client';

import Link from 'next/link';

export default function GlobalRouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Intentionally does NOT render error.message / digest / stack — no internal details.
  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-950/80 p-8 text-center">
        <p className="text-3xl" aria-hidden="true">⚠️</p>
        <h1 className="mt-3 text-lg font-bold text-white">حدث خطأ غير متوقع</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          تعذر تحميل الصفحة. يمكنك المحاولة مرة أخرى أو العودة للصفحة الرئيسية.
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-cyan-500 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
          >
            إعادة المحاولة
          </button>
          <Link
            href="/"
            className="rounded-full border border-slate-700 px-6 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500"
          >
            الصفحة الرئيسية
          </Link>
        </div>
      </div>
    </main>
  );
}