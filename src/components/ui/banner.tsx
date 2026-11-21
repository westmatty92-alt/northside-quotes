// Banner (design-specs component map): icon plus title plus sentence. `role="alert"` for errors, `role="status"`
// for the rest. It can take focus (tabIndex -1) so a failed send can move the reader straight to it.
import type { ReactNode, Ref } from 'react';
import { Icon, type IconName } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

const variants = {
  error: { box: 'bg-danger-surface border-l-danger', icon: 'text-danger', name: 'alert', role: 'alert' },
  warning: { box: 'bg-warning-surface border-l-warning', icon: 'text-warning', name: 'alert', role: 'status' },
  success: { box: 'bg-success-surface border-l-success', icon: 'text-success', name: 'check-circle', role: 'status' },
  info: { box: 'bg-info-surface border-l-primary', icon: 'text-primary', name: 'info', role: 'status' },
} as const satisfies Record<string, { box: string; icon: string; name: IconName; role: 'alert' | 'status' }>;

interface BannerProps {
  variant: keyof typeof variants;
  /** id of the title element, so the banner can be named by it. */
  titleId?: string;
  title: string;
  children?: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function Banner({ variant, titleId, title, children, ref }: BannerProps) {
  const look = variants[variant];
  return (
    <div
      ref={ref}
      role={look.role}
      tabIndex={-1}
      aria-labelledby={titleId}
      className={cn(
        'flex items-start gap-md rounded-md border-l-4 p-md text-text',
        'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus',
        look.box,
      )}
    >
      <Icon name={look.name} className={cn('mt-xs', look.icon)} />
      <div className="grid min-w-0 flex-1 justify-items-start gap-sm">
        <p id={titleId} className={type.label}>
          {title}
        </p>
        {children}
      </div>
    </div>
  );
}
