// @vitest-environment jsdom
// The mock layer: scenario names, the flag, and that the mock API answers the way the contract says.
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { apiMockingEnabled } from '@/mocks/flag';
import { buildHandlers } from '@/mocks/handlers';
import { previewFor } from '@/mocks/previews';
import { readScenario, SCENARIOS } from '@/mocks/scenarios';
import {
  CreateQuoteRequestResponse,
  SubmitQuoteRequestResponse,
} from '@/lib/api/generated/public-form/public-form.zod';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  vi.unstubAllEnvs();
});
afterAll(() => server.close());

const ORIGIN = 'http://localhost';
const answers = {
  name: 'Dana Whitfield',
  phone: '905-555-0142',
  email: 'dana@example.com',
  address: '14 Barton St W, Hamilton ON',
  problem: 'Kitchen tap drips constantly',
  urgency: 'soon',
  marketing_consent: false,
  website: '',
  photos: [{ position: 1, content_type: 'image/jpeg', size_bytes: 1000 }],
};

const post = (path: string, body?: unknown, token: string | null = 'tok') =>
  fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Form-Token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('scenarios', () => {
  it('reads ?mockScenario= and falls back to ok', () => {
    expect(readScenario('?mockScenario=send-failed')).toBe('send-failed');
    expect(readScenario('?mockScenario=nonsense')).toBe('ok');
    expect(readScenario('')).toBe('ok');
    expect(readScenario('?other=1&mockScenario=errors')).toBe('errors');
  });

  it('every scenario has a seed or is blank; only the ones that press Send on load carry files and values', () => {
    for (const scenario of SCENARIOS) {
      const preview = previewFor(scenario);
      if (preview) expect(preview.autoSend).toBe(true);
    }
    expect(previewFor('ok')).toBeUndefined();
  });

  it('the sent scenario stores a receipt for SCR-02', () => {
    window.sessionStorage.clear();
    previewFor('sent');
    expect(JSON.parse(window.sessionStorage.getItem('nq.receipt') ?? '{}')).toMatchObject({ reference: 'NQ-7K3M9P' });
  });
});

describe('the flag', () => {
  it('is on only for the exact value "on"', () => {
    vi.stubEnv('NEXT_PUBLIC_API_MOCKING', 'on');
    expect(apiMockingEnabled()).toBe(true);
    for (const value of ['off', 'ON', 'true', '1', '']) {
      vi.stubEnv('NEXT_PUBLIC_API_MOCKING', value);
      expect(apiMockingEnabled()).toBe(false);
    }
    vi.unstubAllEnvs();
    expect(apiMockingEnabled()).toBe(false);
  });
});

describe('mock API (contract statuses and bodies)', () => {
  it('create answers 201 with the upload targets; submit answers the reference; Storage takes the photo', async () => {
    server.use(...buildHandlers('ok'));
    const created = await post('/api/quote-requests', answers);
    expect(created.status).toBe(201);
    const started = CreateQuoteRequestResponse.parse(await created.json());
    expect(started.photo_uploads).toEqual([
      expect.objectContaining({ position: 1, bucket: 'quote-photos', path: `${started.request_id}/photo-1` }),
    ]);

    const stored = await fetch(`${ORIGIN}/storage/v1/object/quote-photos/${started.photo_uploads[0]?.path}`, { method: 'POST', body: 'x' });
    expect(stored.status).toBe(200);

    const submitted = await post(`/api/quote-requests/${started.request_id}/submission`);
    expect(submitted.status).toBe(200);
    expect(SubmitQuoteRequestResponse.parse(await submitted.json())).toMatchObject({ reference: 'NQ-7K3M9P', photo_count: 1 });
  });

  it('refuses a missing token (401), a filled honeypot (400, the generic body) and bad answers (422 per field)', async () => {
    server.use(...buildHandlers('ok'));
    expect((await post('/api/quote-requests', answers, null)).status).toBe(401);
    const honeypot = await post('/api/quote-requests', { ...answers, website: 'http://spam.example' });
    expect(honeypot.status).toBe(400);
    expect(await honeypot.json()).toMatchObject({ code: 'submission_refused', title: "We couldn't send your request. Please try again." });
    const bad = await post('/api/quote-requests', { ...answers, email: 'nope' });
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ code: 'validation_failed', errors: [expect.objectContaining({ field: 'email' })] });
  });

  it.each([
    ['send-failed', 503, 'service_unavailable'],
    ['rate-limited', 429, 'rate_limited'],
  ] as const)('%s answers %i problem+json %s', async (scenario, status, code) => {
    server.use(...buildHandlers(scenario));
    const response = await post('/api/quote-requests', answers);
    expect(response.status).toBe(status);
    expect(response.headers.get('Content-Type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code, status });
  });

  it('form-expired refuses the first create and accepts the next', async () => {
    server.use(...buildHandlers('form-expired'));
    expect(await (await post('/api/quote-requests', answers)).json()).toMatchObject({ code: 'form_expired' });
    expect((await post('/api/quote-requests', answers)).status).toBe(201);
  });

  it('upload-failed refuses only the second photo', async () => {
    server.use(...buildHandlers('upload-failed'));
    const base = `${ORIGIN}/storage/v1/object/quote-photos/6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10`;
    expect((await fetch(`${base}/photo-1`, { method: 'POST', body: 'x' })).status).toBe(200);
    expect((await fetch(`${base}/photo-2`, { method: 'POST', body: 'x' })).status).toBe(500);
  });
});
