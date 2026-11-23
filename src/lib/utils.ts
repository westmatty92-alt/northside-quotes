// src/lib/utils.ts: the shadcn/ui class-name helper (components.json `aliases.utils`). Frontend lane.
//
// tailwind-merge has to be told the DESIGN.md names that src/app/theme.css adds: without it `text-h1` (a size) and
// `text-text-inverse` (a colour) look like the same kind of class and one silently drops the other.
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['display', 'h1', 'h2', 'h3', 'body-lg', 'body', 'body-sm', 'ui-label', 'label-sm', 'ref', 'ref-display'],
      tracking: ['label-sm', 'ref', 'ref-display'],
      spacing: ['xs', 'sm', 'md', 'lg', 'xl', '2xl'],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
