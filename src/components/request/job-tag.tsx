// JobTag (component map): the reference number is always a tag, the brand signature. Barlow Semi Condensed Bold,
// tracked out, Paper on Harbour Teal with a punched hole; `display` (SCR-02) hangs from the copper pipe elbow,
// which is decorative and hidden from assistive technology; `quiet` (rows and cards) is a Fog tag. The display
// tag spells the characters out for screen readers and is still real, selectable text for everyone else.
import { type } from '@/components/ui/typography';
import { cn } from '@/lib/utils';

interface JobTagProps {
  reference: string;
  variant?: 'display' | 'default' | 'quiet';
}

/** "NQ-7K3M9P" read as "N Q, 7, K, 3, M, 9, P". */
export function spellReference(reference: string): string {
  const [prefix = '', rest = ''] = reference.split('-');
  return `Reference number ${prefix.split('').join(' ')}, ${rest.split('').join(', ')}`;
}

const tag = cn('inline-flex items-center rounded-sm bg-surface-inverse text-text-inverse whitespace-nowrap', type.ref);

export function JobTag({ reference, variant = 'default' }: JobTagProps) {
  if (variant === 'quiet') {
    return <span className={cn(tag, 'bg-surface-raised px-sm py-xs text-text')}>{reference}</span>;
  }

  if (variant === 'default') {
    return (
      <span className={cn(tag, 'gap-sm py-sm pr-md pl-sm')}>
        <span aria-hidden="true" className="size-sm shrink-0 rounded-full bg-surface" />
        {reference}
      </span>
    );
  }

  // display: the size drops to the h1 size on a phone so it never forces sideways scrolling
  return (
    <div className="inline-flex max-w-full items-start pt-lg">
      <span
        aria-hidden="true"
        className="relative z-1 -mt-6 -mr-6 h-17.5 w-16 shrink-0 rounded-bl-4xl border-b-8 border-l-8 border-accent"
      />
      <p
        role="img"
        aria-label={spellReference(reference)}
        className={cn(
          tag,
          'gap-md py-md pr-lg pl-md text-h1 sm:text-ref-display sm:tracking-ref-display',
        )}
      >
        <span aria-hidden="true" className="size-md shrink-0 rounded-full bg-surface" />
        {reference}
      </p>
    </div>
  );
}
