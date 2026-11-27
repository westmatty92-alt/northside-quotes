// src/lib/server/integrations/ghl/mapping.ts: our request fields -> GHL contact fields, and the tag names.
// Pure functions, no I/O. docs/integration-contract.md "Field mapping".
//
// Nothing here may add a field the contract does not list. Never sent: the offers consent itself, photos,
// problem text, reference number, price, note, urgency, status history (contract "Never sent").

/** The tag every copied contact carries and the app never removes (AC-017.8). */
export const BASE_TAG = 'quote-request' as const;

export const STAGES = ['new', 'quoted', 'won', 'lost'] as const;
export type Stage = (typeof STAGES)[number];

export type StageTag = `quote-${Stage}`;
export const STAGE_TAGS: readonly StageTag[] = STAGES.map((s) => `quote-${s}` as StageTag);

/** The only tags this app is allowed to add (integration contract; SECURITY_MODEL invariant 10). */
export type OwnedTag = typeof BASE_TAG | StageTag;

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && (STAGES as readonly string[]).includes(value);
}

export function stageTag(stage: Stage): StageTag {
  return `quote-${stage}`;
}

/** The other three stage tags: the only tags the app ever removes (AC-017.8). */
export function otherStageTags(stage: Stage): StageTag[] {
  return STAGES.filter((s) => s !== stage).map(stageTag);
}

/** Tags to add for a stage: `quote-request` plus exactly one stage tag. */
export function tagsToAdd(stage: Stage): OwnedTag[] {
  return [BASE_TAG, stageTag(stage)];
}

/** S0 SEC-12: a GHL id is used only when it is URL-safe. The column check uses the same pattern. */
export const CONTACT_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

export function isContactId(value: unknown): value is string {
  return typeof value === 'string' && CONTACT_ID_PATTERN.test(value);
}

/** firstName is the text before the first space, lastName the text after it (omitted for a one-word name). */
export function splitName(name: string): { firstName: string; lastName?: string } {
  const trimmed = name.trim();
  const space = trimmed.indexOf(' ');
  if (space === -1) return { firstName: trimmed };
  const lastName = trimmed.slice(space + 1).trim();
  return lastName === '' ? { firstName: trimmed.slice(0, space) } : { firstName: trimmed.slice(0, space), lastName };
}

/** E.164 for North America: `+1` followed by the 10 stored digits. Null when the value is not 10 digits. */
export function toE164(tenDigits: string): string | null {
  return /^[0-9]{10}$/.test(tenDigits) ? `+1${tenDigits}` : null;
}

/** The request fields the copy reads (a subset of `quote_requests`). */
export type CopySource = {
  name: string;
  phone: string;
  email: string;
  address: string;
};

export type CreateContactBody = {
  locationId: string;
  name: string;
  firstName: string;
  lastName?: string;
  phone: string;
  email: string;
  address1: string;
  tags: OwnedTag[];
};

/** Body of `POST /contacts`: the contract's mapped fields and the tags, nothing else. Null when the phone is unusable. */
export function buildCreateContactBody(locationId: string, source: CopySource, tags: OwnedTag[]): CreateContactBody | null {
  const phone = toE164(source.phone);
  if (phone === null) return null;
  const { firstName, lastName } = splitName(source.name);
  return {
    locationId,
    name: source.name,
    firstName,
    ...(lastName === undefined ? {} : { lastName }),
    phone,
    email: source.email,
    address1: source.address,
    tags,
  };
}
