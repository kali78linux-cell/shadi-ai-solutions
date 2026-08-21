'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import LandingButton from './LandingButton';

export default function LeadForm() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus('submitting');
    try {
      const res = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'landing_page_founding_offer',
          status: 'new',
          // clinic_id is NULL (lead before clinic registration) — handled by migration / nullable
        }),
      });
      if (res.ok) {
        setStatus('success');
        setMessage('تم استلام مكانك! رح نتواصل معك قريباً.');
      } else {
        setStatus('error');
        setMessage('حدث خطأ، حاول مرة أخرى.');
      }
    } catch {
      setStatus('error');
      setMessage('حدث خطأ، حاول مرة أخرى.');
    }
  }

  return (
    <section id="founding" className="bg-landing-dark py-20 text-white lg:py-28">
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="rounded-3xl border border-white/10 bg-white/5 p-8 backdrop-blur-sm"
        >
          <h2 className="text-center font-heading text-3xl font-extrabold">
            احجز مكانك بين أول 100
          </h2>
          <p className="mt-3 text-center text-sm text-white/70">
            اترك بياناتك ورح نرجع نتواصل معك لعرض توضيحي وثبت سعرك مدى الحياة.
          </p>

          <form onSubmit={handleSubmit} className="mt-8 grid gap-4">
            <div>
              <label className="mb-1 block text-sm font-semibold">الاسم</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="اسمك الكامل"
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-landing-cyan"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">رقم الهاتف</label>
              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05X-XXX-XXXX"
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-landing-cyan"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-semibold">البريد الإلكتروني (اختياري)</label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="clinic@example.com"
                className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white outline-none transition focus:border-landing-cyan"
              />
            </div>

            {status === 'success' && (
              <p className="text-sm font-semibold text-emerald-400">{message}</p>
            )}
            {status === 'error' && <p className="text-sm font-semibold text-red-400">{message}</p>}

            <LandingButton type="submit" size="lg" className="w-full" >
              {status === 'submitting' ? 'جارٍ الإرسال...' : 'احجز مكانك ←'}
            </LandingButton>
          </form>
        </motion.div>
      </div>
    </section>
  );
}