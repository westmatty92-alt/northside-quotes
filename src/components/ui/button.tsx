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

const looks = {
  primary:
    'min-h-12 border-transparent bg-primary text-on-primary hover:bg-primary-hover cursor-pointer',
  secondary:
    'min-h-11 border-border-strong bg-surface text-text hover:bg-surface-raised cursor-pointer',
} as const;

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
      className={cn(base, focusRing, paused ? pausedLook : looks[variant], block && 'w-full', className)}
    >
      {children}
    </button>
  );
}

/** A link that looks like the secondary button ("Send another request"). */
export const linkButtonClass = cn(base, focusRing, looks.secondary);
