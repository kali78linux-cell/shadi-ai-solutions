'use client';

import { motion } from 'framer-motion';
import { landingCopy } from '@/lib/landing/landing-copy';
import { PainStats } from './Sections';
import { Features } from './Sections';
import { ForDoctors } from './Sections';
import { Gallery } from './Sections';
import { HowItWorks } from './Sections';
import { Imaging } from './Sections';
import { Pricing } from './Sections';
import { ClinicAds } from './Sections';
import { Compare } from './Sections';
import { FAQ } from './Sections';
import LeadForm from './LeadForm';
import Navbar from './Navbar';
import UrgencyBar from './UrgencyBar';
import Hero from './Hero';

export default function LandingPage() {
  return (
    <>
      <Navbar />
      <UrgencyBar />
      <main className="bg-landing-bg text-landing-text">
        <Hero />
        <PainStats />
        <Features />
        <ForDoctors />
        <Gallery />
        <HowItWorks />
        <Imaging />
        <Pricing />
        <ClinicAds />
        <Compare />
        <FAQ />
        <LeadForm />
      </main>

      {/* Footer */}
      <footer className="bg-landing-dark-deep py-12 text-center text-white/70">
        <div className="mx-auto flex flex-col items-center gap-4 px-4 sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 font-heading text-lg font-bold text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-landing-indigo to-landing-violet text-sm font-black">
              A
            </span>
            {landingCopy.brand.name}
          </div>
          <p className="text-sm">{landingCopy.footer.copyright}</p>
        </div>
      </footer>

      {/* Floating action button (FAB) — bottom-left in RTL */}
      <motion.a
        href="/chat"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: 1.2, type: 'spring', stiffness: 260, damping: 20 }}
        className="group fixed bottom-6 left-6 z-50 flex items-center gap-2"
        aria-label={landingCopy.footer.fabTooltip}
      >
        <span className="pointer-events-none hidden translate-x-2 rounded-lg bg-landing-dark px-3 py-1.5 text-xs font-semibold text-white opacity-0 shadow-lg transition-all group-hover:translate-x-0 group-hover:opacity-100 sm:block">
          {landingCopy.footer.fabTooltip}
        </span>
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-landing-indigo to-landing-violet text-white shadow-landing-btn">
          <span className="absolute inset-0 animate-ping rounded-full bg-landing-indigo/40" />
          <span className="relative text-2xl">💬</span>
        </span>
      </motion.a>

      {/* Mobile-only sticky CTA bar */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-landing-indigo/10 bg-landing-bg-white/95 p-3 backdrop-blur-md sm:hidden">
        <a href="#founding" className="block rounded-xl bg-gradient-to-l from-landing-indigo to-landing-violet px-4 py-3 text-center text-sm font-bold text-white">
          احجز مكانك بين أول 100 ←
        </a>
      </div>
    </>
  );
}