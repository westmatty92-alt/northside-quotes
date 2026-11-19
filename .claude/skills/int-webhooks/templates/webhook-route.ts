// src/app/api/webhooks/<provider>/route.ts — TEMPLATE (bl-integration, int-webhooks)
import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/server/admin';     // on SECURITY_MODEL's service-role allow-list for webhooks
import { log } from '@/lib/server/log';

const TOLERANCE_S = 300;

/** Standard Webhooks verification (swap for the provider's scheme: Stripe constructEvent, GHL Ed25519, …). */
function verifyStandard(raw: string, id: string, ts: string, header: string, secret: string): boolean {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest();
  return header.split(' ').some((part) => {
    const [ver, sig] = part.split(',');
    if (ver !== 'v1' || !sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantKey: string }> }) {
  const raw = await req.text();                                           // 1. raw body first
  const id = req.headers.get('webhook-id') ?? '';
  const ts = req.headers.get('webhook-timestamp') ?? '';
  const sig = req.headers.get('webhook-signature') ?? '';
  const secret = process.env.PROVIDER_WEBHOOK_SECRET;                     // name only; per-tenant secrets come from Vault
  if (!secret || !id || !ts || !sig || !verifyStandard(raw, id, ts, sig, secret)) {
    return NextResponse.json({ type: 'about:blank', title: 'Invalid signature', status: 401 }, { status: 401 });   // 2.
  }
  if (Math.abs(Date.now() / 1000 - Number(ts)) > TOLERANCE_S) {
    return NextResponse.json({ type: 'about:blank', title: 'Stale timestamp', status: 401 }, { status: 401 });     // 3.
  }
  const event = JSON.parse(raw) as { type?: string };
  const db = createAdminClient();
  const { tenantKey } = await params;
  const { error } = await db.from('integration_events').insert({ provider: '<provider>', provider_event_id: id, tenant_key: tenantKey, type: event.type ?? 'unknown' });
  if (error?.code === '23505') return NextResponse.json({ received: true, duplicate: true });                       // 4. repeat → 200, no work
  if (error) throw error;
  await db.from('jobs').insert({ kind: '<provider>.webhook', ref: id, correlation_id: id });                        // 5. process later
  log.info('webhook.accepted', { provider: '<provider>', correlation_id: id, type: event.type });
  return NextResponse.json({ received: true });
}
