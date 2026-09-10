'use client';

import { useEffect, useState } from 'react';

type Invoice = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  issued_at: string | null;
  total: number;
  paid: number;
  balance: number;
};

export default function PortalInvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/invoices', { credentials: 'include' });
      if (!res.ok) {
        setDenied(true);
        return;
      }
      setInvoices(((await res.json()) as { invoices: Invoice[] }).invoices);
    })();
  }, []);

  if (denied) return <main dir="rtl" style={{ padding: 40 }}><p>الجلسة غير صالحة. <a href="/portal/login">تسجيل الدخول</a></p></main>;

  return (
    <main dir="rtl" style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>فواتيري</h1>
      <nav style={{ margin: '12px 0', fontSize: 14, display: 'grid', gap: 4 }}>
        <a href="/portal">مواعيدي</a>
        <a href="/portal/balance">رصيدي وكشف الحساب</a>
        <a href="/portal/payments">مدفوعاتي</a>
      </nav>
      {invoices === null ? (
        <p>جارٍ التحميل…</p>
      ) : invoices.length === 0 ? (
        <p style={{ color: '#666' }}>لا توجد فواتير.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {invoices.map((inv) => (
            <li key={inv.invoice_id} style={{ border: '1px solid #e2e2e2', borderRadius: 8, padding: 12 }}>
              <a href={`/portal/invoices/${inv.invoice_id}`} style={{ fontWeight: 700 }}>
                {inv.invoice_number}
              </a>
              <div style={{ fontSize: 14, color: '#555' }}>
                الحالة: {inv.status} · الإجمالي: {inv.total} · المدفوع: {inv.paid} · المتبقي: {inv.balance}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
