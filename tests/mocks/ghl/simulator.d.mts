// Types for tests/mocks/ghl/simulator.mjs (tests import the simulator in-process).

export const SIM_DEFAULT_TOKEN: string;
export const SIM_DEFAULT_LOCATION: string;

export type SimMode =
  | 'ok'
  | 'slow'
  | 'lost_reply'
  | '429'
  | '500'
  | 'revoked'
  | 'forbidden'
  | 'badrequest'
  | 'notfound'
  | 'unprocessable'
  | 'drift';

export type SimCall = {
  method: string;
  /** The raw path as sent, percent-encoding included. */
  path: string;
  query: Record<string, string>;
  body: unknown;
  /** Whether the Authorization header was the right Bearer token (the token itself is never recorded). */
  authorized: boolean;
  version: string | null;
  accept: string | null;
  mode: string;
};

export type SimContact = {
  id: string;
  locationId: string;
  name: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  tags: string[];
};

export type SimContactSeed = {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  tags?: string[];
};

export type GhlSimulator = {
  url: string;
  token: string;
  locationId: string;
  calls(): SimCall[];
  callsTo(method: string, pathPrefix: string): SimCall[];
  contacts(): SimContact[];
  reset(): void;
  setMode(mode: SimMode): void;
  /** One mode per upcoming call, in order; after the queue is empty the standing mode applies. */
  queueModes(modes: SimMode[]): void;
  configure(settings: { allowDuplicateContact?: boolean; searchLag?: boolean }): void;
  flushSearchIndex(): void;
  seedContact(fields: SimContactSeed): string;
  close(): Promise<void>;
};

export function startGhlSimulator(options?: {
  port?: number;
  token?: string;
  locationId?: string;
  mode?: SimMode;
  slowMs?: number;
  /** Prefix of generated contact ids (default `simcontact`). Ids are never reused, not even after reset(). */
  idPrefix?: string;
}): Promise<GhlSimulator>;
