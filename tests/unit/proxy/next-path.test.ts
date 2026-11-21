// @vitest-environment node
// SECURITY_MODEL invariant 22 and AC-004.3, AC-004.14: where sign-in goes. Offline.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LANDING, NEXT_ALLOW_LIST, isStaffPagePath, safeNextPath, signInAddress } from '@/lib/server/auth/next-path';

const ID = '3d6f0a52-8b1e-4c7a-9f20-6e5d4c3b2a19';

describe('safeNextPath: the allow-list is exactly invariant 22', () => {
  it('is the regular expression the security model prints', () => {
    expect(NEXT_ALLOW_LIST.source).toBe('^\\/(requests|pipeline)(\\/[0-9a-f-]{36})?$');
  });

  it.each(['/requests', '/pipeline', `/requests/${ID}`, `/pipeline/${ID}`])('follows %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    ['an absolute URL', 'https://evil.example'],
    ['an absolute URL to a staff path', 'https://evil.example/requests'],
    ['a protocol-relative URL', '//evil.example'],
    ['encoded slashes', '/%2F%2Fevil.example'],
    ['three slashes', '///evil.example'],
    ['a backslash host', '/\\evil.example'],
    ['a script URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,hi'],
    ['a query string on an allowed path', '/requests?x=1'],
    ['a fragment on an allowed path', '/requests#x'],
    ['a trailing slash', '/requests/'],
    ['a parent path', '/requests/../admin'],
    ['an id that is not 36 characters', '/requests/abc'],
    ['an upper-case id', `/requests/${ID.toUpperCase()}`],
    ['a path below a detail path', `/requests/${ID}/edit`],
    ['another staff-looking path', '/inbox'],
    ['the sign-in page itself', '/sign-in'],
    ['the home page', '/'],
    ['a line break (header injection)', '/requests\r\nSet-Cookie: a=b'],
    ['a trailing line break', '/requests\n'],
    ['an empty string', ''],
    ['spaces', ' /requests'],
  ])('lands on /requests for %s', (_name, value) => {
    expect(safeNextPath(value)).toBe(DEFAULT_LANDING);
    expect(DEFAULT_LANDING).toBe('/requests');
  });

  it('lands on /requests when there is no next at all', () => {
    expect(safeNextPath(null)).toBe('/requests');
    expect(safeNextPath(undefined)).toBe('/requests');
  });
});

describe('isStaffPagePath', () => {
  it.each(['/requests', '/pipeline', `/requests/${ID}`, `/pipeline/${ID}`, '/requests/anything/below'])('guards %s', (path) => {
    expect(isStaffPagePath(path)).toBe(true);
  });
  it.each(['/', '/sign-in', '/request-sent', '/requestsfoo', '/pipelines', '/api/health', '/inbox'])('does not guard %s', (path) => {
    expect(isStaffPagePath(path)).toBe(false);
  });
});

describe('signInAddress', () => {
  it('keeps the path readable', () => {
    expect(signInAddress('/pipeline')).toBe('/sign-in?next=/pipeline');
    expect(signInAddress(`/requests/${ID}`)).toBe(`/sign-in?next=/requests/${ID}`);
  });
  it('encodes anything that could end the value early', () => {
    expect(signInAddress('/requests/a&b=c#d?e')).toBe('/sign-in?next=/requests/a%26b%3Dc%23d%3Fe');
  });
});
