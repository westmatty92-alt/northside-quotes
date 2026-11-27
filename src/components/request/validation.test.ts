// The form's own checks, the form token's nonce, and what is kept in sessionStorage.
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { nonceOf } from '@/components/request/form-token';
import { EMPTY_VALUES, phoneDigits, validateValues, type FormValues } from '@/components/request/form-values';
import { addCompletedNonce, parseReceipt, readCompletedNonces } from '@/components/request/session-store';
import { photoFile } from '@/components/request/test-support';
import { sniffPhotoType } from '@/components/request/use-photos';
import { isAlreadyUploaded } from '@/components/request/photo-upload';

const valid: FormValues = {
  ...EMPTY_VALUES,
  name: 'Dana Whitfield',
  phone: '905-555-0142',
  email: 'dana@example.com',
  address: '14 Barton St W, Hamilton ON',
  problem: 'Kitchen tap drips constantly',
  urgency: 'soon',
};

afterEach(() => window.sessionStorage.clear());

describe('validateValues', () => {
  it('accepts a complete form', () => {
    expect(validateValues(valid)).toEqual({});
  });

  it('refuses each empty answer with its own message', () => {
    expect(Object.keys(validateValues(EMPTY_VALUES))).toEqual(['name', 'phone', 'email', 'address', 'problem', 'urgency']);
  });

  it.each([
    ['905-555-0142', true],
    ['(905) 555 0142', true],
    ['+1 905.555.0142', true],
    ['9055550142', true],
    ['12345', false],
    ['905-555-014', false],
    ['call me', false],
  ])('phone %s ok=%s', (phone, ok) => {
    expect('phone' in validateValues({ ...valid, phone })).toBe(!ok);
  });

  it('works out the 10 digits the way the contract says the server does', () => {
    expect(phoneDigits('+1 (905) 555-0142')).toBe('9055550142');
  });

  it('checks the problem length both ways and reports how many were written', () => {
    expect(validateValues({ ...valid, problem: 'Tap leaks' }).problem).toContain('You have written 9.');
    expect(validateValues({ ...valid, problem: 'x'.repeat(10) }).problem).toBeUndefined();
    expect(validateValues({ ...valid, problem: 'x'.repeat(2000) }).problem).toBeUndefined();
    expect(validateValues({ ...valid, problem: 'x'.repeat(2001) }).problem).toContain('You have written 2001.');
  });

  it('trims before checking, so spaces do not count as an answer', () => {
    expect(validateValues({ ...valid, name: '   ' }).name).toBeDefined();
    expect(validateValues({ ...valid, email: '  dana@example.com ' }).email).toBeUndefined();
  });
});

describe('nonceOf', () => {
  it('reads the nonce out of a v1 token', () => {
    expect(nonceOf('v1.1700000000000.6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10.c2ln')).toBe('6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10');
  });
  it('is null for anything else', () => {
    expect(nonceOf('')).toBeNull();
    expect(nonceOf('v1.1.not-a-uuid.sig')).toBeNull();
    expect(nonceOf('v1.1.6f1c2a9e-6c1d-4f0e-9a43-2a1f0c3b9d10')).toBeNull();
  });
});

describe('session store', () => {
  it('remembers completed nonces once each, and survives a damaged value', () => {
    addCompletedNonce('a');
    addCompletedNonce('b');
    addCompletedNonce('a');
    expect(readCompletedNonces()).toEqual(['b', 'a']);
    window.sessionStorage.setItem('nq.completed-form-nonces', '{broken');
    expect(readCompletedNonces()).toEqual([]);
    window.sessionStorage.setItem('nq.completed-form-nonces', JSON.stringify([1, 2]));
    expect(readCompletedNonces()).toEqual([]);
  });

  it('only accepts a well-formed receipt', () => {
    const good = { reference: 'NQ-7K3M9P', firstName: 'Dana', phone: '905-555-0142', address: 'x street', urgency: 'soon', photoCount: 1 };
    expect(parseReceipt(JSON.stringify(good))).toEqual(good);
    expect(parseReceipt(JSON.stringify({ ...good, reference: 'NQ-OOOOOO' }))).toBeNull();
    expect(parseReceipt(JSON.stringify({ ...good, urgency: 'whenever' }))).toBeNull();
    expect(parseReceipt('')).toBeNull();
    expect(parseReceipt('not json')).toBeNull();
  });
});

describe('photo type by first bytes', () => {
  it('knows JPEG, PNG and WebP, and nothing else', async () => {
    expect(await sniffPhotoType(photoFile('a.jpg', 'jpeg'))).toBe('image/jpeg');
    expect(await sniffPhotoType(photoFile('a.png', 'png'))).toBe('image/png');
    expect(await sniffPhotoType(photoFile('a.webp', 'webp'))).toBe('image/webp');
    expect(await sniffPhotoType(photoFile('a.pdf', 'pdf'))).toBeNull();
    expect(await sniffPhotoType(new File(['hello there'], 'notes.jpg', { type: 'image/jpeg' }))).toBeNull();
  });
});

describe('an object that already exists', () => {
  it('counts as uploaded', () => {
    expect(isAlreadyUploaded({ message: 'The resource already exists', statusCode: '409' })).toBe(true);
    expect(isAlreadyUploaded({ message: 'Duplicate' })).toBe(true);
    expect(isAlreadyUploaded({ message: 'x', status: 409 })).toBe(true);
    expect(isAlreadyUploaded({ message: 'new row violates row-level security policy', statusCode: '403' })).toBe(false);
  });
});
