'use client';

import { FormEvent, useEffect, useState } from 'react';

type Lead = {
  id: number;
  name: string;
  email: string;
  phone: string;
  source: string;
  status: string;
};

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [formData, setFormData] = useState({ name: '', email: '', phone: '', source: '' });

  useEffect(() => {
    fetch('/api/leads')
      .then((res) => res.json())
      .then((data) => setLeads(data))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        source: formData.source,
        status: 'جديد',
      }),
    });

    if (response.ok) {
      const newLead = await response.json();
      setLeads((current) => [newLead, ...current]);
      setFormData({ name: '', email: '', phone: '', source: '' });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]">
      <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-8 shadow-xl shadow-slate-950/30">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-white">العملاء المحتملين</h1>
            <p className="mt-2 text-slate-400">تابع العملاء المحتملين ومصادرهم وحالة المتابعة.</p>
          </div>
        </div>

        <div className="mt-8 overflow-hidden rounded-[2rem] border border-slate-800 bg-slate-950/80">
          <table className="w-full border-collapse text-right text-sm">
            <thead className="bg-slate-900/80 text-slate-400">
              <tr>
                <th className="px-6 py-4 text-right">الاسم</th>
                <th className="px-6 py-4 text-right">البريد</th>
                <th className="px-6 py-4 text-right">الهاتف</th>
                <th className="px-6 py-4 text-right">المصدر</th>
                <th className="px-6 py-4 text-right">الحالة</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-6 text-center text-slate-400">
                    جاري التحميل...
                  </td>
                </tr>
              ) : leads.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-6 text-center text-slate-400">
                    لا توجد عملاء محتملين حتى الآن.
                  </td>
                </tr>
              ) : (
                leads.map((lead) => (
                  <tr key={lead.id} className="border-t border-slate-800 hover:bg-slate-900/80">
                    <td className="px-6 py-4 text-slate-100">{lead.name}</td>
                    <td className="px-6 py-4 text-slate-100">{lead.email}</td>
                    <td className="px-6 py-4 text-slate-100">{lead.phone}</td>
                    <td className="px-6 py-4 text-slate-100">{lead.source}</td>
                    <td className="px-6 py-4 text-cyan-300">{lead.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-8 shadow-xl shadow-slate-950/30">
        <h2 className="text-2xl font-semibold text-white">إضافة عميل محتمل</h2>
        <p className="mt-2 text-slate-400">أضف الفرص الجديدة لتتبعها لاحقًا في مسار المبيعات.</p>

        <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
          {[
            { label: 'الاسم', name: 'name', type: 'text', value: formData.name },
            { label: 'البريد الإلكتروني', name: 'email', type: 'email', value: formData.email },
            { label: 'الهاتف', name: 'phone', type: 'tel', value: formData.phone },
            { label: 'مصدر العميل', name: 'source', type: 'text', value: formData.source },
          ].map((field) => (
            <div key={field.name}>
              <label className="block text-sm font-medium text-slate-200">{field.label}</label>
              <input
                type={field.type}
                value={field.value}
                onChange={(event) => setFormData((current) => ({ ...current, [field.name]: event.target.value }))}
                className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 outline-none transition focus:border-cyan-500 focus:ring-2 focus:ring-cyan-500/20"
              />
            </div>
          ))}

          <button className="w-full rounded-3xl bg-cyan-500 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-cyan-400">
            حفظ العميل المحتمل
          </button>
        </form>
      </section>
    </div>
  );
}
