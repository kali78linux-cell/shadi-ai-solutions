'use client';

import { useEffect, useState } from 'react';

type InvoiceDetail = {
  invoice_id: string;
  invoice_number: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  currency: string | null;
  total: number;
  paid: number;
  balance: number;
  items: Array<{ description: string | null; quantity: number; unit_price: number; line_total: number }>;
};

export default function PortalInvoiceDetailPage({ params }: { params: { invoiceId: string } }) {
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/portal/invoices/${params.invoiceId}`, { credentials: 'include' });
      if (res.status === 404) {
        setMissing(true);
        return;
      }
      if (!res.ok) {
        setMissing(true);
        return;
      }
      setInvoice(((await res.json()) as { invoice: InvoiceDetail }).invoice);
    })();
  }, [params.invoiceId]);

  if (missing) return <main dir="rtl" style={{ padding: 40 }}><p>الفاتورة غير موجودة. <a href="/portal/invoices">عودة لفواتيري</a></p></main>;
  if (!invoice) return <main dir="rtl" style={{ padding: 40 }}>جارٍ التحميل…</main>;

  return (
    <main dir="rtl" style={{ maxWidth: 640, margin: '40px auto', padding: 24 }}>
      <a href="/portal/invoices" style={{ fontSize: 14 }}>← فواتيري</a>
      <h1 style={{ fontSize: 20, marginTop: 8 }}>{invoice.invoice_number}</h1>
      <p style={{ fontSize: 14, color: '#555' }}>
        الحالة: {invoice.status} · العملة: {invoice.currency ?? '—'} · الإصدار: {invoice.issued_at ?? '—'} · الاستحقاق: {invoice.due_at ?? '—'}
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12, fontSize: 14 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'right', borderBottom: '1px solid #ccc' }}>الوصف</th>
            <th style={{ borderBottom: '1px solid #ccc' }}>الكمية</th>
            <th style={{ borderBottom: '1px solid #ccc' }}>السعر</th>
            <th style={{ borderBottom: '1px solid #ccc' }}>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((it, i) => (
            <tr key={i}>
              <td style={{ padding: '6px 0' }}>{it.description ?? '—'}</td>
              <td style={{ textAlign: 'center' }}>{it.quantity}</td>
              <td style={{ textAlign: 'center' }}>{it.unit_price}</td>
              <td style={{ textAlign: 'center' }}>{it.line_total}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12, fontSize: 15 }}>
        <div>الإجمالي: <strong>{invoice.total}</strong></div>
        <div>المدفوع: {invoice.paid}</div>
        <div>المتبقي: <strong>{invoice.balance}</strong></div>
      </div>
    </main>
  );
}
