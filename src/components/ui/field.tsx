// Field, Input, Textarea and the field error (design-specs component map): the label sits above and is always
// visible; the error sits under the field with an icon, is announced (`role="alert"`) and is tied to the field with
// `aria-describedby` and `aria-invalid`. An error field gets the red tint and a 2 px red border.
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Icon } from '@/components/ui/icon';
import { focusRing } from '@/components/ui/button';
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

export interface FieldAria {
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
}

interface FieldProps {
  id: string;
  /** Words, or words plus a lighter "(optional)" (SCR-06's price and note). */
  label: ReactNode;
  hint?: string;
  error?: string;
  children: (aria: FieldAria) => ReactNode;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
  const showHint = Boolean(hint) && !error;
  const describedBy = [error ? `${id}-err` : null, showHint ? `${id}-hint` : null].filter(Boolean).join(' ');
  return (
    <div className="grid gap-xs">
      <label htmlFor={id} className={type.label}>
        {label}
      </label>
      {children({ 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy || undefined })}
      {showHint ? (
        <p id={`${id}-hint`} className={type.hint}>
          {hint}
        </p>
      ) : null}
      {error ? <FieldError id={`${id}-err`}>{error}</FieldError> : null}
    </div>
  );
}

export function FieldError({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <p id={id} role="alert" className={cn('flex items-start gap-sm leading-snug text-text', className)}>
      <Icon name="alert" className="mt-xs size-4 text-danger" />
      <span>{children}</span>
    </p>
  );
}

const control = cn(
  'w-full rounded-md border border-border-strong bg-surface px-3 text-body text-text',
  'aria-invalid:border-2 aria-invalid:border-danger aria-invalid:bg-danger-surface',
  focusRing,
);

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(control, 'min-h-12', className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(control, 'min-h-36 py-3 leading-relaxed', className)} />;
}
