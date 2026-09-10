import Link from 'next/link';

export default function NotFound() {
  return (
    <main dir="rtl" className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-950/80 p-8 text-center">
        <p className="text-4xl font-black text-cyan-300" aria-hidden="true">404</p>
        <h1 className="mt-3 text-lg font-bold text-white">الصفحة غير موجودة</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          الرابط الذي فتحته غير صحيح أو تم نقله.
        </p>
        <Link
          href="/"
          className="mt-5 inline-block rounded-full bg-cyan-500 px-6 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400"
        >
          العودة للصفحة الرئيسية
        </Link>
      </div>
    </main>
  );
}