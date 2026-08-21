'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Link from 'next/link';
import { landingCopy } from '@/lib/landing/landing-copy';
import LandingButton from './LandingButton';

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <motion.header
      initial={{ y: -64, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${
        scrolled
          ? 'border-b border-landing-indigo/10 bg-landing-bg/80 backdrop-blur-md'
          : 'border-b border-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3">
          <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-landing-indigo to-landing-violet shadow-landing-btn">
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-landing-cyan animate-pulse" />
            <span className="text-lg font-black text-white">A</span>
          </span>
          <span className="font-heading text-lg font-extrabold tracking-tight text-landing-text">
            AI-Receptions
          </span>
        </Link>

        {/* Desktop links */}
        <div className="hidden items-center gap-8 lg:flex">
          {landingCopy.nav.links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-landing-text/70 transition hover:text-landing-indigo"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* CTA */}
        <div className="flex items-center gap-3">
          <LandingButton href="#pricing" size="md">
            {landingCopy.nav.cta}
          </LandingButton>
        </div>
      </nav>
    </motion.header>
  );
}