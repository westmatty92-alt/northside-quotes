// Staff tests work on requests this suite created earlier in the same run (names start with "QA-E2E"), found
// through the API. Requests cannot be deleted, so the suite reuses them and puts their status back with the API.
import { expect } from '@playwright/test';
import type { Detail, StaffApi, Status } from './api';

export const TAG = 'QA-E2E';

/** Narrow a possibly-missing value with a failure message that says what was expected. */
export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`expected ${what}`);
  return value;
}

/** A tagged request that satisfies `wanted`, or a clear failure saying which earlier test should have created it. */
export async function pick(api: StaffApi, wanted: (d: Detail) => boolean, description: string, exclude: string[] = []): Promise<Detail> {
  const tagged = await api.tagged(TAG);
  for (const item of tagged) {
    if (exclude.includes(item.id)) continue;
    const detail = await api.get(item.id);
    if (wanted(detail)) return detail;
  }
  expect.soft(tagged.length, `no ${TAG} requests exist yet`).toBeGreaterThan(0);
  throw new Error(`No ${TAG} request on staging is ${description}. The submitting tests (spine.phone, submissions.phone) create them; run the phone project first.`);
}

/** Same, then set its status (and clear price and note) so the test starts from a known state. */
export async function pickAt(api: StaffApi, status: Status, wanted: (d: Detail) => boolean, description: string, exclude: string[] = []): Promise<Detail> {
  const found = await pick(api, wanted, description, exclude);
  return api.setStatus(found.id, status);
}

export async function clearQuote(api: StaffApi, id: string): Promise<Detail> {
  const current = await api.get(id);
  if (current.price_cents === null && !current.note) return current;
  const res = await api.saveQuote(id, { price_cents: null, note: null, version: current.version });
  expect(res.status(), 'resetting price and note through the API').toBe(200);
  return api.get(id);
}

/** Two distinct tagged requests (for tests that move one and watch the other stay put). */
export async function pickTwo(api: StaffApi): Promise<[Detail, Detail]> {
  const first = await pick(api, () => true, 'available');
  const second = await pick(api, () => true, 'a second one', [first.id]);
  return [first, second];
}
