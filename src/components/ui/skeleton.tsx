// Skeleton (component map): a Fog block in the real layout's shape, so nothing jumps when data arrives. The shimmer is
// a still block under `prefers-reduced-motion`. Decorative: the region around it says "Loading ..." for screen readers.
import { cn } from '@/lib/utils';

interface SkeletonProps {
  /** `text` is one line of body text, `block` is a line of heading height, `pill` a rounded badge. */
  size?: 'text' | 'block';
  pill?: boolean;
  className?: string;
}

export function Skeleton({ size = 'text', pill = false, className }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'block bg-neutral-surface motion-safe:animate-pulse',
        size === 'text' ? 'h-md' : 'h-xl',
        pill ? 'rounded-full' : 'rounded-sm',
        className,
      )}
    />
  );
}
