'use client';

import { useClinicContext } from '@/lib/useClinicContext';
import { ACTIVITY_TYPE_LABELS_AR } from '@/lib/services/activityTypes';

/**
 * DASHBOARD ACTIVITY IDENTITY (root-cause fix)
 * --------------------------------------------
 * Renders the dashboard title/subtitle from the tenant's `activity_type`
 * (server-resolved via useClinicContext). Imaging centers / labs / clinics
 * each get correct terminology instead of a fixed Dental-Clinic identity.
 */
export default function ActivityIdentity() {
  const { activityType, clinicName } = useClinicContext();

  const type = activityType && activityType in ACTIVITY_TYPE_LABELS_AR
    ? (activityType as keyof typeof ACTIVITY_TYPE_LABELS_AR)
    : null;
  const isClinic = !type || type === 'clinic';

  const heading = isClinic
    ? 'مساعد استقبال الأسنان الذكي'
    : type === 'imaging_center'
      ? 'لوحة تحكم مركز التصوير'
      : type === 'dental_lab'
        ? 'لوحة تحكم المختبر'
        : 'لوحة التحكم';

  const subtitle = isClinic
    ? 'إدارة المواعيد، دردشة الذكاء الاصطناعي، وقاعدة المعرفة في مكان واحد.'
    : type === 'imaging_center'
      ? 'إدارة طلبات التصوير، الملفات الطبية، العيادات المحيلة، والمواعيد.'
      : type === 'dental_lab'
        ? 'إدارة الحالات، المختبر، والمواعيد.'
        : 'إدارة مؤسستك الصحية.';

  const label = type ? ACTIVITY_TYPE_LABELS_AR[type] : 'المؤسسة';

  return (
    <div>
      <p className="text-sm tracking-[0.1em] text-cyan-300/80">{label}</p>
      <h1 className="mt-2 text-2xl font-semibold text-white">{heading}</h1>
      <p className="mt-1 text-sm text-slate-400">
        {clinicName ? `${label}: ${clinicName}` : subtitle}
      </p>
    </div>
  );
}