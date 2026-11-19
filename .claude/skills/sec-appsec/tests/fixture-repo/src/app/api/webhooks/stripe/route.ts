// FIXTURE. Webhooks verify signatures instead of sessions: nothing here may be flagged.
import { NextRequest } from 'next/server';
import { verifyStripeEvent } from '@/lib/server/integrations/stripe';

export async function POST(req: NextRequest) {
  const event = await verifyStripeEvent(await req.text(), req.headers.get('stripe-signature'));
  return Response.json({ received: event.id });
}
