'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ChatLanding from './ChatLanding';
import { buildClinicLookupQuery, clinicGateStateFromPayload } from '@/lib/chat/clinicGate';

type GateState =
  | { phase: 'validating' }
  | { phase: 'ready'; clinicId: string; clinicName: string | null }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | { phase: 'missing' };

/**
 * SERVER-VALIDATED clinic context for the public /chat page.
 *
 * How the clinic is determined (no universal demo leak):
 *  1. `?clinic=` query param — a public clinic link (slug or uuid) such as
 *     `/chat?clinic=demo-dental-clinic`, resolved against the live DB via
 *     /api/booking/clinic (resolvePublicClinic — no fake fallbacks).
 *  2. Bare /chat with no param: in a NON-PRODUCTION (demo) runtime we default
 *     to the shared demo clinic slug so the page opens on its own. In
 *     production, no param ⇒ explicit guidance page (never a demo leak).
 *
 * The resolved clinic id is passed to FloatingChatWidget → ChatInterface →
 * the existing public AI API (unchanged).
 */
export default function ChatClinicGate() {
  const searchParams = useSearchParams();
  const clinicParam = searchParams?.get('clinic');
  const [state, setState] = useState<GateState>({ phase: 'validating' });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'validating' });

    let identifier: string | null = clinicParam ?? null;
    let isDemoDefault = false;
    if (!identifier && process.env.NODE_ENV !== 'production') {
      identifier = 'demo-dental-clinic';
      isDemoDefault = true;
    }

    async function validate() {
      if (!identifier) {
        if (!cancelled) setState({ phase: 'missing' });
        return;
      }
      try {
        const query = buildClinicLookupQuery(identifier!);
        const res = await fetch(`/api/booking/clinic?${query}`);
        if (res.status === 404) {
          if (!cancelled) setState({ phase: 'not_found' });
          return;
        }
        if (!res.ok) throw new Error(`clinic lookup failed (${res.status})`);
        const payload = await res.json();
        const outcome = clinicGateStateFromPayload(payload);
        if (outcome.kind === 'not_found') {
          if (!cancelled) setState({ phase: 'not_found' });
          return;
        }
        if (!cancelled) {
          setState({
            phase: 'ready',
            clinicId: outcome.clinicId,
            clinicName: outcome.clinicName ?? (isDemoDefault ? 'العيادة التجريبية' : null),
          });
        }
      } catch (error) {
        if (!cancelled) {
          setState({ phase: 'error', message: error instanceof Error ? error.message : 'خطأ غير معروف' });
        }
      }
    }

    void validate();
    return () => {
      cancelled = true;
    };
  }, [clinicParam]);

  if (state.phase === 'validating') {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-slate-300">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-cyan-500/30 border-t-cyan-400" />
        <p className="text-lg font-medium text-white">جارٍ فتح محادثة العيادة…</p>
      </div>
    );
  }

  if (state.phase === 'not_found' || state.phase === 'error') {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-bold text-white">
          {state.phase === 'not_found' ? 'لم يتم العثور على هذه العيادة' : 'تعذر فتح المحادثة'}
        </h1>
        <p className="mt-3 text-slate-400">
          {state.phase === 'not_found'
            ? 'الرابط قد يكون قديماً أو غير صحيح. تواصل مع العيادة للحصول على الرابط الصحيح.'
            : state.message}
        </p>
      </div>
    );
  }

  if (state.phase === 'missing') {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-bold text-white">لم يتم تحديد العيادة</h1>
        <p className="mt-3 text-slate-400">
          افتح المحادثة من لوحة تحكم العيادة عبر زر «محادثة العيادة المباشرة»، أو استخدم رابط العيادة
          العام الذي يتضمن معرّف العيادة.
        </p>
      </div>
    );
  }

  return <ChatLanding clinicId={state.clinicId} clinicName={state.clinicName} />;
}
