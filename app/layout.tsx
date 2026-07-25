import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Dental AI Receptionist',
  description: 'نظام استقبال ذكي لعيادات الأسنان مع لوحة تحكم ومحادثة AI وقاعدة معرفة.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
