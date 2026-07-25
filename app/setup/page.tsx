'use client';

import { useEffect, useState } from 'react';

type ConfigStatus = {
  supabaseUrl: string;
  anonKeyExists: boolean;
  serviceRoleKeyExists: boolean;
  isConfigured: boolean;
};

export default function SetupPage() {
  const [status, setStatus] = useState<ConfigStatus | null>(null);
  const [message, setMessage] = useState('');
  const [isBootstrapping, setIsBootstrapping] = useState(false);

  useEffect(() => {
    async function loadConfig() {
      const res = await fetch('/api/supabase-config');
      if (!res.ok) {
        setMessage('لا يمكن جلب حالة التهيئة حالياً.');
        return;
      }
      const data: ConfigStatus = await res.json();
      setStatus(data);
    }

    loadConfig();
  }, []);

  async function handleBootstrap() {
    setIsBootstrapping(true);
    setMessage('جارٍ التحقق من إعداد Supabase...');

    const res = await fetch('/api/supabase-setup', { method: 'POST' });
    const data = await res.json();

    setIsBootstrapping(false);

    if (!res.ok) {
      setMessage(data.error || 'حدث خطأ أثناء التحقق من الإعداد.');
      return;
    }

    setMessage(data.message || 'تم التحقق من إعداد Supabase بنجاح.');
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-12 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-3xl rounded-[2rem] border border-slate-800 bg-slate-900/90 p-8 shadow-xl shadow-slate-950/30">
        <h1 className="text-3xl font-semibold text-white">إعداد Supabase</h1>
        <p className="mt-3 text-slate-400">
          يتم إدارة إعداد Supabase عبر متغيرات البيئة فقط. قم بتحديث <code className="rounded bg-slate-950 px-1 py-0.5">.env.local</code> أو إعدادات البيئة في Vercel.
        </p>

        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6">
            <p className="text-sm text-slate-400">حالة التهيئة</p>
            <p className="mt-3 text-3xl font-semibold text-white">
              {status ? (status.isConfigured ? 'مفعل' : 'غير مفعل') : 'جارٍ التحميل...'}
            </p>
            {status ? (
              <div className="mt-4 space-y-2 text-sm text-slate-300">
                <div>
                  <span className="font-semibold text-slate-100">Supabase URL:</span>
                  <span className="ml-2 text-slate-400">{status.supabaseUrl || 'غير موجود'}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-100">Anon Key:</span>
                  <span className="ml-2 text-slate-400">{status.anonKeyExists ? 'موجودة' : 'غير موجودة'}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-100">Service Role Key:</span>
                  <span className="ml-2 text-slate-400">{status.serviceRoleKeyExists ? 'موجودة' : 'غير موجودة'}</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-3xl border border-slate-800 bg-slate-950/80 p-6">
            <p className="text-sm text-slate-400">خطوات التهيئة</p>
            <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-slate-300">
              <li>أضف متغيرات البيئة التالية إلى <code className="rounded bg-slate-950 px-1 py-0.5">.env.local</code>:</li>
              <li><code>NEXT_PUBLIC_SUPABASE_URL</code></li>
              <li><code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code></li>
              <li><code>SUPABASE_SERVICE_ROLE_KEY</code></li>
              <li>أعد تشغيل الخادم المحلي بعد حفظ القيم.</li>
              <li>اضغط زر التحقق للتأكد من اتصال Supabase.</li>
            </ol>
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            disabled={isBootstrapping || !status?.isConfigured}
            onClick={handleBootstrap}
            className="inline-flex w-full items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isBootstrapping ? 'جارٍ التحقق...' : 'تحقق من إعداد Supabase'}
          </button>
        </div>

        {message ? (
          <div className="mt-6 rounded-3xl bg-slate-950/80 p-4 text-sm text-slate-200">
            {message}
          </div>
        ) : null}

        <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-950/80 p-5 text-sm text-slate-400">
          <p className="font-semibold text-slate-100">ملاحظة</p>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>لم يعد من الآمن حفظ مفاتيح Supabase من خلال واجهة التطبيق.</li>
            <li>يجب استخدام <code className="rounded bg-slate-900 px-1 py-0.5">.env.local</code> محلياً أو إعدادات متغيرات البيئة في منصة الاستضافة.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
