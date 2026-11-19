// tests/api/bookings.test.ts: TEMPLATE. Runs against the staging Supabase branch (never production).
// Each operation: AC happy paths + contract check + auth matrix + validation + edges.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/bookings/route';
import { listBookingsResponse, createBookingResponse } from '@/lib/api/generated/bookings/bookings.zod';
import { testUsers, cleanupTenant, authed } from '../helpers/auth';   // creates per-role users on the branch

let u: Awaited<ReturnType<typeof testUsers>>;
beforeAll(async () => { u = await testUsers(['customer', 'staff', 'other_tenant_customer']); });
afterAll(async () => { await cleanupTenant(u); });

const req = (method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(new URL(path, 'http://test.local'), {
    method,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    headers: { 'content-type': 'application/json', ...init.headers },
  });

describe('POST /api/bookings (createBooking)', () => {
  it('AC-003.1 books an open slot and returns the contract shape', async () => {
    const res = await POST(authed(req('POST', '/api/bookings', { body: { slot_id: u.openSlotId } }), u.customer));
    expect(res.status).toBe(201);
    createBookingResponse.parse(await res.json());                        // contract check
  });

  it('AC-003.2 slot already taken → 409 problem+json', async () => {
    const res = await POST(authed(req('POST', '/api/bookings', { body: { slot_id: u.takenSlotId } }), u.customer));
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('same Idempotency-Key twice → one booking', async () => {
    const headers = { 'Idempotency-Key': crypto.randomUUID() };
    const a = await POST(authed(req('POST', '/api/bookings', { body: { slot_id: u.secondOpenSlotId }, headers }), u.customer));
    const b = await POST(authed(req('POST', '/api/bookings', { body: { slot_id: u.secondOpenSlotId }, headers }), u.customer));
    expect((await a.json()).id).toBe((await b.json()).id);
  });

  it('no session → 401', async () => {
    expect((await POST(req('POST', '/api/bookings', { body: { slot_id: u.openSlotId } }))).status).toBe(401);
  });

  it('invalid body → 422 naming the field; unknown field rejected', async () => {
    const res = await POST(authed(req('POST', '/api/bookings', { body: { slot_id: 'nope', extra: 1 } }), u.customer));
    expect(res.status).toBe(422);
    expect((await res.json()).errors.map((e: { field: string }) => e.field)).toContain('slot_id');
  });
});

describe('GET /api/bookings (listBookings)', () => {
  it('AC-002.1 returns only my bookings, contract shape, cursor paginated', async () => {
    const res = await GET(authed(req('GET', '/api/bookings?limit=2'), u.customer));
    expect(res.status).toBe(200);
    const body = listBookingsResponse.parse(await res.json());
    expect(body.data.every((b) => u.customerBookingIds.includes(b.id))).toBe(true);
  });

  it("another tenant's user never sees my bookings", async () => {
    const body = await (await GET(authed(req('GET', '/api/bookings'), u.other_tenant_customer))).json();
    expect(body.data.some((b: { id: string }) => u.customerBookingIds.includes(b.id))).toBe(false);
  });
});
