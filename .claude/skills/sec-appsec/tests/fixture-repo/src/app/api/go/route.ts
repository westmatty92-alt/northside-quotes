// FIXTURE. Lines marked "expect:" must be flagged with that rule; all others must not.
import { NextRequest, NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/server/auth';

export async function GET(req: NextRequest) {
  await requireSession(req);
  return NextResponse.redirect(req.nextUrl.searchParams.get('next')!); // expect: baseleap-open-redirect
}

export async function PUT(req: NextRequest) {
  await requireSession(req);
  const next = req.nextUrl.searchParams.get('next') ?? '/';
  redirect(next); // expect: baseleap-open-redirect
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  redirect('/bookings');
}

export async function DELETE(req: NextRequest) {
  const session = await requireSession(req);
  return Response.json({ id: session.userId });
}
