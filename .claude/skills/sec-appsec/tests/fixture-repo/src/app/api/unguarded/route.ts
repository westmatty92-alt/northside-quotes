// FIXTURE. Lines marked "expect:" must be flagged with that rule; all others must not.
import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/server/supabase';

export async function GET(req: NextRequest) { // expect: baseleap-route-without-session-guard
  return Response.json({ ok: true, q: req.nextUrl.searchParams.get('q') }, {
    headers: { 'Access-Control-Allow-Origin': '*' }, // expect: baseleap-cors-wildcard
  });
}

export async function POST(req: NextRequest) { // expect: baseleap-route-without-session-guard
  const supabase = createServerClient();
  await supabase.from('bookings').insert(await req.json()); // expect: baseleap-request-body-into-write
  const body = await req.json();
  await supabase.from('bookings').update({ ...body, status: 'pending' }); // expect: baseleap-request-body-into-write
  const { callbackUrl } = await req.json();
  await fetch(callbackUrl, { method: 'POST' }); // expect: baseleap-ssrf-fetch-from-request
  await fetch('https://services.leadconnectorhq.com/contacts/', { method: 'POST' });
  return new Response(null, { status: 204 });
}

export async function PATCH(req: NextRequest) { // expect: baseleap-route-without-session-guard
  const { code } = await req.json();
  return Response.json(eval(code)); // expect: baseleap-eval
}
