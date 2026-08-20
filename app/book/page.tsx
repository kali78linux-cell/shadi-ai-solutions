'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

type Service = { id: string; name: string; description: string | null; duration_minutes: number; price: number | null };
type Provider = { id: string; name: string; title: string | null };
type BookingStep = 'service' | 'provider' | 'date' | 'time' | 'patient' | 'confirm' | 'success';

type ClinicResolution =
  | { status: 'loading'; clinic: null }
  | { status: 'ready'; clinic: { id: string; slug: string; name: string } }
  | { status: 'not-found'; clinic: null };

function BookingForm() {
  const searchParams = useSearchParams();
  const clinicIdParam = searchParams.get('clinic_id') || undefined;
  const slugParam = searchParams.get('slug') || undefined;
  const actionParam = searchParams.get('action') || undefined;
  const appointmentIdParam = searchParams.get('appointment_id') || undefined;
  const tokenParam = searchParams.get('token') || undefined;

  const [clinic, setClinic] = useState<ClinicResolution>({ status: 'loading', clinic: null });
  const [deepLinkState, setDeepLinkState] = useState<{ status: 'idle' | 'processing' | 'done' | 'error'; message: string | null }>({ status: 'idle', message: null });
  const [step, setStep] = useState<BookingStep>('service');
  const [services, setServices] = useState<Service[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [patientInfo, setPatientInfo] = useState({ name: '', phone: '', email: '' });
  const [loading, setLoading] = useState<'services' | 'providers' | 'slots' | 'booking' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bookingResult, setBookingResult] = useState<{ appointment_id: string; date: string; time: string; service: string; provider_id: string; status: string; booking_token: string } | null>(null);
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [lifecycleLoading, setLifecycleLoading] = useState<'confirm' | 'cancel' | null>(null);

  // Resolve the public clinic first. Never falls back to a fake/default clinic.
  useEffect(() => {
    let cancelled = false;
    setClinic({ status: 'loading', clinic: null });
    const params = new URLSearchParams();
    if (clinicIdParam) params.set('clinic_id', clinicIdParam);
    if (slugParam) params.set('slug', slugParam);
    const qs = params.toString();

    if (!qs) {
      if (!cancelled) setClinic({ status: 'not-found', clinic: null });
      return;
    }

    fetch(`/api/booking/clinic?${qs}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setClinic({ status: 'not-found', clinic: null });
          return null;
        }
        if (!res.ok) throw new Error('Failed to resolve clinic');
        return res.json();
      })
      .then((body) => {
        if (cancelled || !body) return;
        setClinic({ status: 'ready', clinic: body.data });
      })
      .catch(() => {
        if (!cancelled) setClinic({ status: 'not-found', clinic: null });
      });
    return () => { cancelled = true; };
  }, [clinicIdParam, slugParam]);

  const clinicId = clinic.status === 'ready' ? clinic.clinic.id : null;

  // Handle secure deep links from email (action=confirm|cancel&appointment_id&token=...)
  useEffect(() => {
    if (!clinicId || !actionParam || !appointmentIdParam || !tokenParam) return;
    if (actionParam !== 'confirm' && actionParam !== 'cancel') {
      setDeepLinkState({ status: 'error', message: 'إجراء غير صالح' });
      return;
    }
    if (deepLinkState.status !== 'idle') return;

    setDeepLinkState({ status: 'processing', message: null });
    const endpoint = actionParam === 'confirm' ? '/api/booking/confirm' : '/api/booking/cancel';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clinic_id: clinicId,
        appointment_id: appointmentIdParam,
        token: tokenParam,
      }),
    })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'فشل العملية');
        setDeepLinkState({
          status: 'done',
          message: actionParam === 'confirm' ? 'تم تأكيد الحجز بنجاح' : 'تم إلغاء الحجز',
        });
      })
      .catch((err) => {
        setDeepLinkState({
          status: 'error',
          message: err instanceof Error ? err.message : 'حدث خطأ أثناء العملية',
        });
      });
  }, [clinicId, actionParam, appointmentIdParam, tokenParam, deepLinkState.status]);

  // Step 1: Load services once clinic is resolved
  useEffect(() => {
    if (!clinicId) return;
    let cancelled = false;
    setLoading('services');
    setError(null);
    fetch(`/api/booking/services?clinic_id=${encodeURIComponent(clinicId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load services');
        return res.json();
      })
      .then((body) => {
        if (!cancelled) setServices(body.data.services || []);
      })
      .catch(() => {
        if (!cancelled) setError('تعذر تحميل الخدمات. يرجى المحاولة لاحقًا.');
      })
      .finally(() => {
        if (!cancelled) setLoading(null);
      });
    return () => { cancelled = true; };
  }, [clinicId]);

  // Step 2: Load providers when service selected
  useEffect(() => {
    if (!selectedService) {
      setProviders([]);
      return;
    }
    let cancelled = false;
    setLoading('providers');
    setError(null);
    fetch(`/api/booking/providers?clinic_id=${encodeURIComponent(clinicId)}&service_id=${encodeURIComponent(selectedService.id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load providers');
        return res.json();
      })
      .then((body) => {
        if (!cancelled) setProviders(body.data.providers || []);
      })
      .catch(() => {
        if (!cancelled) setError('تعذر تحميل الأطباء المتاحين.');
      })
      .finally(() => {
        if (!cancelled) setLoading(null);
      });
    return () => { cancelled = true; };
  }, [selectedService, clinicId]);

  // Step 4: Load slots when date + provider selected
  useEffect(() => {
    if (!selectedProvider || !selectedDate || !selectedService) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setLoading('slots');
    setError(null);
    fetch(`/api/booking/availability?clinic_id=${encodeURIComponent(clinicId)}&provider_id=${encodeURIComponent(selectedProvider.id)}&date=${encodeURIComponent(selectedDate)}&service_id=${encodeURIComponent(selectedService.id)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load slots');
        return res.json();
      })
      .then((body) => {
        if (!cancelled) setSlots(body.data.slots || []);
      })
      .catch(() => {
        if (!cancelled) setError('تعذر تحميل المواعيد المتاحة.');
      })
      .finally(() => {
        if (!cancelled) setLoading(null);
      });
    return () => { cancelled = true; };
  }, [selectedProvider, selectedDate, selectedService, clinicId]);

  const todayISO = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const selectService = (service: Service) => {
    setSelectedService(service);
    setSelectedProvider(null);
    setSelectedSlot('');
    setStep('provider');
  };

  const selectProvider = (provider: Provider) => {
    setSelectedProvider(provider);
    setSelectedSlot('');
    setStep('date');
  };

  const selectDate = (date: string) => {
    setSelectedDate(date);
    setSelectedSlot('');
    setStep('time');
  };

  const selectSlot = (slot: string) => {
    setSelectedSlot(slot);
    setStep('patient');
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const h = d.getUTCHours().toString().padStart(2, '0');
    const m = d.getUTCMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const validatePatient = () => {
    if (!patientInfo.name.trim()) return 'يرجى إدخال الاسم الكامل';
    if (patientInfo.phone.trim().length < 7) return 'يرجى إدخال رقم هاتف صحيح';
    if (patientInfo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patientInfo.email)) return 'يرجى إدخال بريد إلكتروني صحيح';
    return null;
  };

  const submitBooking = async () => {
    const validationError = validatePatient();
    if (validationError) {
      setError(validationError);
      return;
    }
    setLoading('booking');
    setError(null);
    try {
      const res = await fetch('/api/booking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_id: clinicId,
          provider_id: selectedProvider!.id,
          service: selectedService!.name,
          service_id: selectedService!.id,
          date: selectedDate,
          time: formatTime(selectedSlot),
          patient_name: patientInfo.name.trim(),
          phone: patientInfo.phone.trim(),
          email: patientInfo.email.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status === 409) {
          setError('هذا الموعد لم يعد متاحًا. يرجى اختيار موعد آخر.');
          // Reload slots
          fetch(`/api/booking/availability?clinic_id=${encodeURIComponent(clinicId)}&provider_id=${encodeURIComponent(selectedProvider!.id)}&date=${encodeURIComponent(selectedDate)}&service_id=${encodeURIComponent(selectedService!.id)}`)
            .then((r) => r.json())
            .then((b) => setSlots(b.data?.slots || []));
          setStep('time');
          setSelectedSlot('');
          return;
        }
        throw new Error(body.error || 'فشل الحجز');
      }
      setBookingResult({
        appointment_id: body.data.appointment_id,
        date: body.data.date,
        time: body.data.time,
        service: body.data.service,
        provider_id: body.data.provider_id,
        status: body.data.status,
        booking_token: body.data.booking_token,
      });
      setStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'حدث خطأ أثناء الحجز. يرجى المحاولة لاحقًا.');
    } finally {
      setLoading(null);
    }
  };

  const handleConfirmBooking = async () => {
    if (!bookingResult || !clinicId) return;
    setLifecycleLoading('confirm');
    setLifecycleError(null);
    setLifecycleMessage(null);
    try {
      const res = await fetch('/api/booking/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_id: clinicId,
          appointment_id: bookingResult.appointment_id,
          token: bookingResult.booking_token,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'فشل تأكيد الحجز');
      setBookingResult((prev) => prev ? { ...prev, status: body.data.status } : prev);
      setLifecycleMessage('تم تأكيد الحجز بنجاح');
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : 'حدث خطأ أثناء تأكيد الحجز');
    } finally {
      setLifecycleLoading(null);
    }
  };

  const handleCancelBooking = async () => {
    if (!bookingResult || !clinicId) return;
    setLifecycleLoading('cancel');
    setLifecycleError(null);
    setLifecycleMessage(null);
    try {
      const res = await fetch('/api/booking/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clinic_id: clinicId,
          appointment_id: bookingResult.appointment_id,
          token: bookingResult.booking_token,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'فشل إلغاء الحجز');
      setBookingResult((prev) => prev ? { ...prev, status: body.data.status } : prev);
      setLifecycleMessage('تم إلغاء الحجز');
    } catch (err) {
      setLifecycleError(err instanceof Error ? err.message : 'حدث خطأ أثناء إلغاء الحجز');
    } finally {
      setLifecycleLoading(null);
    }
  };

  const resetBooking = () => {
    setStep('service');
    setSelectedService(null);
    setSelectedProvider(null);
    setSelectedDate('');
    setSelectedSlot('');
    setPatientInfo({ name: '', phone: '', email: '' });
    setBookingResult(null);
    setError(null);
    setLifecycleMessage(null);
    setLifecycleError(null);
  };

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 text-center">
          <span className="inline-flex rounded-full bg-cyan-500/15 px-4 py-1 text-sm font-semibold text-cyan-300">
            حجز موعد
          </span>
          <h1 className="mt-4 text-3xl font-semibold text-white sm:text-4xl">احجز موعدك في عيادتنا</h1>
          <p className="mt-2 text-slate-400">اختر الخدمة والطبيب والوقت المناسب لك</p>
        </header>

        <div className="rounded-[2rem] border border-slate-800 bg-slate-900/80 p-6 shadow-xl shadow-slate-950/30 sm:p-8">
          {deepLinkState.status === 'processing' && (
            <div className="flex items-center justify-center gap-3 py-12 text-slate-400" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
              جاري معالجة الطلب...
            </div>
          )}

          {deepLinkState.status === 'done' && (
            <div className="py-12 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl text-emerald-400">✓</div>
              <h2 className="text-2xl font-semibold text-white">{deepLinkState.message}</h2>
              <Link href="/" className="mt-8 inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                العودة للرئيسية
              </Link>
            </div>
          )}

          {deepLinkState.status === 'error' && (
            <div className="py-12 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 text-3xl text-red-400">✕</div>
              <h2 className="text-2xl font-semibold text-white">تعذرت العملية</h2>
              <p className="mt-2 text-slate-400">{deepLinkState.message}</p>
              <Link href="/" className="mt-8 inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                العودة للرئيسية
              </Link>
            </div>
          )}

          {deepLinkState.status === 'idle' && clinic.status === 'loading' && (
            <div className="flex items-center justify-center gap-3 py-12 text-slate-400" role="status">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
              جاري تحميل العيادة...
            </div>
          )}

          {clinic.status === 'not-found' && (
            <div className="py-12 text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 text-3xl text-red-400">✕</div>
              <h2 className="text-2xl font-semibold text-white">العيادة غير موجودة</h2>
              <p className="mt-2 text-slate-400">لم يتم العثور على العيادة المطلوبة. يرجى التحقق من الرابط والمحاولة مرة أخرى.</p>
              <Link href="/" className="mt-8 inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                العودة للرئيسية
              </Link>
            </div>
          )}

          {clinic.status === 'ready' && step === 'success' && bookingResult ? (
            <div className="text-center">
              <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-3xl text-emerald-400">✓</div>
              <h2 className="text-2xl font-semibold text-white">تم إنشاء الحجز بنجاح</h2>
              <p className="mt-2 text-slate-400">رقم الحجز: <span className="font-semibold text-slate-200">{bookingResult.appointment_id}</span></p>
              <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-950/60 p-5 text-left">
                <Row label="الخدمة" value={bookingResult.service} />
                <Row label="التاريخ" value={bookingResult.date} />
                <Row label="الوقت" value={bookingResult.time} />
                <Row label="الحالة" value={bookingResult.status === 'tentative' ? 'قيد الانتظار' : bookingResult.status === 'confirmed' ? 'مؤكد' : bookingResult.status === 'cancelled' ? 'ملغي' : bookingResult.status} />
              </div>

              {lifecycleMessage && (
                <div role="status" className="mt-4 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
                  {lifecycleMessage}
                </div>
              )}
              {lifecycleError && (
                <div role="alert" className="mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {lifecycleError}
                </div>
              )}

              {bookingResult.status === 'tentative' && (
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <button
                    onClick={handleConfirmBooking}
                    disabled={lifecycleLoading !== null}
                    className="flex-1 rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                  >
                    {lifecycleLoading === 'confirm' ? 'جاري التأكيد...' : 'تأكيد الحجز'}
                  </button>
                  <button
                    onClick={handleCancelBooking}
                    disabled={lifecycleLoading !== null}
                    className="flex-1 rounded-full border border-red-500/50 px-6 py-3 text-sm font-semibold text-red-300 hover:border-red-400 hover:bg-red-500/10 disabled:opacity-60"
                  >
                    {lifecycleLoading === 'cancel' ? 'جاري الإلغاء...' : 'إلغاء الحجز'}
                  </button>
                </div>
              )}

              {bookingResult.status === 'confirmed' && (
                <button
                  onClick={handleCancelBooking}
                  disabled={lifecycleLoading !== null}
                  className="mt-6 w-full rounded-full border border-red-500/50 px-6 py-3 text-sm font-semibold text-red-300 hover:border-red-400 hover:bg-red-500/10 disabled:opacity-60"
                >
                  {lifecycleLoading === 'cancel' ? 'جاري الإلغاء...' : 'إلغاء الحجز'}
                </button>
              )}

              <button onClick={resetBooking} className="mt-8 inline-flex items-center justify-center rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400">
                حجز موعد آخر
              </button>
            </div>
          ) : clinic.status === 'ready' ? (
            <>
              {/* Step indicator */}
              <div className="mb-6 flex flex-wrap items-center gap-2" aria-label="Progress">
                {['الخدمة', 'الطبيب', 'التاريخ', 'الوقت', 'البيانات', 'التأكيد'].map((label, i) => {
                  const stepOrder: BookingStep[] = ['service', 'provider', 'date', 'time', 'patient', 'confirm'];
                  const currentIndex = stepOrder.indexOf(step);
                  const isActive = i <= currentIndex;
                  return (
                    <span key={label} className={`rounded-full px-3 py-1 text-xs font-semibold ${isActive ? 'bg-cyan-500 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
                      {i + 1}. {label}
                    </span>
                  );
                })}
              </div>

              {error && (
                <div role="alert" className="mb-5 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {/* Step 1: Service */}
              {step === 'service' && (
                <section aria-labelledby="service-heading">
                  <h2 id="service-heading" className="text-xl font-semibold text-white">اختر الخدمة</h2>
                  {loading === 'services' ? (
                    <Loading text="جاري تحميل الخدمات..." />
                  ) : services.length === 0 ? (
                    <Empty text="لا توجد خدمات متاحة حاليًا." />
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {services.map((service) => (
                        <button
                          key={service.id}
                          onClick={() => selectService(service)}
                          className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-500/70 hover:bg-slate-900"
                        >
                          <p className="font-semibold text-white">{service.name}</p>
                          {service.description && <p className="mt-1 text-sm text-slate-400">{service.description}</p>}
                          <p className="mt-2 text-sm text-cyan-300">
                            {service.duration_minutes} دقيقة{dashedPrice(service.price)}
                          </p>
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Step 2: Provider */}
              {step === 'provider' && (
                <section aria-labelledby="provider-heading">
                  <h2 id="provider-heading" className="text-xl font-semibold text-white">اختر الطبيب</h2>
                  {loading === 'providers' ? (
                    <Loading text="جاري تحميل الأطباء..." />
                  ) : providers.length === 0 ? (
                    <Empty text="لا يوجد أطباء متاحون لهذه الخدمة حاليًا." />
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {providers.map((provider) => (
                        <button
                          key={provider.id}
                          onClick={() => selectProvider(provider)}
                          className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4 text-left transition hover:border-cyan-500/70 hover:bg-slate-900"
                        >
                          <p className="font-semibold text-white">{provider.name}</p>
                          {provider.title && <p className="mt-1 text-sm text-slate-400">{provider.title}</p>}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Step 3: Date */}
              {step === 'date' && (
                <section aria-labelledby="date-heading">
                  <h2 id="date-heading" className="text-xl font-semibold text-white">اختر التاريخ</h2>
                  <label htmlFor="booking-date" className="mt-4 block text-sm font-medium text-slate-300">التاريخ</label>
                  <input
                    id="booking-date"
                    type="date"
                    min={todayISO}
                    value={selectedDate}
                    onChange={(e) => selectDate(e.target.value)}
                    className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 focus:border-cyan-500 focus:outline-none"
                  />
                </section>
              )}

              {/* Step 4: Time */}
              {step === 'time' && (
                <section aria-labelledby="time-heading">
                  <h2 id="time-heading" className="text-xl font-semibold text-white">اختر الوقت المتاح</h2>
                  <p className="mt-1 text-sm text-slate-400">التاريخ المحدد: {selectedDate}</p>
                  {loading === 'slots' ? (
                    <Loading text="جاري تحميل الأوقات المتاحة..." />
                  ) : slots.length === 0 ? (
                    <Empty text="لا توجد أوقات متاحة في هذا التاريخ. يرجى اختيار تاريخ آخر." />
                  ) : (
                    <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {slots.map((slot) => (
                        <button
                          key={slot}
                          onClick={() => selectSlot(slot)}
                          className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-center transition hover:border-cyan-500/70 hover:bg-slate-900"
                        >
                          {formatTime(slot)}
                        </button>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* Step 5: Patient */}
              {step === 'patient' && (
                <section aria-labelledby="patient-heading">
                  <h2 id="patient-heading" className="text-xl font-semibold text-white">بياناتك</h2>
                  <div className="mt-4 space-y-4">
                    <div>
                      <label htmlFor="patient-name" className="block text-sm font-medium text-slate-300">الاسم الكامل</label>
                      <input
                        id="patient-name"
                        type="text"
                        value={patientInfo.name}
                        onChange={(e) => setPatientInfo((p) => ({ ...p, name: e.target.value }))}
                        placeholder="مثال: محمد أحمد"
                        className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="patient-phone" className="block text-sm font-medium text-slate-300">رقم الهاتف</label>
                      <input
                        id="patient-phone"
                        type="tel"
                        value={patientInfo.phone}
                        onChange={(e) => setPatientInfo((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="مثال: 0501234567"
                        className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label htmlFor="patient-email" className="block text-sm font-medium text-slate-300">البريد الإلكتروني (اختياري)</label>
                      <input
                        id="patient-email"
                        type="email"
                        value={patientInfo.email}
                        onChange={(e) => setPatientInfo((p) => ({ ...p, email: e.target.value }))}
                        placeholder="example@mail.com"
                        className="mt-2 w-full rounded-3xl border border-slate-800 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => { setError(null); setStep('confirm'); }}
                    className="mt-6 w-full rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400"
                  >
                    متابعة للتأكيد
                  </button>
                </section>
              )}

              {/* Step 6: Confirm */}
              {step === 'confirm' && (
                <section aria-labelledby="confirm-heading">
                  <h2 id="confirm-heading" className="text-xl font-semibold text-white">تأكيد الحجز</h2>
                  <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
                    <Row label="الخدمة" value={selectedService?.name || ''} />
                    <Row label="الطبيب" value={selectedProvider?.name || ''} />
                    <Row label="التاريخ" value={selectedDate} />
                    <Row label="الوقت" value={formatTime(selectedSlot)} />
                    <Row label="المريض" value={patientInfo.name} />
                    <Row label="الهاتف" value={patientInfo.phone} />
                  </div>
                  <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                    <button
                      onClick={submitBooking}
                      disabled={loading === 'booking'}
                      className="flex-1 rounded-full bg-cyan-500 px-6 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-400 disabled:opacity-60"
                    >
                      {loading === 'booking' ? 'جاري تأكيد الحجز...' : 'تأكيد الحجز'}
                    </button>
                    <button
                      onClick={() => setStep('patient')}
                      className="flex-1 rounded-full border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-300 hover:border-slate-500"
                    >
                      رجوع
                    </button>
                  </div>
                </section>
              )}
            </>
          ) : null}
        </div>

        <p className="mt-6 text-center text-xs text-slate-500">
          <Link href="/" className="hover:text-slate-300">العودة للرئيسية</Link>
        </p>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-800/60 py-2 last:border-0">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-sm font-semibold text-slate-200">{value}</span>
    </div>
  );
}

function Loading({ text }: { text: string }) {
  return (
    <div className="mt-6 flex items-center justify-center gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-8 text-slate-400" role="status">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-500 border-t-transparent" />
      {text}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="mt-6 rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-slate-400">
      {text}
    </div>
  );
}

function dashedPrice(price: number | null): string {
  return price != null ? ` • ${price} ر.س` : '';
}

export default function BookingPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
        <div className="mx-auto max-w-3xl text-center text-slate-400">جاري تحميل صفحة الحجز...</div>
      </main>
    }>
      <BookingForm />
    </Suspense>
  );
}