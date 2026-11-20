// src/lib/utils.ts: the shadcn/ui class-name helper (components.json `aliases.utils`). Frontend lane.
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
