import Link from 'next/link';

export default function DemoPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl space-y-10">
        <div className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-10 shadow-xl shadow-slate-950/30">
          <span className="inline-flex rounded-full bg-cyan-500/15 px-4 py-1 text-sm font-semibold text-cyan-300">
            دموى خاص بالعيادات
          </span>
          <h1 className="mt-6 text-4xl font-semibold text-white">صفحة العرض التجاري لDental AI Receptionist</h1>
          <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-300">
            مصممة لتسويق الخدمة لعيادات الأسنان: استقبال طلبات المواعيد، إدارة العملاء المحتملين، ونظام دردشة ذكي لمساعدة فريق الاستقبال.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href="/login" className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
              دخول لوحة التحكم
            </Link>
            <Link href="/" className="inline-flex items-center justify-center rounded-full border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-100 hover:border-slate-500">
              العودة للرئيسية
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <article className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-slate-950/20">
            <h2 className="text-xl font-semibold text-white">تحسين استقبال المرضى</h2>
            <p className="mt-3 text-slate-400">العملاء يحصلون على سرعة استجابة أكبر، وتخفيض في المكالمات غير الضرورية، وتجربة أكثر احترافية.</p>
          </article>
          <article className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-slate-950/20">
            <h2 className="text-xl font-semibold text-white">تركيز على المواعيد</h2>
            <p className="mt-3 text-slate-400">تابع المواعيد القادمة، الحالات الملغاة، وطلبات الحجز الجديدة من دون تعقيد.</p>
          </article>
          <article className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-slate-950/20">
            <h2 className="text-xl font-semibold text-white">سهولة البيع للعميل الأول</h2>
            <p className="mt-3 text-slate-400">المزايا الأساسية جاهزة الآن: دونواتس، مكالمات، أو نظام دفع. النشر سريع بعد أول عميل.</p>
          </article>
        </div>
      </div>
    </main>
  );
}
