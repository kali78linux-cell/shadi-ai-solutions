'use client';

import { useEffect, useState } from 'react';

type Payment = {
  payment_id: string;
  date: string;
  direction: string;
  amount: number;
  status: string;
  method: string;
  receipt_number: string | null;
  invoice_number: string | null;
};

export default function PortalPaymentsPage() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/payments', { credentials: 'include' });
      if (!res.ok) {
        setDenied(true);
        return;
      }
      setPayments(((await res.json()) as { payments: Payment[] }).payments);
    })();
  }, []);

  if (denied) return <main dir="rtl" style={{ padding: 40 }}><p>الجلسة غير صالحة. <a href="/portal/login">تسجيل الدخول</a></p></main>;
  if (!payments) return <main dir="rtl" style={{ padding: 40 }}>جارٍ التحميل…</main>;

  return (
    <main dir="rtl" style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>مدفوعاتي</h1>
      <nav style={{ margin: '12px 0', fontSize: 14, display: 'grid', gap: 4 }}>
        <a href="/portal">مواعيدي</a>
        <a href="/portal/invoices">فواتيري</a>
        <a href="/portal/balance">رصيدي وكشف الحساب</a>
      </nav>
      {payments.length === 0 ? (
        <p style={{ color: '#666' }}>لا توجد مدفوعات مسجلة.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {payments.map((p) => (
            <li key={p.payment_id} style={{ border: '1px solid #e2e2e2', borderRadius: 8, padding: 12, fontSize: 14 }}>
              <strong>{p.direction === 'refund' ? 'استرداد' : 'دفعة'}</strong> — {p.amount} ({p.method}) — {p.date?.slice(0, 10)}
              {p.invoice_number && <div style={{ color: '#555' }}>فاتورة: {p.invoice_number}{p.receipt_number ? ` · إيصال: ${p.receipt_number}` : ''}</div>}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
