type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  accent?: boolean;
};

export default function Card({ accent, className, children, ...props }: CardProps) {
  const accentStyles = accent ? 'border-cyan-500/30 bg-slate-900/90 shadow-cyan-500/10' : 'border-slate-800 bg-slate-900/80 shadow-slate-950/20';

  return (
    <div className={`rounded-[2rem] border p-6 ${accentStyles} ${className ?? ''}`} {...props}>
      {children}
    </div>
  );
}
