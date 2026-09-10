'use client';

import { useEffect } from 'react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // PHASE F — real diagnostics: always log the full error to the console (the
  // UI still hides internals from end users), and in development show the
  // message + digest inline so the root cause is visible while debugging.
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[dashboard-section-error]', error?.message, error?.digest, error);
  }, [error]);

  const isDev = process.env.NODE_ENV !== 'production';

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-950/80 p-8 text-center">
        <p className="text-3xl" aria-hidden="true">⚠️</p>
        <h2 className="mt-3 text-lg font-bold text-white">حدث خطأ غير متوقع</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          تعذر تحميل هذا القسم من لوحة التحكم. يمكنك المحاولة مرة أخرى.
        </p>
        {isDev && (error?.message || error?.digest) ? (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-right">
            <p className="text-xs font-semibold text-amber-200">تفاصيل التشخيص (development فقط):</p>
            <p className="mt-1 break-words text-xs text-amber-200/80" dir="ltr">
              {error?.message ?? '(no message)'}
              {error?.digest ? ` · digest: ${error.digest}` : ''}
            </p>
          </div>
        ) : null}
        {isDev && error?.digest ? (
          <p className="mt-2 text-[11px] text-slate-500" dir="ltr">digest: {error.digest}</p>
        ) : null}
        <button
          type="button"
          onClick={reset}
          className="mt-5 rounded-full bg-cyan-500 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          إعادة المحاولة
        </button>
      </div>
    </div>
  );
}