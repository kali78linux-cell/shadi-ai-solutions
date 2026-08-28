'use client';

import FloatingChatWidget from '@/components/chat/FloatingChatWidget';

/**
 * Premium medical landing page hosting the floating chat widget.
 * Light, RTL, medical-trust theme (white + sky + teal + soft violet).
 * The clinic id is resolved by the parent gate and passed straight through.
 */
export default function ChatLanding({ clinicId, clinicName }: { clinicId: string; clinicName: string | null }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-white via-cyan-50/70 to-teal-50 text-slate-800">
      {/* Soft decorative blobs */}
      <div aria-hidden className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-cyan-200/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -right-24 top-1/3 h-80 w-80 rounded-full bg-violet-200/40 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-teal-200/40 blur-3xl" />

      <div className="relative mx-auto max-w-5xl px-6 py-12">
        {/* Brand row */}
        <div className="mb-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-violet-500 text-white shadow-lg shadow-cyan-500/30">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 8h1a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-8a4 4 0 0 1 0-8h1" />
                <path d="M15 12v-1a3 3 0 0 0-3-3H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">{clinicName ?? 'العيادة'}</p>
              <p className="text-xs text-slate-500">الاستقبال الذكي</p>
            </div>
          </div>
          <span className="hidden items-center gap-2 rounded-full bg-emerald-100/80 px-4 py-2 text-xs font-semibold text-emerald-700 sm:flex">
            <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            موظفة الاستقبال متاحة الآن
          </span>
        </div>

        {/* Hero */}
        <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-white/70 px-4 py-1.5 text-xs font-semibold text-cyan-700 shadow-sm">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2v4M12 18v4M2 12h4M18 12h4M5 5l2.5 2.5M16.5 16.5 19 19M19 5l-2.5 2.5M7.5 16.5 5 19" />
              </svg>
              استقبال رقمي ذكي يعمل على مدار الساعة
            </span>
            <h1 className="mt-6 text-4xl font-extrabold leading-tight tracking-tight text-slate-900 sm:text-5xl">
              مرحبًا بك في{' '}
              <span className="bg-gradient-to-l from-cyan-500 to-violet-500 bg-clip-text text-transparent">
                الاستقبال الذكي
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-600">
              موظفة الاستقبال الافتراضية جاهزة للرد على استفساراتك، إرشادك، وحجز موعدك — بشكل طبيعي
              وبأي صياغة تُحب التحدث بها.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <button
                type="button"
                onClick={openChatBubble}
                className="rounded-2xl bg-gradient-to-l from-cyan-500 to-teal-500 px-7 py-3.5 text-base font-bold text-white shadow-xl shadow-cyan-500/30 transition hover:shadow-cyan-500/50 active:scale-95"
              >
                ابدأ المحادثة
              </button>
              <span className="flex items-center gap-2 text-sm font-medium text-slate-500">
                💬 أجبيك فورًا · 🦷 حجز في دقائق
              </span>
            </div>

            {/* Feature chips */}
            <div className="mt-10 grid grid-cols-3 gap-3 text-center">
              {[
                { icon: '🕐', t: 'رد فوري', d: 'على مدار الساعة' },
                { icon: '📍', t: 'مواعيد', d: 'حجز سهل وآمن' },
                { icon: '🔒', t: 'خصوصية', d: 'بياناتك محمية' },
              ].map((f) => (
                <div key={f.t} className="rounded-2xl border border-white/80 bg-white/70 p-4 shadow-sm backdrop-blur">
                  <div className="text-2xl">{f.icon}</div>
                  <p className="mt-1.5 text-sm font-bold text-slate-800">{f.t}</p>
                  <p className="text-xs text-slate-500">{f.d}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Decorative chat preview card */}
          <div className="hidden justify-center lg:flex">
            <div className="w-full max-w-sm rounded-3xl border border-white/70 bg-white/80 p-6 shadow-2xl shadow-cyan-500/10 backdrop-blur">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-white">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 8h1a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-8a4 4 0 0 1 0-8h1" />
                    <path d="M15 12v-1a3 3 0 0 0-3-3H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">موظفة الاستقبال</p>
                  <p className="text-xs text-emerald-600">● متاحة الآن</p>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <div className="max-w-[85%] rounded-2xl rounded-tr-none bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  أهلاً بك! كيف يمكنني مساعدتك اليوم؟
                </div>
                <div className="mr-auto max-w-[85%] rounded-2xl rounded-tl-none bg-gradient-to-l from-cyan-500 to-teal-500 px-4 py-3 text-sm text-white">
                  بدي أعرف أوقات دوام العيادة
                </div>
                <div className="max-w-[85%] rounded-2xl rounded-tr-none bg-slate-100 px-4 py-3 text-sm text-slate-700">
                  ساعات العمل: الأحد–الخميس ٩ص–٥م، والعيادة مغلقة الجمعة والسبت 😊
                </div>
              </div>
              <div className="mt-5 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <span className="flex-1 text-sm text-slate-400">اكتب رسالتك…</span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-l from-cyan-500 to-teal-500 text-white">
                  <svg viewBox="0 0 24 24" className="h-4 w-4 -scale-x-100" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m22 2-7 20-4-9-9-4z" />
                  </svg>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <FloatingChatWidget clinicId={clinicId} clinicName={clinicName} />
    </div>
  );
}

function openChatBubble() {
  const bubble = document.querySelector('[aria-label="فتح محادثة موظفة الاستقبال"]') as HTMLElement | null;
  bubble?.click();
}