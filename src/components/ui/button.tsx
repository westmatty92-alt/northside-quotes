// Button (design-specs component map): primary (teal, hover Steel Ink, 48 px), secondary (Paper with an ink-faint
// border, 44 px), and a paused look for busy or unavailable (Paper with a dashed border, so it still shows on a Fog
// card). A paused button keeps `aria-disabled` instead of `disabled`, so it keeps keyboard focus and a press does
// nothing: callers ignore the click while `paused`.
import type { ComponentProps, ReactNode } from 'react';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export const focusRing =
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

const base = cn(
  'inline-flex items-center justify-center gap-sm rounded-md border px-md text-ui-label whitespace-nowrap no-underline',
  type.label,
);

// The designed height belongs to the variant, not to its look, so a paused button keeps it (DV1 F-01): before, the
// paused look replaced the whole variant and every busy button shrank to its text, about 23 px.
const minHeight = {
  primary: 'min-h-12',
  secondary: 'min-h-11',
} as const;

const looks = {
  primary: 'border-transparent bg-primary text-on-primary hover:bg-primary-hover cursor-pointer',
  secondary: 'border-border-strong bg-surface text-text hover:bg-surface-raised cursor-pointer',
} as const satisfies Record<keyof typeof minHeight, string>;

// border, colour and cursor only: never a size
const pausedLook =
  'border-dashed border-border-strong bg-surface text-text-secondary hover:bg-surface cursor-not-allowed';

export type ButtonVariant = keyof typeof looks;

interface ButtonProps extends Omit<ComponentProps<'button'>, 'disabled'> {
  variant?: ButtonVariant;
  /** Busy or unavailable: looks paused, announces `aria-disabled`, keeps focus. */
  paused?: boolean;
  block?: boolean;
  children: ReactNode;
}

export function Button({
  variant = 'secondary',
  paused = false,
  block = false,
  className,
  onClick,
  type = 'button',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-disabled={paused || undefined}
      onClick={(event) => {
        if (paused) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      className={cn(base, focusRing, minHeight[variant], paused ? pausedLook : looks[variant], block && 'w-full', className)}
    >
      {children}
    </button>
  );
}

/** A link that looks like the secondary button ("Send another request"). */
export const linkButtonClass = cn(base, focusRing, minHeight.secondary, looks.secondary);
