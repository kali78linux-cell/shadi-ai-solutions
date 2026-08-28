/**
 * Arabic display layer for dashboard enums.
 * API/DB values are NEVER changed for localisation — these maps only affect
 * what the clinic manager sees on screen.
 */

export const PROVIDER_TYPE_AR: Record<string, string> = {
  dentist: 'طبيب أسنان',
  specialist: 'أخصائي',
  hygienist: 'أخصائي صحة الفم',
  receptionist: 'موظف استقبال',
  assistant: 'مساعد طبيب',
  manager: 'مدير العيادة',
  staff: 'موظف آخر',
};

/** Values accepted by /api/clinic/providers (mirrors DB CHECK constraint). */
export const PROVIDER_TYPES = Object.keys(PROVIDER_TYPE_AR);

export const APPOINTMENT_STATUS_AR: Record<string, string> = {
  pending: 'قيد الانتظار',
  confirmed: 'مؤكد',
  cancelled: 'ملغى',
  completed: 'منجز',
  no_show: 'لم يحضر',
};

export function appointmentStatusAr(status: unknown): string {
  return APPOINTMENT_STATUS_AR[String(status)] ?? String(status ?? '');
}

export const COMMUNICATION_STATUS_AR: Record<string, string> = {
  sent: 'أُرسلت',
  failed: 'فشلت',
  cancelled: 'ألغيت',
  retried: 'أُعيدت المحاولة',
};

export const COMMUNICATION_CHANNEL_AR: Record<string, string> = {
  email: 'بريد إلكتروني',
  whatsapp: 'واتساب',
  sms: 'رسالة نصية',
};

export const ACTIVE_AR: Record<string, string> = {
  true: 'نشط',
  false: 'غير نشط',
};

export const WEEKDAY_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const PRICING_TYPE_AR: Record<string, string> = {
  unspecified: 'بدون سعر معلن',
  fixed: 'سعر ثابت',
  estimate: 'سعر تقديري',
  range: 'نطاق سعري',
  case_by_case: 'حسب الحالة',
};

/** "14:30" → "٢:٣٠ ظهرًا"-style readable Arabic time. */
export function formatTimeAr(hhmm: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!match) return hhmm ?? '';
  const h = Number(match[1]);
  const m = match[2];
  const period = h < 12 ? 'صباحًا' : h === 12 || h >= 17 ? 'مساءً' : 'ظهرًا';
  let hour12 = h % 12;
  if (hour12 === 0) hour12 = 12;
  const minutes = m === '00' ? '' : `:${m}`;
  return `${hour12}${minutes} ${period}`;
}
