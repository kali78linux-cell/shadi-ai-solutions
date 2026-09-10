/**
 * Lightweight centralized Arabic dictionary for the clinic Dashboard.
 *
 * This project has no i18n framework — the Dashboard used hardcoded English
 * strings. To avoid scattering translations ad-hoc in every component, we keep
 * a single dictionary (key → Arabic) and a tiny `t()` helper. This is easily
 * extensible (add more keys here) and keeps translation in one place.
 *
 * NOTE: DB-stored data (clinic names, doctor names, service names, status
 * strings sent to the API) is NOT translated here — UI copy only.
 */

export const dict = {
  // ── Navigation / layout ──
  dashboardHome: 'الرئيسية',
  patients: 'المرضى',
  appointments: 'المواعيد',
  aiConversations: 'محادثات الذكاء الاصطناعي',
  knowledgeBase: 'قاعدة المعرفة',
  clinicSetup: 'إعداد العيادة',
  aiSettings: 'إعدادات الذكاء الاصطناعي',
  teamManagement: 'إدارة الفريق',
  analytics: 'التحليلات',
  subscription: 'الاشتراك',
  menu: 'القائمة',
  clinicDashboard: 'لوحة تحكم العيادة',
  dentalAiReceptionist: 'موظفة استقبال الأسنان الذكية',
  manageAppointmentsAiChatAndKnowledge: 'إدارة المواعيد، دردشة الذكاء الاصطناعي، وقاعدة المعرفة في مكان واحد.',
  logout: 'تسجيل الخروج',
  user: 'المستخدم',
  home: 'الرئيسية',

  // ── Clinic Setup ──
  completeYourClinicProfile: 'أكمل بيانات عيادتك',
  setupIncomplete: 'الإعداد غير مكتمل',
  setupComplete: 'الإعداد مكتمل',
  readyForBooking: 'جاهز لاستقبال الحجوزات',
  setupChecklist: 'قائمة التحقق من الإعداد',
  clinicProfile: 'ملف العيادة',
  providers: 'مقدمو الخدمة',
  services: 'الخدمات',
  workingHours: 'ساعات العمل',
  serviceAssignments: 'تخصيص الخدمات',
  basicInfoShownToPatients: 'المعلومات الأساسية المعروضة للمرضى على صفحة الحجز.',
  clinicName: 'اسم العيادة',
  phone: 'رقم الهاتف',
  address: 'العنوان',
  website: 'الموقع الإلكتروني',
  saveProfile: 'حفظ الملف',
  addYourFirstProvider: 'أضف أول مقدم خدمة',
  addYourFirstService: 'أضف أول خدمة',
  configureWorkingHours: 'اضبط ساعات العمل',
  assignServicesToProviders: 'خصص الخدمات لمقدمي الخدمة',
  supabaseNotConfigured: 'Supabase غير مهيأ',
  enableYourClinicBackend: 'فعّل مزود العيادة الخلفي لإعداد عيادتك.',
  configCheckUnavailable: 'تعذر التحقق من الإعدادات',
  serviceUnavailable: 'الخدمة غير متاحة حالياً',
  setupIncompleteStatus: 'الإعداد غير مكتمل',
  completeYourClinicProfileCheck: 'أكمل ملف عيادتك (الاسم، الهاتف، العنوان)',

  // ── Dashboard Home / Overview ──
  todayAppointments: 'مواعيد اليوم',
  confirmedAndPending: 'مؤكدة وقيد الانتظار',
  aiUsage: 'استخدام الذكاء الاصطناعي',
  messagesProcessed: 'رسائل تمت معالجتها',
  leads: 'العملاء المحتملون',
  newLeads: 'عملاء جدد',
  unreadConversations: 'محادثات غير مقروءة',
  revenue: 'الإيرادات',
  clinicalServices: 'خدمات العيادة',
  conversionRate: 'معدل التحويل',
  dashboardMetricsUnavailable: 'بيانات لوحة التحكم غير متاحة',
  tryAgainLater: 'حاول مرة أخرى لاحقاً.',

  // ── Shared actions ──
  save: 'حفظ',
  saving: 'جارٍ الحفظ...',
  saved: 'تم الحفظ',
  cancel: 'إلغاء',
  delete: 'حذف',
  edit: 'تعديل',
  view: 'عرض',
  add: 'إضافة',
  search: 'بحث',
  actions: 'إجراءات',
  loading: 'جارٍ التحميل...',
  success: 'تمت العملية بنجاح',
  failed: 'فشلت العملية',
  notFound: 'غير موجود',
  unauthorized: 'غير مصرح',
  forbidden: 'ممنوع',
} as const;

export type DictionaryKey = keyof typeof dict;

/** Translate a dashboard UI key. */
export function t(key: DictionaryKey): string {
  return dict[key];
}

/** UI-only labels for API/database enum values. Stored values are never changed. */
export function dashboardStatus(value?: string | null): string {
  const labels: Record<string, string> = {
    open: 'مفتوحة', closed: 'مغلقة', awaiting_human: 'بانتظار موظف',
    pending: 'قيد الانتظار', scheduled: 'مجدول', confirmed: 'مؤكد',
    cancelled: 'ملغي', completed: 'مكتمل', no_show: 'لم يحضر',
    sent: 'تم الإرسال', failed: 'فشل', processing: 'جارٍ المعالجة',
    indexed: 'مفهرس', error: 'خطأ',
  };
  return labels[value ?? ''] ?? value ?? 'غير محدد';
}

/**
 * Human-friendly Arabic relative time for staff lists ("قبل ٥ دقائق").
 * UI-only; never persisted.
 */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'الآن';
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.round(hours / 24);
  if (days < 30) return `قبل ${days} يوم`;
  return new Date(iso).toLocaleDateString('ar', { day: 'numeric', month: 'long' });
}
