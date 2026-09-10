'use client';

import { useState } from 'react';
import { getSupabasePortalBrowserClient } from '@/lib/supabase/portalBrowser';

export default function PortalLoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = getSupabasePortalBrowserClient();
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/portal/auth/callback` },
    });
    setBusy(false);
    if (otpError) {
      setError('تعذر إرسال رابط الدخول. تأكد من البريد الإلكتروني وحاول مجددًا.');
      return;
    }
    setSent(true);
  }

  return (
    <main dir="rtl" style={{ maxWidth: 420, margin: '80px auto', padding: 24, fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 20, marginBottom: 8 }}>بوابة المريض</h1>
      <p style={{ color: '#555', fontSize: 14 }}>أدخل بريدك الإلكتروني وسنرسل لك رابط دخول آمن.</p>
      {sent ? (
        <div style={{ background: '#e7f5ee', padding: 16, borderRadius: 8, marginTop: 16 }}>
          تم إرسال رابط الدخول إلى <strong>{email}</strong>. تحقق من بريدك الإلكتروني.
        </div>
      ) : (
        <form onSubmit={sendMagicLink} style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          <input
            type="email"
            required
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            style={{ padding: 10, borderRadius: 8, border: '1px solid #ccc' }}
          />
          <button type="submit" disabled={busy} style={{ padding: 10, borderRadius: 8, cursor: 'pointer' }}>
            {busy ? 'جارٍ الإرسال…' : 'إرسال رابط الدخول'}
          </button>
          {error && <div style={{ color: '#b42318', fontSize: 14 }}>{error}</div>}
        </form>
      )}
    </main>
  );
}
