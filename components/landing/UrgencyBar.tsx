'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { landingCopy, FOUNDING_SLOTS_TOTAL } from '@/lib/landing/landing-copy';
import LandingButton from './LandingButton';

/**
 * Sticky urgency bar showing how many founding places remain.
 * The number is fetched live from /api/landing/founding-slots which reads
 * 100 - COUNT(*) WHERE is_founding_member=true. Falls back to the total
 * if the migration is not applied yet.
 */
export default function UrgencyBar() {
  const [remaining, setRemaining] = useState<number>(FOUNDING_SLOTS_TOTAL);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/landing/founding-slots');
        const data = await res.json();
        if (!cancelled && typeof data.remaining === 'number') {
          setRemaining(data.remaining);
        }
      } catch {
        // keep fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <motion.div
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="sticky top-[72px] z-40 border-b border-landing-amber/20 bg-landing-amber/10 backdrop-blur-md"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-3 px-4 py-3 text-center sm:flex-row sm:justify-between sm:px-6 sm:text-right lg:px-8">
        <p className="text-sm font-semibold text-landing-text sm:text-base">
          ⚡ {landingCopy.urgencyBar.text}{' '}
          <span className="font-mono font-bold text-landing-indigo">{remaining}</span>{' '}
          {landingCopy.urgencyBar.suffix}
        </p>
        <LandingButton href="#pricing" size="md" className="whitespace-nowrap">
          {landingCopy.urgencyBar.cta}
        </LandingButton>
      </div>
    </motion.div>
  );
}