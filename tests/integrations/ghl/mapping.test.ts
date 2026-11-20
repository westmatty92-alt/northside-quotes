// @vitest-environment node
// Field mapping and tag rules (docs/integration-contract.md "Field mapping"): pure functions.
import { describe, expect, it } from 'vitest';
import {
  BASE_TAG,
  buildCreateContactBody,
  isContactId,
  otherStageTags,
  splitName,
  STAGE_TAGS,
  tagsToAdd,
  toE164,
} from '@/lib/server/integrations/ghl/mapping';

describe('GHL mapping', () => {
  it('splits the name at the first space and omits lastName for a one-word name', () => {
    expect(splitName('Maria Del Rio')).toEqual({ firstName: 'Maria', lastName: 'Del Rio' });
    expect(splitName('Cher')).toEqual({ firstName: 'Cher' });
    expect('lastName' in splitName('Cher')).toBe(false);
    expect(splitName('  Ann   Lee ')).toEqual({ firstName: 'Ann', lastName: 'Lee' });
  });

  it('builds E.164 from exactly 10 digits and nothing else', () => {
    expect(toE164('4165550142')).toBe('+14165550142');
    expect(toE164('416555014')).toBeNull();
    expect(toE164('+14165550142')).toBeNull();
    expect(toE164('416 555 0142')).toBeNull();
  });

  it('one stage tag at a time: the other three are the removal list and quote-request is never in it', () => {
    expect(STAGE_TAGS).toEqual(['quote-new', 'quote-quoted', 'quote-won', 'quote-lost']);
    expect(tagsToAdd('quoted')).toEqual([BASE_TAG, 'quote-quoted']);
    expect(otherStageTags('quoted')).toEqual(['quote-new', 'quote-won', 'quote-lost']);
    for (const stage of ['new', 'quoted', 'won', 'lost'] as const) {
      expect(otherStageTags(stage)).toHaveLength(3);
      expect(otherStageTags(stage)).not.toContain(BASE_TAG);
    }
  });

  it('accepts only URL-safe contact ids (SEC-12)', () => {
    expect(isContactId('abcDEF012_-')).toBe(true);
    expect(isContactId('a'.repeat(100))).toBe(true);
    for (const bad of ['', 'a'.repeat(101), '../x', 'a/b', 'a b', 'a?x=1', 'a#b', 'a%2Fb', 'a\nb', 42, null, undefined]) {
      expect(isContactId(bad)).toBe(false);
    }
  });

  it('the create body carries the mapped fields and tags and nothing else', () => {
    const body = buildCreateContactBody(
      'LOC1',
      { name: 'Maria Del Rio', phone: '4165550142', email: 'Maria@Example.test', address: '1 Main St, Hamilton' },
      tagsToAdd('new'),
    );
    expect(body).toEqual({
      locationId: 'LOC1',
      name: 'Maria Del Rio',
      firstName: 'Maria',
      lastName: 'Del Rio',
      phone: '+14165550142',
      email: 'Maria@Example.test',
      address1: '1 Main St, Hamilton',
      tags: ['quote-request', 'quote-new'],
    });
    expect(buildCreateContactBody('LOC1', { name: 'Maria Del Rio', phone: '123', email: 'm@e.test', address: 'x' }, [])).toBeNull();
  });
});
