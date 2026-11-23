// UrgencyChoice (component map): three large radio cards with the full wording, none preselected. Native radios,
// so Tab reaches the group and the arrow keys move inside it; the card shows the choice with a filled dot, a teal
// inset outline and a Fog fill (shape as well as colour). Only the cards are drawn; the radios stay in the page.
import type { UseFormRegisterReturn } from 'react-hook-form';
import { copy } from '@/components/request/copy';
import { FieldError } from '@/components/ui/field';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';
import type { Urgency } from '@/lib/api/generated/model';

const CHOICES = ['emergency', 'soon', 'flexible'] as const satisfies readonly Urgency[];

interface UrgencyChoiceProps {
  field: UseFormRegisterReturn;
  error?: string;
}

export function UrgencyChoice({ field, error }: UrgencyChoiceProps) {
  return (
    <fieldset id="urgency" aria-describedby={error ? 'urgency-err' : undefined} className="grid min-w-0 gap-xs">
      <legend className={cn('mb-xs p-0', type.label)}>{copy.labels.urgency}</legend>
      <div className="grid gap-sm">
        {CHOICES.map((choice) => (
          <label
            key={choice}
            className={cn(
              'group/choice flex min-h-11 cursor-pointer items-start gap-md rounded-md border border-border-strong bg-surface p-md',
              'has-checked:bg-surface-raised has-checked:inset-ring-2 has-checked:inset-ring-primary',
              'has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
              error && 'border-danger',
            )}
          >
            <input type="radio" {...field} value={choice} id={`urgency-${choice}`} className="sr-only" />
            <span
              aria-hidden="true"
              className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border-2 border-border-strong bg-surface group-has-checked/choice:border-primary"
            >
              <span className="size-4.5 rounded-full bg-primary opacity-0 group-has-checked/choice:opacity-100" />
            </span>
            <span>
              <span className={cn('block', type.label)}>{copy.urgency[choice].label}</span>
              <span className="sr-only">: </span>
              <span className={cn('block', type.hint)}>{copy.urgency[choice].description}</span>
            </span>
          </label>
        ))}
      </div>
      {error ? <FieldError id="urgency-err">{error}</FieldError> : null}
    </fieldset>
  );
}
