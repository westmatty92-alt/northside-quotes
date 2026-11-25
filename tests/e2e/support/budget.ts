// Submission budget and the list of test data created on the shared staging project.
//
// The public form accepts 5 submissions per 10 minutes per network address (FR-8, AC-003.4) and the whole
// suite runs from one address. Every test that makes the server accept a request first takes a slot here;
// when the 5 slots of the last 10 minutes are used, it waits until the oldest one has aged out. That wait
// is the rate limit being honoured, not a timing workaround: the test's own timeout is extended by exactly
// the wait, so the rest of the test keeps its normal budget.
import fs from 'node:fs';
import path from 'node:path';
import type { TestInfo } from '@playwright/test';

const CACHE_DIR = path.resolve(__dirname, '../../../playwright/.cache');
const LEDGER = path.join(CACHE_DIR, 'submission-slots.json');
const CREATED = path.resolve(__dirname, '../../../docs/qa-reports/qa-e2e-created.ndjson');

const WINDOW_MS = 10 * 60 * 1000;
const LIMIT = 5;
const MARGIN_MS = 15_000;

function readSlots(): number[] {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

/** Wait for a free slot in the 10 minute window, then use it. Call right before the action that submits. */
export async function takeSubmissionSlot(testInfo: TestInfo): Promise<void> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  for (;;) {
    const now = Date.now();
    const recent = readSlots().filter((t) => now - t < WINDOW_MS + MARGIN_MS);
    if (recent.length < LIMIT) {
      recent.push(now);
      fs.writeFileSync(LEDGER, JSON.stringify(recent));
      return;
    }
    const waitMs = Math.min(...recent) + WINDOW_MS + MARGIN_MS - now;
    testInfo.setTimeout(testInfo.timeout + waitMs + 1_000);
    testInfo.annotations.push({ type: 'rate-limit-wait', description: `waited ${Math.ceil(waitMs / 1000)}s for a submission slot (5 per 10 minutes per address)` });
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

/** Record a request this run created, so the report can list the test data left on staging. */
export function recordCreated(entry: { reference: string; name: string; note: string }): void {
  fs.mkdirSync(path.dirname(CREATED), { recursive: true });
  fs.appendFileSync(CREATED, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export function resetCreatedList(): void {
  fs.mkdirSync(path.dirname(CREATED), { recursive: true });
  fs.writeFileSync(CREATED, '');
}
