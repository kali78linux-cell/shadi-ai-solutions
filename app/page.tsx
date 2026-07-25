import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';

const features = [
  { title: 'AI Chat ذكي', description: 'استقبل العملاء واسأل عن المواعيد وأجب عن الأسئلة الروتينية تلقائياً.' },
  { title: 'لوحة تحكم العيادات', description: 'عرض فوري لحالة المواعيد والعملاء المحتملين والتقارير.' },
  { title: 'إدارة المواعيد', description: 'حجز، تأكيد، وإدارة جداول المواعيد بسهولة.' },
  { title: 'قاعدة معرفة متكاملة', description: 'احفظ الأسئلة الشائعة والمعلومات الطبية للرد الفوري.' },
  { title: 'تنبيهات وإشعارات', description: 'ابقَ على اطلاع مع تنبيهات المواعيد الجديدة والمتابعة.' },
  { title: 'عرض تجريبي للبيع', description: 'صفحة عرض احترافية للترويج للخدمة أمام أصحاب العيادات.' },
];

export default function HomePage() {
  return (
    <main className="relative overflow-hidden bg-slate-950">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl text-center">
          <p className="inline-flex items-center rounded-full bg-cyan-500/15 px-4 py-1 text-sm font-medium text-cyan-300">
            الإصدار الأول MVP جاهز للاستخدام
          </p>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight text-white sm:text-6xl">
            Dental AI Receptionist v1
          </h1>
          <p className="mt-6 text-lg leading-8 text-slate-300">
            نظام استقبال ذكي لعيادات الأسنان مع لوحة تحكم لإدارة المواعيد، العملاء المحتملين، وقاعدة المعرفة.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-3">
            <Link href="/demo" className="inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
              شاهد العرض التجريبي
            </Link>
            <Link href="/login" className="inline-flex items-center justify-center rounded-full border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-slate-500">
              تسجيل دخول العيادة
            </Link>
            <Link href="/setup" className="inline-flex items-center justify-center rounded-full border border-slate-700 bg-slate-950 px-6 py-3 text-sm font-semibold text-slate-100 transition hover:border-cyan-500">
              إعداد Supabase
            </Link>
          </div>
          {!isSupabaseConfigured && (
            <div className="mt-6 rounded-3xl border border-slate-800 bg-slate-900/80 p-5 text-center text-sm text-slate-300">
              <p className="font-medium text-slate-100">يعمل التطبيق بدون Supabase حالياً.</p>
              <p className="mt-2">استخدم زر الدخول التجريبي أو اضف المفاتيح في <code className="rounded bg-slate-950 px-1 py-0.5 text-xs">.env.local</code>.</p>
            </div>
          )}
        </div>

        <section className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-3xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-slate-950/20">
              <h2 className="text-lg font-semibold text-white">{feature.title}</h2>
              <p className="mt-3 text-sm leading-6 text-slate-400">{feature.description}</p>
            </article>
          ))}
        </section>

        <section className="mt-16 rounded-3xl border border-slate-800 bg-slate-900/70 p-8 shadow-xl shadow-slate-950/30">
          <h2 className="text-2xl font-semibold text-white">ماذا ستحصل عليه في MVP؟</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-950/80 p-5">
              <h3 className="font-semibold text-white">✅ حسابات عيادات</h3>
              <p className="mt-2 text-slate-400">سجل واعمل على أكثر من عيادة واحدة مع صلاحيات منفصلة لكل فريق.</p>
            </div>
            <div className="rounded-2xl bg-slate-950/80 p-5">
              <h3 className="font-semibold text-white">✅ لوحة تحكم مركزة</h3>
              <p className="mt-2 text-slate-400">تابع جميع المواعيد، العملاء المحتملين، والإشعارات من نافذة واحدة.</p>
            </div>
            <div className="rounded-2xl bg-slate-950/80 p-5">
              <h3 className="font-semibold text-white">✅ دردشة آلية</h3>
              <p className="mt-2 text-slate-400">دردشة ذكية تتعامل مع استفسارات المرضى وتجيب عن الأسئلة الشائعة.</p>
            </div>
            <div className="rounded-2xl bg-slate-950/80 p-5">
              <h3 className="font-semibold text-white">✅ إدارة المواعيد</h3>
              <p className="mt-2 text-slate-400">حجز، تأكيد، ومتابعة المواعيد بسهولة مع تنبيهات تلقائية.</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
