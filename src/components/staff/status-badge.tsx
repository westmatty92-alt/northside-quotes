// StatusBadge (component map): icon plus word plus fill, never colour alone. New is teal, Quoted amber, Won green,
// Lost Fog (DESIGN.md badge-new, badge-quoted, badge-won, badge-lost).
import { statusLabel } from '@/components/staff/copy';
import { Icon, type IconName } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import type { Status } from '@/lib/api/generated/model';
import { cn } from '@/lib/utils';

const looks: Record<Status, { icon: IconName; box: string }> = {
  new: { icon: 'inbox', box: 'bg-primary text-on-primary' },
  quoted: { icon: 'doc', box: 'bg-warning-surface text-warning' },
  won: { icon: 'check-circle', box: 'bg-success-surface text-success' },
  lost: { icon: 'x-circle', box: 'bg-neutral-surface text-text-secondary' },
};

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const look = looks[status];
  return (
    <span className={cn('inline-flex items-center gap-xs rounded-full px-sm py-xs whitespace-nowrap', type.labelSm, look.box, className)}>
      <Icon name={look.icon} className="size-4" />
      {statusLabel[status]}
    </span>
  );
}
