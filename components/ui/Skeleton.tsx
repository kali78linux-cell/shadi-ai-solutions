type SkeletonProps = {
  className?: string;
};

export default function Skeleton({ className }: SkeletonProps) {
  return <div className={`animate-pulse rounded-3xl bg-slate-800/70 ${className ?? ''}`} />;
}
