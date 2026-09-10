import type { ActivityPublicSpace } from '@/lib/services/activityPublicSpace';
import { ActivitySpaceChrome, ContactBlock, WorkingHoursBlock, InitialsBrandMark } from '@/components/public/ActivitySpaceChrome';

/**
 * Dental Technician / Dental Lab public space (Phase C).
 * Laboratory/technician-oriented — NOT a doctor clinic or imaging center.
 * Presents laboratory services (turnaround-aware), case/referring-clinic
 * collaboration concepts, and request CTAs. Domain data sourced from the
 * additive lab_services catalog (tenant-scoped).
 */

export function DentalLabPublicSpace({ space }: { space: ActivityPublicSpace }) {
  const hasLab = space.labServices.length > 0;
  const hasShared = space.services.length > 0;
  return (
    <ActivitySpaceChrome
      space={space}
      headline={space.name}
      children={
        <>
          {/* Collaboration concept */}
          <section className="mb-10 rounded-xl border border-slate-200 bg-white p-5 text-center">
            <p className="text-sm leading-relaxed text-slate-600">
              نتعاون مع العيادات والأطباء لتنفيذ حالات الأسنان — من الاستقبال إلى التسليم.
              أرسل حالة، أو استفسر عن خدماتنا مباشرة عبر الاستقبال الذكي.
            </p>
          </section>

          {/* Lab services */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-slate-800">خدمات المختبر</h2>
            {hasLab ? (
              <ul className="space-y-3">
                {space.labServices.map((svc) => (
                  <li
                    key={svc.name}
                    className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
                  >
                    <div>
                      <h3 className="font-semibold text-slate-800">{svc.name}</h3>
                      {svc.description && (
                        <p className="mt-1 text-sm text-slate-500">{svc.description}</p>
                      )}
                      {svc.turnaround_hours != null && (
                        <p className="mt-1 text-xs text-slate-500">
                          مدة الإنجاز: {svc.turnaround_hours} ساعة
                        </p>
                      )}
                    </div>
                    {svc.price != null && (
                      <span className="shrink-0 font-semibold text-brand-cyan">{svc.price} ₪</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : hasShared ? (
              <ul className="space-y-3">
                {space.services.map((service) => (
                  <li
                    key={`${service.name}-${service.duration_minutes ?? 0}`}
                    className="flex items-start justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4"
                  >
                    <div>
                      <h3 className="font-semibold text-slate-800">{service.name}</h3>
                      {service.description && (
                        <p className="mt-1 text-sm text-slate-500">{service.description}</p>
                      )}
                    </div>
                    {service.price != null && (
                      <span className="shrink-0 font-semibold text-brand-cyan">{service.price} ₪</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                لم تُنشر خدمات المختبر بعد — تواصل مع المختبر للاستفسار.
              </p>
            )}
          </section>

          {/* Turnaround / collaboration concept */}
          <section className="mb-10 rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-2 text-xl font-semibold text-slate-800">التعاون مع العيادات</h2>
            <p className="text-sm leading-relaxed text-slate-500">
              أرسل حالة أو استفسارًا عبر الاستقبال الذكي، وسيتولى المختبر متابعة الطلب والإنتاج
              والتسليم مع توضيح المدة المتوقعة لكل حالة.
            </p>
          </section>

          {/* Hours */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-slate-800">ساعات العمل</h2>
            <WorkingHoursBlock space={space} />
          </section>

          {/* Lab info */}
          <section className="mb-10">
            <h2 className="mb-3 text-xl font-semibold text-slate-800">معلومات المختبر</h2>
            <ContactBlock space={space} />
          </section>
        </>
      }
    />
  );
}