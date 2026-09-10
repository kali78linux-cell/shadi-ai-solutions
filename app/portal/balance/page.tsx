'use client';

import { useEffect, useState } from 'react';

type Statement = {
  outstanding: number;
  credit: number;
  invoices: Array<{ invoice_id: string; invoice_number: string; status: string; total: number; balance: number }>;
  payments: Array<{ date: string; amount: number; direction: string; invoice_number: string | null }>;
};

export default function PortalBalancePage() {
  const [statement, setStatement] = useState<Statement | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/portal/statement', { credentials: 'include' });
      if (!res.ok) {
        setDenied(true);
        return;
      }
      setStatement(((await res.json()) as { statement: Statement }).statement);
    })();
  }, []);

  if (denied) return <main dir="rtl" style={{ padding: 40 }}><p>الجلسة غير صالحة. <a href="/portal/login">تسجيل الدخول</a></p></main>;
  if (!statement) return <main dir="rtl" style={{ padding: 40 }}>جارٍ التحميل…</main>;

  return (
    <main dir="rtl" style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <h1 style={{ fontSize: 20 }}>رصيدي وكشف الحساب</h1>
      <nav style={{ margin: '12px 0', fontSize: 14, display: 'grid', gap: 4 }}>
        <a href="/portal">مواعيدي</a>
        <a href="/portal/invoices">فواتيري</a>
        <a href="/portal/payments">مدفوعاتي</a>
      </nav>
      <div style={{ display: 'grid', gap: 8, margin: '16px 0' }}>
        <div style={{ background: statement.outstanding > 0 ? '#fdf2e9' : '#e7f5ee', padding: 12, borderRadius: 8 }}>
          الرصيد المستحق: <strong>{statement.outstanding}</strong>
        </div>
        <div style={{ background: '#eef4fd', padding: 12, borderRadius: 8 }}>
          رصيد دائن (ائتمان): <strong>{statement.credit}</strong>
        </div>
      </div>
      <h2 style={{ fontSize: 16 }}>كشف الحساب</h2>
      <ul style={{ listStyle: 'none', padding: 0, fontSize: 14, display: 'grid', gap: 4 }}>
        {statement.invoices.map((i) => (
          <li key={`inv-${i.invoice_id}`}>
            🧾 فاتورة {i.invoice_number} — {i.status} — الإجمالي {i.total} — المتبقي {i.balance}
          </li>
        ))}
        {statement.payments.map((p, i) => (
          <li key={`pay-${i}`}>
            💳 {p.direction === 'refund' ? 'استرداد' : 'دفعة'} — {p.amount} — {p.invoice_number ?? ''} — {p.date?.slice(0, 10)}
          </li>
        ))}
      </ul>
    </main>
  );
}
