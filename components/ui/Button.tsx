type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
};

export default function Button({ variant = 'primary', loading, children, className, ...props }: ButtonProps) {
  const baseStyles =
    'inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-cyan-500/40 disabled:cursor-not-allowed disabled:opacity-50';

  const variantStyles = {
    primary: 'bg-cyan-500 text-slate-950 hover:bg-cyan-400',
    secondary: 'border border-slate-700 bg-slate-950 text-slate-100 hover:border-cyan-500',
    ghost: 'bg-transparent text-slate-100 hover:bg-slate-900',
  };

  return (
    <button className={`${baseStyles} ${variantStyles[variant]} ${className ?? ''}`} disabled={loading || props.disabled} {...props}>
      {loading ? 'جارٍ المعالجة...' : children}
    </button>
  );
}
