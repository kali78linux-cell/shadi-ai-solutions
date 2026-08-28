'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ChatInterface from '@/components/chat/ChatInterface';

/**
 * Premium floating chat bubble + panel.
 *
 * Hosts the proven, unchanged ChatInterface (same public AI API it already
 * uses) inside an elegant, RTL premium wrapper:
 *  - floating bubble with a soft pulse/ripple showing availability
 *  - opens a panel that is desktop-sized on large screens and near-full on mobile
 *  - close returns to the landing page, never covering page content
 * The clinic identifier is resolved by the parent gate and passed here as a slug
 * (or uuid) — this component adds no data and no new API.
 */
export default function FloatingChatWidget({ clinicId, clinicName }: { clinicId: string; clinicName?: string | null }) {
  const [open, setOpen] = useState(false);

  // Prevent background scroll while the panel is open on mobile.
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden';
    else document.body.style.overflow = '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  return (
    <>
      <style jsx global>{`
        @keyframes chat-pulse {
          0% { transform: scale(1); opacity: 0.45; }
          70% { transform: scale(1.7); opacity: 0; }
          100% { transform: scale(1.7); opacity: 0; }
        }
      `}</style>
      <AnimatePresence>
        {!open && (
          <motion.button
            key="bubble"
            type="button"
            onClick={() => setOpen(true)}
            aria-label="فتح محادثة موظفة الاستقبال"
            className="pointer-events-auto fixed bottom-6 left-6 z-50 flex items-center gap-3"
            initial={{ opacity: 1, y: 30, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 30, scale: 0.8 }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 260, damping: 22 }}
          >
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 via-teal-400 to-violet-500 text-white shadow-xl shadow-cyan-500/40">
              <span aria-hidden className="absolute inset-0 -z-10 rounded-full bg-cyan-400/50" style={{ animation: 'chat-pulse 2.4s ease-out infinite' }} />
              <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
              </svg>
              <span className="absolute -right-0.5 -top-0.5 h-4 w-4 rounded-full border-2 border-white bg-emerald-400" />
            </span>
            <span className="pointer-events-none hidden select-none sm:block">
              <span className="block rounded-2xl bg-white/95 px-4 py-2 text-right text-sm font-semibold text-slate-800 shadow-lg">
                {clinicName ? clinicName : 'العيادة'}
              </span>
              <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                متاحة الآن
              </span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
      {/* /BUBBLE */}
        <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            className="pointer-events-auto fixed bottom-0 left-0 z-50 w-full sm:bottom-6 sm:left-6 sm:w-[26rem]"
            initial={{ opacity: 0, y: 60, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 60, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
          >
            <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-950/98 shadow-2xl shadow-slate-950/50 ring-1 ring-slate-800 sm:h-[min(76vh,44rem)] sm:rounded-t-[1.75rem] sm:rounded-l-[1.75rem]">
              {/* Panel header */}
              <div className="flex items-center justify-between bg-gradient-to-l from-cyan-600/25 to-violet-500/25 px-5 py-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-cyan-400 to-violet-500 text-white">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 8h1a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4h-8a4 4 0 0 1 0-8h1" />
                      <path d="M15 12v-1a3 3 0 0 0-3-3H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white">موظفة الاستقبال الافتراضية</p>
                    <p className="text-xs text-emerald-300">متاحة الآن · تجيبك فورًا</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="إغلاق المحادثة"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-slate-200 transition hover:bg-white/20"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Chat body */}
              <div className="min-h-0 flex-1">
                <ChatInterface clinicId={clinicId} embedded />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* /PANEL */}
    </>
  );
}