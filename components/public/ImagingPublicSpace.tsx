import type { ActivityPublicSpace } from '@/lib/services/activityPublicSpace';
import { ActivitySpaceChrome, ContactBlock, WorkingHoursBlock } from '@/components/public/ActivitySpaceChrome';

/**
 * PHASE C — Imaging / Radiology Center public space.
 * Section order follows the owner-approved journey:
 *   1) Hero (Chrome)  2) Logo/identity (Chrome)  3) CTA (Chrome)
 *   4) Gallery (Chrome — moved up)  5) Imaging services  6) About (Chrome)
 *   7) How the examination works  8) Preparation / report / delivery
 *   9) Working hours  10) Location/contact  11) AI reception (Chrome widget)
 * Domain data comes from the imaging_services catalog; honest copy only —
 * no invented equipment, prices or providers.
 */

const MODALITY_LABELS: Record<string, string> = {
  panoramic: 'بانوراما',
  intraoral: 'داخل الفم',
  cbct: 'تصوير ثلاثي الأبعاد (CBCT)',
  cephalometric: 'تصوير جانبي للجمجمة',
};

function servicePriceLabel(svc: { pricing_mode: string | null; price: number | null; price_min: number | null; price_max: number | null; price_note: string | null }): string | null {
  switch (svc.pricing_mode) {
    case 'fixed':
      return svc.price != null ? `${svc.price} ₪` : svc.price_note ?? null;
    case 'range':
      return svc.price_min != null && svc.price_max != null ? `${svc.price_min}–${svc.price_max} ₪` : svc.price_note ?? null;
    case 'estimate':
      return svc.price_min != null ? `≈${svc.price_min} ₪` : svc.price_note ?? null;
    default:
      return svc.price_note ?? null;
  }
}

export function ImagingPublicSpace({ space }: { space: ActivityPublicSpace }) {
  const hasImaging = space.imagingServices.length > 0;
  const hasShared = space.services.length > 0;
  return (
    <ActivitySpaceChrome
      space={space}
      headline={space.name}
      children={
        <>
          {/* 5) Imaging services / modalities */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-slate-800">خدمات التصوير والفحوصات</h2>
            {hasImaging ? (
              <ul className="space-y-3">
                {space.imagingServices.map((svc) => (
                  <li key={svc.name} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
                    <div>
                      <h3 className="font-semibold text-slate-800">{svc.name}</h3>
                      {svc.description && <p className="mt-1 text-sm text-slate-500">{svc.description}</p>}
                      {svc.modality && (
                        <p className="mt-1 text-xs text-slate-500">الجهاز/الطريقة: {MODALITY_LABELS[svc.modality] ?? svc.modality}</p>
                      )}
                      {svc.duration_minutes != null && <p className="mt-1 text-xs text-slate-500">المدة: {svc.duration_minutes} دقيقة</p>}
                      {svc.preparation_instructions && <p className="mt-1 text-xs text-slate-500">التحضير: {svc.preparation_instructions}</p>}
                      {svc.report_policy && <p className="mt-1 text-xs text-slate-500">التقرير: {svc.report_policy}</p>}
                      {svc.delivery_methods.length > 0 && <p className="mt-1 text-xs text-slate-500">التسليم: {svc.delivery_methods.join('، ')}</p>}
                    </div>
                    {servicePriceLabel(svc) && <span className="shrink-0 font-semibold text-brand-cyan">{servicePriceLabel(svc)}</span>}
                  </li>
                ))}
              </ul>
            ) : hasShared ? (
              <ul className="space-y-3">
                {space.services.map((service) => (
                  <li key={`${service.name}-${service.duration_minutes ?? 0}`} className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
                    <div>
                      <h3 className="font-semibold text-slate-800">{service.name}</h3>
                      {service.description && <p className="mt-1 text-sm text-slate-500">{service.description}</p>}
                    </div>
                    {service.price != null && <span className="shrink-0 font-semibold text-brand-cyan">{service.price} ₪</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                لم تُنشر خدمات التصوير بعد — تواصل مع المركز للاستفسار.
              </p>
            )}
          </section>

          {/* 7) How the examination works — generic honest flow, no invented details */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-slate-800">كيف تتم الفحصية؟</h2>
            <ol className="grid gap-3 sm:grid-cols-3">
              <li className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-bold text-slate-800">١. الطلب</p>
                <p className="mt-1 text-sm text-slate-500">اختر الفحص المطلوب عبر الحجز أو الاستقبال الذكي، أو أحضر إحالة عيادتك.</p>
              </li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-bold text-slate-800">٢. الفحص</p>
                <p className="mt-1 text-sm text-slate-500">يُلتقط التصوير في الموعد المحدد وفق تعليمات التحضير الخاصة بكل فحص.</p>
              </li>
              <li className="rounded-xl border border-slate-200 bg-white p-4">
                <p className="text-sm font-bold text-slate-800">٣. التقرير والتسليم</p>
                <p className="mt-1 text-sm text-slate-500">يُسلّم التقرير والصور بالطريقة المتفق عليها (طباعة/واتساب/إيميل/DICOM حسب الفحص).</p>
              </li>
            </ol>
          </section>

          {/* 8) Preparation / report / delivery policy */}
          <section className="mb-10 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-2 text-xl font-semibold text-slate-800">التحضير والتقرير والتسليم</h2>
            <p className="text-sm leading-relaxed text-slate-500">
              تظهر تعليمات التحضير وسياسة التقرير وطرق التسليم لكل فحص كما يحددها المركز في كتالوج الخدمات.
              لأي تفاصيل إضافية تواصل مع المركز مباشرة.
            </p>
          </section>

          {/* 9) Hours */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-slate-800">ساعات العمل</h2>
            <WorkingHoursBlock space={space} />
          </section>

          {/* 10) Center info */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-slate-800">معلومات المركز</h2>
            <ContactBlock space={space} />
          </section>
        </>
      }
    />
  );
}
