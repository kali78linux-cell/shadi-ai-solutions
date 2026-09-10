'use client';

import { useEffect, useState } from 'react';
import { useClinicContext } from '@/lib/useClinicContext';
import MessagingInterface from '@/components/dashboard/messaging/MessagingInterface';
import DashboardSection from '@/components/dashboard/DashboardSection';

export default function MessagesPage() {
  const { clinicId, clinicSlug, loading, error } = useClinicContext();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (clinicId && !loading) setReady(true);
  }, [clinicId, loading]);

  if (loading) {
    return (
      <DashboardSection title="الرسائل" subtitle="جارٍ تحميل بيانات العيادة…">
        <div className="text-center text-slate-500">جارٍ التحميل...</div>
      </DashboardSection>
    );
  }

  if (error) {
    return (
      <DashboardSection title="الرسائل" subtitle="خطأ في التحميل">
        <div className="text-center text-rose-400">{error}</div>
      </DashboardSection>
    );
  }

  if (!ready || !clinicId) return null;

  return (
    <div className="p-4 lg:p-6">
      <MessagingInterface clinicId={clinicId} clinicSlug={clinicSlug} />
    </div>
  );
}
