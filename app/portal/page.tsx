'use client';

import { useEffect, useState } from 'react';
import { getSupabasePortalBrowserClient } from '@/lib/supabase/portalBrowser';

type Identity = { clinic_id: string; patient_id: string; email: string };
type Appt = {
  id: string;
  service: string;
  appointment_date: string;
  status: string;
};

export default function PortalPage() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [appointments, setAppointments] = useState<Appt[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'denied'>('loading');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch('/api/portal/identity', { credentials: 'include' });
      if (!res.ok) {
        if (!cancelled) setState('denied');
        return;
      }
      const { identity: ident } = (await res.json()) as { identity: Identity };
      const apptsRes = await fetch('/api/portal/appointments', { credentials: 'include' });
      const { appointments: appts } = apptsRes.ok
        ? ((await apptsRes.json()) as { appointments: Appt[] })
        : { appointments: [] };
      if (cancelled) return;
      setIdentity(ident);
      setAppointments(appts ?? []);
      setState('ready');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === 'loading') return <main dir="rtl" style={{ padding: 40 }}>جارٍ التحميل…</main>;
  if (state === 'denied') {
    return (
      <main dir="rtl" style={{ maxWidth: 480, margin: '80px auto', padding: 24 }}>
        <p>الجلسة غير صالحة أو منتهية.</p>
        <a href="/portal/login">العودة لتسجيل الدخول</a>
      </main>
    );
  }

  return (
    <main dir="rtl" style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: 20 }}>بوابة المريض</h1>
        <button
          onClick={async () => {
            await fetch('/api/portal/auth/signout', { method: 'POST' });
            window.location.href = '/portal/login';
          }}
          style={{ padding: 8, borderRadius: 8, cursor: 'pointer' }}
        >
          تسجيل الخروج
        </button>
      </header>
      <p style={{ color: '#555', fontSize: 14 }}>
        مواعيدي — <span dir="ltr">{identity?.email}</span>
      </p>
      <nav style={{ display: 'grid', gap: 6, margin: '12px 0', fontSize: 14 }}>
        <a href="/portal/invoices">فواتيري</a>
        <a href="/portal/balance">رصيدي وكشف الحساب</a>
        <a href="/portal/payments">مدفوعاتي</a>
      </nav>
      <section style={{ marginTop: 16 }}>
        {appointments.length === 0 ? (
          <p style={{ color: '#666' }}>لا توجد مواعيد مسجلة.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
            {appointments.map((a) => (
              <li
                key={a.id}
                style={{ border: '1px solid #e2e2e2', borderRadius: 8, padding: 12, background: '#fafafa' }}
              >
                <strong>{a.service}</strong>
                <div style={{ fontSize: 14, color: '#555' }}>
                  {a.appointment_date} — الحالة: {a.status === 'completed' ? 'مكتمل' : a.status}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
