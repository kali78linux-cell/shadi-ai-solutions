import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'cta' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
  iconPosition?: 'left' | 'right';
};

const baseStyles =
  'inline-flex items-center justify-center rounded-full font-semibold ' +
  'transition-all duration-300 ease-out focus:outline-none ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'px-5 py-2 text-xs',
  md: 'px-7 py-3 text-sm',
  lg: 'px-8 py-4 text-base',
};

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'text-white bg-gradient-to-r from-cyan-500 to-cyan-600 ' +
    'hover:scale-105 hover:shadow-glow focus:ring-2 focus:ring-cyan-500/40 ' +
    'focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-95',
  secondary:
    'border border-slate-700 text-slate-100 bg-transparent ' +
    'hover:scale-105 hover:border-cyan-500 hover:bg-slate-900/50 ' +
    'focus:ring-2 focus:ring-cyan-500/30 focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-95',
  ghost:
    'text-slate-300 bg-transparent hover:bg-slate-800/60 ' +
    'focus:ring-2 focus:ring-slate-500/40 focus:ring-offset-2 focus:ring-offset-slate-950',
  cta:
    'text-white bg-gradient-to-r from-coral to-coral-deep ' +
    'hover:scale-105 hover:shadow-glow-coral focus:ring-2 focus:ring-coral/40 ' +
    'focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-95 ' +
    'animate-pulse-coral',
  danger:
    'text-white bg-gradient-to-r from-red-500 to-red-600 ' +
    'hover:scale-105 hover:shadow-[0_0_20px_rgba(239,68,68,0.4)] ' +
    'focus:ring-2 focus:ring-red-500/40 focus:ring-offset-2 focus:ring-offset-slate-950 active:scale-95',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  iconPosition = 'left',
  children,
  className,
  disabled,
  onClick,
  ...props
}: ButtonProps) {
  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!loading && !disabled && onClick) {
      // Subtle tap feedback (scale handled by active:scale-95 in CSS)
      onClick(e);
    }
  };

  const iconElement = icon && (
    <span className={`flex items-center ${iconPosition === 'left' && children ? 'mr-2' : ''} ${iconPosition === 'right' && children ? 'ml-2' : ''}`}>
      {icon}
    </span>
  );

  return (
    <button
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className ?? ''}`}
      disabled={loading || disabled}
      onClick={handleClick}
      {...props}
    >
      {loading ? (
        <>
          <span className="spinner mr-2" aria-label="loading" />
          جارٍ المعالجة...
        </>
      ) : (
        <>
          {icon && iconPosition === 'left' && iconElement}
          {children}
          {icon && iconPosition === 'right' && iconElement}
        </>
      )}
    </button>
  );
}
