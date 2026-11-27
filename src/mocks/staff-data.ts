// Seed data for the staff screens' mock API: the eight requests of the design mockups (made-up names, example.com
// addresses and 555 numbers), their detail, and the in-memory store the mock handlers read and write, so a price saved
// or a status changed in one screen shows in the next one, as it does against the real API.
import type {
  GhlState,
  Photo,
  QuoteRequestDetail,
  QuoteRequestSummary,
  Status,
  Urgency,
  WeeklyCount,
} from '@/lib/api/generated/model';

/** `/requests/mock-1` and `/requests/mock-2` open the first two requests (the id the contract wants is a uuid). */
export const MOCK_ALIASES: Readonly<Record<string, string>> = {
  'mock-1': 'a0000000-0000-4000-8000-000000000001',
  'mock-2': 'a0000000-0000-4000-8000-000000000002',
};

export const STAFF = { user_id: '3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19', display_name: 'Owner' } as const;

export const WEEK: Pick<WeeklyCount, 'week_start' | 'week_end' | 'time_zone'> = {
  week_start: '2026-11-16T05:00:00Z',
  week_end: '2026-11-23T05:00:00Z',
  time_zone: 'America/Toronto',
};

type CopyFlavour = 'copied' | 'waiting' | 'failed' | 'none';

interface Seed {
  id: string;
  reference: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  problem: string;
  urgency: Urgency;
  status: Status;
  submitted_at: string;
  /** Did the homeowner tick the offers box? `copy` is only meaningful when it is true. */
  ticked: boolean;
  copy: CopyFlavour;
  photos: number;
  price_cents: number | null;
  note: string | null;
}

const uuid = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const SEEDS: readonly Seed[] = [
  {
    id: uuid(1), reference: 'NQ-7K3M9P', name: 'Dana Whitfield', phone: '9055550142', email: 'dana@example.com',
    address: '14 Barton St W, Hamilton ON', problem: 'Kitchen tap drips constantly and the cabinet under it is wet',
    urgency: 'soon', status: 'new', submitted_at: '2026-11-19T14:10:00Z', ticked: true, copy: 'copied', photos: 3, price_cents: null, note: null,
  },
  {
    id: uuid(2), reference: 'NQ-4HX2RB', name: 'Marcus Oyelaran', phone: '9055550178', email: 'marcus.o@example.com',
    address: '212 Concession St, Hamilton ON', problem: 'Water heater is leaking from the bottom and the basement floor is wet',
    urgency: 'emergency', status: 'new', submitted_at: '2026-11-19T13:42:00Z', ticked: false, copy: 'none', photos: 2, price_cents: null, note: null,
  },
  {
    id: uuid(3), reference: 'NQ-9TQ6WD', name: 'Priya Raman', phone: '9055550163', email: 'priya.r@example.com',
    address: '88 Locke St S, Hamilton ON', problem: 'Bathroom fan is loud and the shower drains slowly',
    urgency: 'flexible', status: 'quoted', submitted_at: '2026-11-18T21:15:00Z', ticked: true, copy: 'failed', photos: 1, price_cents: 32000, note: 'Clear the drain, check the fan housing',
  },
  {
    id: uuid(4), reference: 'NQ-3FZ8NC', name: 'Tomasz Kowalski', phone: '9055550117', email: 'tomasz.k@example.com',
    address: '305 Ottawa St N, Hamilton ON', problem: 'Toilet runs all night and the fill valve looks corroded',
    urgency: 'soon', status: 'quoted', submitted_at: '2026-11-17T18:30:00Z', ticked: true, copy: 'waiting', photos: 0, price_cents: 18500, note: null,
  },
  {
    id: uuid(5), reference: 'NQ-6GM2YE', name: 'Aisha Rahman', phone: '9055550129', email: 'aisha.r@example.com',
    address: '41 Wilson St, Hamilton ON', problem: 'Replace the basement sump pump before the spring thaw',
    urgency: 'soon', status: 'won', submitted_at: '2026-11-13T20:50:00Z', ticked: true, copy: 'copied', photos: 2, price_cents: 124000, note: 'Pump and check valve, Tuesday morning',
  },
  {
    id: uuid(6), reference: 'NQ-8VD5SK', name: 'Luc Bergeron', phone: '9055550194', email: 'luc.b@example.com',
    address: '7 Strathcona Ave N, Hamilton ON', problem: 'Quote for moving a laundry hookup to the second floor',
    urgency: 'flexible', status: 'lost', submitted_at: '2026-11-12T15:25:00Z', ticked: false, copy: 'none', photos: 0, price_cents: 890000, note: null,
  },
  {
    id: uuid(7), reference: 'NQ-2CJ7XT', name: 'Greg Hallett', phone: '9055550150', email: 'greg.h@example.com',
    address: '129 Kenilworth Ave N, Hamilton ON', problem: 'Burst pipe under the kitchen sink, water shut off at the main',
    urgency: 'emergency', status: 'won', submitted_at: '2026-11-10T13:05:00Z', ticked: true, copy: 'copied', photos: 1, price_cents: 56000, note: null,
  },
  {
    id: uuid(8), reference: 'NQ-5RW4HN', name: 'Hannah Frey', phone: '9055550108', email: 'hannah.f@example.com',
    address: '60 Bay St S, Hamilton ON', problem: 'Outdoor tap leaks at the base and needs replacing before winter',
    urgency: 'flexible', status: 'lost', submitted_at: '2026-11-10T00:40:00Z', ticked: false, copy: 'none', photos: 0, price_cents: null, note: null,
  },
];

