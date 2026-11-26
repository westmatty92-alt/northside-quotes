import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MANUAL_EVENTS } from '../scripts/lib/ledger-core.mjs';

test('ledger accepts the manual_task event that stack-hitl §3a asks for', () => {
  assert.ok(MANUAL_EVENTS.includes('manual_task'));
});
