// Display formats and the price parser (Hamilton time, Canadian dollars, ten-digit phone, cents without floats), plus the
// allow-list for `next` after sign-in.
import { describe, expect, it } from 'vitest';
import {
  centsToInput,
  formatCents,
  formatLastUpdated,
  formatPhone,
  formatSubmitted,
  formatWeekRange,
  parsePrice,
  telHref,
} from '@/components/staff/format';
import { safeNextPath, sessionEndedHref } from '@/components/staff/next-path';
import { isRequestIdParam } from '@/components/staff/request-id';

describe('dates in Hamilton time', () => {
  it('shows a submitted time like the design: "Nov 19, 9:10 a.m."', () => {
    expect(formatSubmitted('2026-11-19T14:10:00Z')).toBe('Nov 19, 9:10 a.m.');
    expect(formatSubmitted('2026-11-18T21:15:00Z')).toBe('Nov 18, 4:15 p.m.');
  });

  it('follows daylight saving: the same UTC hour is an hour earlier on the clock in summer', () => {
    expect(formatSubmitted('2026-07-01T14:10:00Z')).toBe('Jul 1, 10:10 a.m.');
  });

  it('says "at 2:05 p.m." for today and adds the date for an earlier day', () => {
    const now = new Date('2026-11-19T20:00:00Z');
    expect(formatLastUpdated('2026-11-19T19:05:00Z', now)).toBe('at 2:05 p.m.');
    expect(formatLastUpdated('2026-11-18T19:05:00Z', now)).toBe('on Nov 18 at 2:05 p.m.');
  });

  it('writes the week as Monday to Sunday from the exclusive end', () => {
    expect(formatWeekRange('2026-11-16T05:00:00Z', '2026-11-23T05:00:00Z')).toBe('Mon Nov 16 to Sun Nov 22, Hamilton time');
  });
});

describe('money and phone', () => {
  it('formats integer cents as Canadian dollars and for the price field', () => {
    expect(formatCents(45000)).toBe('$450.00');
    expect(formatCents(1)).toBe('$0.01');
    expect(centsToInput(45000)).toBe('450.00');
    expect(centsToInput(9_999_999)).toBe('99999.99');
    expect(centsToInput(5)).toBe('0.05');
  });

  it('formats a ten-digit phone and links tel:+1', () => {
    expect(formatPhone('9055550142')).toBe('905-555-0142');
    expect(formatPhone('12345')).toBe('12345');
    expect(telHref('9055550142')).toBe('tel:+19055550142');
  });
});

describe('parsePrice', () => {
  it.each([
    ['450', 45000],
    ['450.5', 45050],
    ['450.50', 45050],
    ['0.01', 1],
    ['99,999.99', 9_999_999],
    ['$1,250.00', 125000],
    [' 12 ', 1200],
  ])('%s is %i cents', (typed, cents) => {
    expect(parsePrice(typed)).toEqual({ ok: true, cents });
  });

  it('blank means no price', () => {
    expect(parsePrice('')).toEqual({ ok: true, cents: null });
    expect(parsePrice('   ')).toEqual({ ok: true, cents: null });
  });

  it.each(['0', '0.00', '100000.00', '99999.999', '12.345', '-5', 'abc', '1e3', '12.', '.5', '1,2,3x', '$$5'])('refuses %s', (typed) => {
    expect(parsePrice(typed)).toEqual({ ok: false });
  });

  it('does no floating-point arithmetic: 19.99 is exactly 1999 cents', () => {
    expect(parsePrice('19.99')).toEqual({ ok: true, cents: 1999 });
    expect(parsePrice('1.15')).toEqual({ ok: true, cents: 115 });
  });
});

describe('where sign-in lands', () => {
  const id = '6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10';

  it('follows next only for the two tabs and their detail paths', () => {
    expect(safeNextPath('/requests')).toBe('/requests');
    expect(safeNextPath('/pipeline')).toBe('/pipeline');
    expect(safeNextPath(`/requests/${id}`)).toBe(`/requests/${id}`);
    expect(safeNextPath(`/pipeline/${id}`)).toBe(`/pipeline/${id}`);
  });

  it.each([null, undefined, '', 'https://evil.example', '//evil.example', '/%2F%2Fevil.example', '/requests?x=1', '/requests/', '/inbox', '/requests/mock-1', '/sign-in'])(
    'lands on /requests for %s',
    (next) => {
      expect(safeNextPath(next)).toBe('/requests');
    },
  );

  it('remembers the page she was on when the session ended, and says so', () => {
    expect(sessionEndedHref(`/pipeline/${id}`)).toBe(`/sign-in?next=/pipeline/${id}&session=ended`);
    expect(sessionEndedHref('/requests/mock-1')).toBe('/sign-in?next=/requests&session=ended');
  });

  it('accepts a request id that is one plain path segment', () => {
    expect(isRequestIdParam(id)).toBe(true);
    expect(isRequestIdParam('mock-1')).toBe(true);
    for (const bad of ['', 'a/b', '..', '%2F', 'a b', 'x'.repeat(65), '<script>']) expect(isRequestIdParam(bad)).toBe(false);
  });
});