/** A stand-in photo: a plain Fog frame with its number, as an inline image (no network, allowed by the CSP's `data:`). */
export function photoDataUrl(position: number): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="#e6e1d8"/>` +
    `<rect x="40" y="40" width="560" height="400" fill="none" stroke="#737b80" stroke-width="4" stroke-dasharray="16 12"/>` +
    `<text x="320" y="250" font-family="sans-serif" font-size="48" text-anchor="middle" fill="#475057">Photo ${position}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export interface MockStore {
  /** The request detail by id, in submitted order (newest first). */
  details: QuoteRequestDetail[];
  /** The weekly counts; Won and Lost move with a status change of a request that was changed to or from them. */
  counts: { requests: number; won: number; lost: number };
}

function ghlFor(seed: Seed): GhlState {
  if (!seed.ticked) return { copy: { state: 'not_copied_no_consent', at: null }, stage_tag: null };
  const at = seed.submitted_at;
  switch (seed.copy) {
    case 'failed':
      return { copy: { state: 'failed', at }, stage_tag: { state: 'failed', at } };
    case 'waiting':
      return { copy: { state: 'waiting', at }, stage_tag: { state: 'waiting', at } };
    default:
      return { copy: { state: 'copied', at }, stage_tag: { state: 'up_to_date', at } };
  }
}

export function photosFor(count: number, now: Date = new Date()): Photo[] {
  const expires = new Date(now.getTime() + 900_000).toISOString();
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    content_type: 'image/jpeg', // the contract's types only; the stand-in itself is an inline SVG
    url: photoDataUrl(index + 1),
    expires_at: expires,
  }));
}

export function createStore(): MockStore {
  return {
    details: SEEDS.map((seed): QuoteRequestDetail => ({
      id: seed.id,
      reference: seed.reference,
      name: seed.name,
      phone: seed.phone,
      email: seed.email,
      address: seed.address,
      problem: seed.problem,
      urgency: seed.urgency,
      status: seed.status,
      status_changed_at: seed.status === 'new' ? null : seed.submitted_at,
      submitted_at: seed.submitted_at,
      price_cents: seed.price_cents,
      currency: 'CAD',
      note: seed.note,
      photo_count: seed.photos,
      photos: photosFor(seed.photos),
      last_updated: null,
      marketing_consent: seed.ticked,
      marketing_consent_at: seed.ticked ? seed.submitted_at : null,
      ghl: ghlFor(seed),
      version: 1,
    })),
    counts: { requests: 4, won: 1, lost: 1 },
  };
}

export function summaryOf(detail: QuoteRequestDetail): QuoteRequestSummary {
  return {
    id: detail.id,
    reference: detail.reference,
    name: detail.name,
    urgency: detail.urgency,
    status: detail.status,
    submitted_at: detail.submitted_at,
    version: detail.version,
  };
}

/** `mock-1` and `mock-2` stand for the first two seeded ids. */
export function resolveId(id: string): string {
  return MOCK_ALIASES[id] ?? id;
}
