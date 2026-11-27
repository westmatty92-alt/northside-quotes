// Two icons the board needs that the shared icon family (src/components/ui/icon.tsx) does not have yet: the drag grip
// and the "moving" arrows. Drawn the same way (24 px grid, 2 px outline, round caps) so they sit with the rest. Always
// decorative: the words next to them carry the meaning. Kept here because src/components/ui/ is not this step's to edit.
import { cn } from '@/lib/utils';

interface PipelineIconProps {
  className?: string;
}

const common = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/** Six dots: "this card can be dragged". */
export function GripIcon({ className }: PipelineIconProps) {
  return (
    <svg {...common} className={cn('size-6 shrink-0', className)}>
      <path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" />
    </svg>
  );
}

/** Arrows in four directions: "being dragged". */
export function MoveIcon({ className }: PipelineIconProps) {
  return (
    <svg {...common} className={cn('size-6 shrink-0', className)}>
      <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
    </svg>
  );
}
