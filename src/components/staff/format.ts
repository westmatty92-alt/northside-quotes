// Display formats for the staff screens (design-specs "Copy"): Hamilton time in 12-hour form ("Nov 19, 9:10 a.m."),
// money as Canadian dollars ("$450.00 CAD"), a ten-digit phone as 905-555-0142. The API sends UTC ISO strings and
// integer cents; this file only formats them, it never computes a business rule from them.
const ZONE = 'America/Toronto';
const LOCALE = 'en-CA';

const dateTime = new Intl.DateTimeFormat(LOCALE, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: ZONE,
});
const timeOnly = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: ZONE });
const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: ZONE });
const dayParts = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', month: 'short', day: 'numeric', timeZone: ZONE });
const monthDay = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric', timeZone: ZONE });

/** "Nov 19, 9:10 a.m." in Hamilton time. */
export function formatSubmitted(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** "2:05 p.m." in Hamilton time. */
export function formatClock(iso: string): string {
  return timeOnly.format(new Date(iso));
}

/** Today's time only ("at 2:05 p.m."), an earlier day with its date ("on Nov 19 at 2:05 p.m."). */
export function formatLastUpdated(iso: string, now: Date = new Date()): string {
  const when = new Date(iso);
  if (dayKey.format(when) === dayKey.format(now)) return `at ${timeOnly.format(when)}`;
  return `on ${monthDay.format(when)} at ${timeOnly.format(when)}`;
}

function dayLabel(date: Date): string {
  const parts = dayParts.formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('weekday')} ${pick('month')} ${pick('day')}`;
}

/** "Mon Nov 16 to Sun Nov 22, Hamilton time": `weekEnd` is exclusive, so the last day is a moment before it. */
export function formatWeekRange(weekStart: string, weekEnd: string): string {
  const last = new Date(new Date(weekEnd).getTime() - 1);
  return `${dayLabel(new Date(weekStart))} to ${dayLabel(last)}, Hamilton time`;
}

/** The Hamilton calendar date of an instant, for the `datetime` attribute: "2026-11-19". */
export function isoDay(iso: string): string {
  return dayKey.format(new Date(iso));
}

const money = new Intl.NumberFormat(LOCALE, { style: 'currency', currency: 'CAD' });

/** 45000 -> "$450.00" (integer cents in, display out). */
export function formatCents(cents: number): string {
  return money.format(cents / 100);
}

/** 45000 -> "450.00": the number shown inside the price field. Integer arithmetic only. */
export function centsToInput(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** "9055550142" -> "905-555-0142". Anything that is not ten digits is shown as it came. */
export function formatPhone(digits: string): string {
  const match = /^(\d{3})(\d{3})(\d{4})$/.exec(digits);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : digits;
}

export function telHref(digits: string): string {
  return `tel:+1${digits}`;
}

const PRICE_MIN_CENTS = 1;
const PRICE_MAX_CENTS = 9_999_999;

export type PriceParse = { ok: true; cents: number | null } | { ok: false };

/**
 * The typed amount to integer cents (docs/openapi.yaml saveQuote: "The client converts the typed amount to cents and
 * refuses more than 2 decimals before sending"). Blank is "no price" (null). A leading "$", spaces and thousands
 * commas are allowed; more than two decimals, letters, a minus sign or a value outside 0.01 to 99,999.99 are refused.
 * No floating point: the digits are split and joined as integers.
 */
export function parsePrice(typed: string): PriceParse {
  const cleaned = typed.trim().replace(/^\$/, '').replace(/\s/g, '').replace(/,/g, '');
  if (cleaned === '') return { ok: true, cents: null };
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { ok: false };
  const dollars = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = dollars * 100 + Number(fraction);
  if (cents < PRICE_MIN_CENTS || cents > PRICE_MAX_CENTS) return { ok: false };
  return { ok: true, cents };
}
