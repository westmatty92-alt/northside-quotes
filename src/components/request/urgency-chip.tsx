// UrgencyChip (component map): icon plus word. Emergency adds the copper icon and a copper left bar on Paper; copper is
// graphic only here and the word is ink (copper is 3.3:1 on Paper, so never text).
import { copy } from '@/components/request/copy';
import { Icon, type IconName } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import type { Urgency } from '@/lib/api/generated/model';

const looks: Record<Urgency, { icon: IconName; box: string; iconClass: string }> = {
  emergency: { icon: 'alert', box: 'border-border-strong border-l-4 border-l-accent text-text', iconClass: 'text-accent' },
  soon: { icon: 'clock', box: 'border-border-strong text-text', iconClass: '' },
  flexible: { icon: 'calendar', box: 'border-border text-text-secondary', iconClass: '' },
};

export function UrgencyChip({ urgency }: { urgency: Urgency }) {
  const look = looks[urgency];
  return (
    <span
      className={cn(
        'inline-flex items-center gap-xs rounded-sm border bg-surface px-sm py-xs whitespace-nowrap',
        type.labelSm,
        look.box,
      )}
    >
      <Icon name={look.icon} className={cn('size-4', look.iconClass)} />
      {copy.urgency[urgency].label}
    </span>
  );
}
