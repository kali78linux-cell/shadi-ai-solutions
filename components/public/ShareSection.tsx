'use client';

/**
 * PHASE 8 — QR / share section for the public space (client island).
 * QR download points at the stable identity target (/q/{public_id}) so the
 * code survives slug changes; the copy button never leaks internal ids.
 */
export function ShareSection({
  clinicName,
  publicId,
  pageUrl,
}: {
  clinicName: string;
  publicId: string;
  pageUrl: string;
}) {
  return (
    <section className="mx-auto max-w-5xl px-4 pb-12">
      <div className="flex flex-col items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 sm:flex-row">
        <div className="text-center sm:text-right">
          <h2 className="text-lg font-bold text-white">شارك صفحة {clinicName}</h2>
          <p className="mt-1 text-sm text-slate-400">امسح الرمز أو انسخ الرابط لدعوة المرضى مباشرة.</p>
        </div>
        <div className="flex items-center gap-3">
          <a
            href={`/api/qr?public_id=${encodeURIComponent(publicId)}`}
            className="inline-flex items-center gap-2 rounded-full bg-slate-800 px-5 py-2.5 text-sm font-semibold text-teal-300 transition hover:bg-slate-700"
            title="تحميل رمز QR"
          >
            QR · تحميل
          </a>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-5 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-teal-400/60"
            onClick={() => {
              navigator.clipboard?.writeText(pageUrl).catch(() => undefined);
            }}
          >
            نسخ الرابط
          </button>
        </div>
      </div>
    </section>
  );
}
