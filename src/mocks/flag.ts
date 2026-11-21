// NEXT_PUBLIC_API_MOCKING: `on` runs the screens against the mock handlers in this folder; anything else (unset,
// `off`, a typo) is off. Next.js writes NEXT_PUBLIC_* values into the bundle at build time, so this is read with a
// literal `process.env.NEXT_PUBLIC_API_MOCKING` access. Mock code is only ever imported behind this flag, so with
// mocking off none of it is downloaded or run.
import { z } from 'zod';

const flag = z.enum(['on', 'off']).catch('off');

export function apiMockingEnabled(): boolean {
  return flag.parse(process.env.NEXT_PUBLIC_API_MOCKING) === 'on';
}
