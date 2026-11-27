// OffersCheckbox (component map): the optional offers box on its own Fog strip. A native checkbox (Tab reaches it,
// Space ticks and unticks), 24 px box inside a 44 px-plus strip that is the whole label. It is never ticked when the
// page loads: no `checked` default, `autoComplete="off"` so the browser restores nothing, and the form unticks it
// on mount. Its state is the form's state, so a refused send keeps it exactly as she left it (AC-001.16).
import type { UseFormRegisterReturn } from 'react-hook-form';
import { copy } from '@/components/request/copy';
import { Icon } from '@/components/ui/icon';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export function OffersCheckbox({ field }: { field: UseFormRegisterReturn }) {
  return (
    <label className="flex min-h-11 cursor-pointer items-start gap-md rounded-md bg-surface-raised px-md py-sm has-checked:inset-ring-2 has-checked:inset-ring-primary">
      <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
        <input
          type="checkbox"
          {...field}
          id="offers"
          autoComplete="off"
          className="peer size-6 cursor-pointer appearance-none rounded-sm border-2 border-border-strong bg-surface checked:border-primary checked:bg-primary focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus"
        />
        <Icon
          name="tick"
          strokeWidth={3}
          className="pointer-events-none absolute size-4 text-on-primary opacity-0 peer-checked:opacity-100"
        />
      </span>
      <span className={cn('pt-0.5 leading-snug', type.label)}>{copy.offers}</span>
    </label>
  );
}
