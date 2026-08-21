'use client';

import { motion } from 'framer-motion';
import type { ReactNode, MouseEventHandler } from 'react';

type Props = {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'white';
  size?: 'md' | 'lg';
  href?: string;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  type?: 'button' | 'submit';
  className?: string;
};

export default function LandingButton({
  children,
  variant = 'primary',
  size = 'md',
  href,
  onClick,
  type = 'button',
  className = '',
}: Props) {
  const base =
    'inline-flex items-center justify-center gap-2 font-heading font-bold rounded-[14px] transition-all duration-300 ' +
    'focus:outline-none focus:ring-2 focus:ring-landing-indigo/40 focus:ring-offset-2 focus:ring-offset-landing-bg ' +
    'active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ';

  const sizes = {
    md: 'px-5 py-3 text-sm',
    lg: 'px-7 py-4 text-base',
  };

  const variants = {
    primary:
      'text-white bg-gradient-to-l from-landing-indigo to-landing-violet shadow-landing-btn hover:-translate-y-[3px] hover:shadow-landing-btn-hover',
    secondary:
      'border-2 border-landing-indigo/30 text-landing-indigo bg-white hover:border-landing-indigo/60 hover:-translate-y-[3px] hover:shadow-landing-btn',
    ghost: 'text-landing-indigo hover:bg-landing-indigo/5',
    white:
      'text-landing-dark bg-white shadow-md hover:-translate-y-[3px] hover:shadow-landing-btn-hover',
  };

  const content = (
    <>
      <motion.span whileHover={{ x: -2 }} className="inline-flex">
        {children}
      </motion.span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
        {content}
      </a>
    );
  }

  return (
    <button type={type} onClick={onClick} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {content}
    </button>
  );
}