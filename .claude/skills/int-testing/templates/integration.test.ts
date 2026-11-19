// tests/integrations/<provider>/webhook.test.ts — TEMPLATE (bl-integration, int-testing)
// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';
import { POST } from '@/app/api/webhooks/<provider>/[tenantKey]/route';
import fixture from './fixtures/webhook-event.json';

const SECRET = 'whsec_' + Buffer.from('test-secret').toString('base64');
beforeAll(() => { process.env.PROVIDER_WEBHOOK_SECRET = SECRET; });

function signed(body: string, { id = `evt_${crypto.randomUUID()}`, ts = Math.floor(Date.now() / 1000), secret = SECRET } = {}) {
  const sig = createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64')).update(`${id}.${ts}.${body}`).digest('base64');
  return new NextRequest('http://localhost/api/webhooks/<provider>/t1', { method: 'POST', body,
    headers: { 'webhook-id': id, 'webhook-timestamp': String(ts), 'webhook-signature': `v1,${sig}` } });
}
const ctx = { params: Promise.resolve({ tenantKey: 't1' }) };

describe('<provider> webhook', () => {
  const body = JSON.stringify(fixture);
  it('accepts a valid signature once; a repeat is acknowledged and not reprocessed', async () => {
    const id = `evt_${crypto.randomUUID()}`;
    expect((await POST(signed(body, { id }), ctx)).status).toBe(200);
    const again = await POST(signed(body, { id }), ctx);
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true });
    // + assert exactly one integration_events row and one jobs row for id (test DB helper)
  });
  it('rejects a tampered body, a wrong secret and a stale timestamp; stores nothing', async () => {
    expect((await POST(signed(body.replace('"', ' "')), ctx)).status).toBe(401);
    expect((await POST(signed(body, { secret: 'whsec_' + Buffer.from('nope').toString('base64') }), ctx)).status).toBe(401);
    expect((await POST(signed(body, { ts: Math.floor(Date.now() / 1000) - 3600 }), ctx)).status).toBe(401);
  });
});
