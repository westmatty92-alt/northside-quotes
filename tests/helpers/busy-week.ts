// tests/helpers/busy-week.ts: a concurrent writer for the current week, standing in for the other files, QA runs and lanes
// that write to the shared staging database at the same time (REV-4). It keeps inserting submitted requests into the current
// week and moving them between won and lost, so the week's three numbers change every few hundred milliseconds while a test
// reads them. Every row goes through inboxTools.seed, so it carries the file's tag and afterAll deletes it.
import { expect } from 'vitest';
import type { InboxTools } from './inbox';
import type { Staging } from './staging';

export type WeekWriter = {
  /** Writes so far (inserts plus status moves). */
  writes: () => number;
  /** Stop and wait for the write in flight; returns the number of writes. */
  stop: () => Promise<number>;
};

export function startWeekWriter(staging: Staging, ib: InboxTools, pauseMs = 100): WeekWriter {
  let running = true;
  let writes = 0;
  const ids: string[] = [];
  const loop = (async () => {
    while (running) {
      const now = new Date().toISOString();
      const status = writes % 3 === 0 ? 'new' : writes % 3 === 1 ? 'won' : 'lost';
      ids.push((await ib.seed({ label: `busy-${writes}`, status, statusChangedAt: status === 'new' ? null : now })).id);
      writes += 1;
      const earlier = ids[Math.max(0, ids.length - 2)];
      if (earlier && running) {
        const { error } = await staging
          .db()
          .from('quote_requests')
          .update({ status: writes % 2 === 0 ? 'won' : 'lost', status_changed_at: new Date().toISOString() })
          .eq('id', earlier);
        expect(error).toBeNull();
        writes += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    }
  })();
  return {
    writes: () => writes,
    stop: async () => {
      running = false;
      await loop;
      return writes;
    },
  };
}
