'use client';

import { motion, useInView } from 'framer-motion';
import { useRef, type ReactNode } from 'react';

/**
 * Shared Framer Motion helpers for the landing page.
 * - FadeUp: fade + slide-up on scroll into view.
 * - Stagger: container that staggers its FadeUp/motion children.
 */

type FadeUpProps = {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
};

export function FadeUp({ children, delay = 0, y = 28, className }: FadeUpProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });

  return (
    <motion.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

type StaggerProps = {
  children: ReactNode;
  className?: string;
  delayChildren?: number;
  stagger?: number;
};

export function Stagger({ children, className, delayChildren = 0.05, stagger = 0.08 }: StaggerProps) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      variants={{
        hidden: {},
        visible: { transition: { delayChildren, staggerChildren: stagger } },
      }}
    >
      {children}
    </motion.div>
  );
}

export const staggerItem = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const } },
};