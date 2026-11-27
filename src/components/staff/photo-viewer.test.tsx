// @vitest-environment jsdom
// SCR-06's thumbnails and SCR-08, the viewer: plain <img> on signed URLs (SEC-16), the loading, unavailable and "Try again"
// states, no wrap-around, the keys, focus on Close and back on the thumbnail, and fresh URLs when it opens, when one is
// near expiry and when one fails. The browser's own <dialog> behaviour (Escape, the focus trap) is checked in a real
// browser by the lane preview run; jsdom stands in for showModal() and close() only.
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PhotoGallery, refreshDelay } from '@/components/staff/photo-gallery';
import { expectLabelsContainVisibleText, expectNoAxeViolations, installDialogStandIn, renderStaff } from '@/components/staff/test-support';
import type { Photo } from '@/lib/api/generated/model';

vi.mock('next/navigation', () => ({ usePathname: () => '/requests/x', useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/components/staff/navigation', () => ({ navigateTo: vi.fn() }));

const server = setupServer();
let photoCalls = 0;
let tokenNumber = 1;
let hold: Promise<void> | undefined;
let releaseHold: () => void = () => undefined;

beforeAll(() => {
  installDialogStandIn();
  server.listen({ onUnhandledFrame: 'error' });
});
beforeEach(() => {
  photoCalls = 0;
  tokenNumber = 1;
  hold = undefined;
  server.use(
    http.get('*/api/quote-requests/:id/photos', async () => {
      photoCalls += 1;
      tokenNumber += 1;
      const issued = tokenNumber;
      await hold;
      return HttpResponse.json({ data: photos(3, issued) });
    }),
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.useRealTimers();
});
afterAll(() => server.close());

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function photos(count: number, token = 1, expires = inMinutes(15)): Photo[] {
  return Array.from({ length: count }, (_, index) => ({
    position: index + 1,
    content_type: 'image/jpeg' as const,
    url: `https://project-ref.supabase.co/storage/v1/object/sign/quote-photos/req/photo-${index + 1}?token=t${token}`,
    expires_at: expires,
  }));
}

function gallery(list: Photo[]) {
  return renderStaff(<PhotoGallery requestId="req" reference="NQ-7K3M9P" name="Dana Whitfield" photos={list} />);
}

const thumb = (n: number) => screen.getByRole('button', { name: `View photo ${n} of 3 at full size` });
const dialog = () => screen.getByRole('dialog');
const viewerImage = () => within(dialog()).queryByRole('img') as HTMLImageElement | null;

describe('SCR-06 photo thumbnails', () => {
  it('are plain <img> elements on the signed URL: never next/image (SEC-16)', () => {
    gallery(photos(3));
    const images = Array.from(document.querySelectorAll('img'));
    expect(images).toHaveLength(3);
    for (const [index, image] of images.entries()) {
      expect(image.getAttribute('src')).toBe(`https://project-ref.supabase.co/storage/v1/object/sign/quote-photos/req/photo-${index + 1}?token=t1`);
      expect(image.getAttribute('src')).not.toContain('/_next/image');
      expect(image.hasAttribute('srcset')).toBe(false);
      expect(image).toHaveAttribute('alt', '');
    }
  });

  // BUG-QA1-5, ledger ruling 2026-11-24: the tile shows "View photo N" and the name is "View photo N of 3 at full size"
  it('are named "View photo N of 3 at full size" and show "View photo N" on the tile; the name contains the visible words (WCAG 2.5.3)', async () => {
    const { container } = gallery(photos(3));
    expect(thumb(2)).toHaveTextContent('View photo 2');
    await expectLabelsContainVisibleText(container);
    expect(screen.getByRole('heading', { name: /Photos/ })).toHaveTextContent('Photos (3)');
    await expectNoAxeViolations(container);
  });

  // DV1 F-05: at 390 px the tile read "View photo" over "1"; the label must stay on one line
  it('keep the "View photo N" label on one line', () => {
    gallery(photos(3));
    for (const n of [1, 2, 3]) {
      const label = within(thumb(n)).getByText(`View photo ${n}`);
      expect(label).toHaveClass('whitespace-nowrap');
    }
  });

  // BUG-QA1-3 (AC-005.7, SCR-06 Error): the API answers with URLs, the browser cannot fetch the images.
  it('Storage unreachable: every slot whose image fails says "Photo unavailable", the rest of the request still shows, and fresh URLs are asked for once', async () => {
    const { container } = gallery(photos(3));
    for (const image of Array.from(document.querySelectorAll('img'))) fireEvent.error(image);
    expect(await screen.findAllByText('Photo unavailable')).toHaveLength(3);
    expect(screen.queryAllByRole('button', { name: /View photo/ })).toHaveLength(0);
    expect(screen.getByRole('heading', { name: /Photos/ })).toBeInTheDocument();
    expect(screen.getByText(/The rest of the request is still shown/)).toBeInTheDocument();
    await expectNoAxeViolations(container);

    // the fresh URLs it asked for are tried, and fail too: still "Photo unavailable", and no new request (no loop)
    await waitFor(() => expect(photoCalls).toBe(1));
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(3));
    for (const image of Array.from(document.querySelectorAll('img'))) fireEvent.error(image);
    expect(await screen.findAllByText('Photo unavailable')).toHaveLength(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(photoCalls).toBe(1);
  });

  it('one photo that fails does not take the others with it, and it comes back when a fresh URL loads', async () => {
    gallery(photos(3));
    fireEvent.error(document.querySelectorAll('img')[1] as HTMLImageElement);
    expect(await screen.findAllByText('Photo unavailable')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /View photo/ })).toHaveLength(2);
    await waitFor(() => expect(document.querySelectorAll('img')).toHaveLength(3)); // the fresh URL replaced the failed one
    expect(screen.queryByText('Photo unavailable')).toBeNull();
  });

  it('a photo whose URL could not be signed says "Photo unavailable" and cannot be opened', () => {
    gallery([...photos(2), { position: 3, content_type: 'image/jpeg', url: null, expires_at: null }]);
    expect(screen.getAllByRole('button', { name: /View photo/ })).toHaveLength(2);
    expect(screen.getByText('Photo unavailable')).toBeInTheDocument();
  });
});

describe('SCR-08 Photo viewer', () => {
  it('opens as a dialog titled "Photo 1 of 3" with the reference and name, the photo as a plain <img>, and focus on Close', async () => {
    const { container } = gallery(photos(3));
    fireEvent.click(thumb(1));
    const box = dialog();
    expect(box).toHaveAccessibleName('Photo 1 of 3');
    expect(within(box).getByText('NQ-7K3M9P, Dana Whitfield')).toBeInTheDocument();
    expect(document.activeElement).toBe(within(box).getByRole('button', { name: 'Close' }));
    expect(viewerImage()).toHaveAttribute('alt', 'Photo 1 of 3 for NQ-7K3M9P');
    expect(viewerImage()?.getAttribute('src')).toContain('/photo-1?token=');
    expect(viewerImage()?.getAttribute('src')).not.toContain('/_next/image');
    await waitFor(() => expect(photoCalls).toBe(1)); // it asks for fresh URLs when it opens (AC-012.3)
    await expectNoAxeViolations(container);
  });

  it('Loading: the frame says "Loading photo" until the image arrives, and Previous and Next work meanwhile', () => {
    gallery(photos(3));
    fireEvent.click(thumb(2));
    expect(within(dialog()).getByRole('status')).toHaveTextContent('Loading photo');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Next photo' }));
    expect(dialog()).toHaveAccessibleName('Photo 3 of 3');
    fireEvent.load(viewerImage() as HTMLImageElement);
    expect(within(dialog()).queryByText('Loading photo')).toBeNull();
  });

  it('moves with the two buttons and with Left and Right; Previous is paused on the first and Next on the last (no wrap-around)', () => {
    gallery(photos(3));
    fireEvent.click(thumb(1));
    const previous = within(dialog()).getByRole('button', { name: 'Previous photo' });
    const next = within(dialog()).getByRole('button', { name: 'Next photo' });
    expect(previous).toHaveAttribute('aria-disabled', 'true');
    expect(next).not.toHaveAttribute('aria-disabled');
    fireEvent.click(previous);
    expect(dialog()).toHaveAccessibleName('Photo 1 of 3');
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
    expect(dialog()).toHaveAccessibleName('Photo 1 of 3');

    fireEvent.click(next);
    expect(dialog()).toHaveAccessibleName('Photo 2 of 3');
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(dialog()).toHaveAccessibleName('Photo 3 of 3');
    expect(next).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(next);
    fireEvent.keyDown(dialog(), { key: 'ArrowRight' });
    expect(dialog()).toHaveAccessibleName('Photo 3 of 3');
    expect(viewerImage()?.getAttribute('src')).toContain('/photo-3?token=');
    fireEvent.keyDown(dialog(), { key: 'ArrowLeft' });
    expect(dialog()).toHaveAccessibleName('Photo 2 of 3');
  });

  it('the title is a polite live region, so every move is announced', () => {
    gallery(photos(3));
    fireEvent.click(thumb(1));
    expect(screen.getByRole('heading', { name: 'Photo 1 of 3' })).toHaveAttribute('aria-live', 'polite');
  });

  it('Error: "Photo unavailable", "The request itself is fine.", and Try again asks for fresh URLs', async () => {
    const { container } = gallery(photos(3));
    fireEvent.click(thumb(1));
    await waitFor(() => expect(photoCalls).toBe(1));

    hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    fireEvent.error(viewerImage() as HTMLImageElement);
    const failure = await screen.findByRole('alert');
    expect(failure).toHaveTextContent('Photo unavailable');
    expect(failure).toHaveTextContent('The photo could not be loaded. The request itself is fine.');
    await expectNoAxeViolations(container);
    // a URL that failed may simply have expired: fresh ones were asked for by themselves, and they replace it
    await waitFor(() => expect(photoCalls).toBe(2));
    releaseHold();
    await waitFor(() => expect(viewerImage()?.getAttribute('src')).toContain('?token=t3'));
    expect(screen.queryByRole('alert')).toBeNull();

    // still failing: "Try again" asks once more
    hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    fireEvent.error(viewerImage() as HTMLImageElement);
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(photoCalls).toBe(4));
    releaseHold();
    await waitFor(() => expect(viewerImage()?.getAttribute('src')).toContain('?token=t5'));
  });

  it('a photo with no URL opens straight to "Photo unavailable", and the others still work', () => {
    gallery([photos(3)[0] as Photo, { position: 2, content_type: 'image/jpeg', url: null, expires_at: null }, photos(3)[2] as Photo]);
    fireEvent.click(screen.getAllByRole('button', { name: /View photo/ })[0] as HTMLElement);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Next photo' }));
    expect(within(dialog()).getByRole('alert')).toHaveTextContent('Photo unavailable');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Next photo' }));
    expect(dialog()).toHaveAccessibleName('Photo 3 of 3');
    expect(viewerImage()).not.toBeNull();
  });

  // BUG-QA1-4 (SCR-08 Keyboard path): a native modal <dialog> keeps the page behind inert, but its Tab order ends at the
  // browser's own controls, so past the last button focus leaves the page (document.activeElement is the body). The trap
  // has to be the viewer's own. jsdom has no Tab key, so `pressTab` plays both halves: the keydown the page sees and, when
  // the page does not stop it, the browser's move inside the open dialog (past the last control: out of the page).
  function pressTab(shift = false) {
    const active = document.activeElement as HTMLElement;
    const browserMoves = fireEvent.keyDown(active, { key: 'Tab', shiftKey: shift });
    if (!browserMoves) return;
    const order = Array.from(dialog().querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')).filter(
      (element) => !element.hasAttribute('disabled') && element.getAttribute('tabindex') !== '-1',
    );
    const next = order[order.indexOf(active) + (shift ? -1 : 1)];
    if (next) next.focus();
    else active.blur(); // to the browser's own controls: the page's activeElement becomes the body
  }
  const focusedName = () => (document.activeElement as HTMLElement).getAttribute('aria-label') ?? document.activeElement?.textContent?.trim();

  it('Tab keeps focus inside the dialog and cycles Close, Previous photo, Next photo, Close (SCR-08)', () => {
    gallery(photos(3));
    fireEvent.click(thumb(2));
    expect(focusedName()).toBe('Close');
    const trail: Array<string | undefined> = [];
    for (let press = 1; press <= 8; press++) {
      pressTab();
      expect(dialog().contains(document.activeElement), `Tab ${press} left the dialog: focus trail ${trail.join(' > ')} > ${focusedName()}`).toBe(true);
      trail.push(focusedName());
    }
    expect(trail.slice(0, 4)).toEqual(['Previous photo', 'Next photo', 'Close', 'Previous photo']);
  });

  it('Shift+Tab from Close goes to the last control, and back, never out of the dialog', () => {
    gallery(photos(3));
    fireEvent.click(thumb(2));
    pressTab(true);
    expect(focusedName()).toBe('Next photo');
    pressTab(true);
    expect(focusedName()).toBe('Previous photo');
    pressTab(true);
    expect(focusedName()).toBe('Close');
    pressTab(true);
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it('the trap still holds on the last photo, where Next is paused but stays in the Tab order', () => {
    gallery(photos(3));
    fireEvent.click(thumb(3));
    for (let press = 1; press <= 6; press++) {
      pressTab();
      expect(dialog().contains(document.activeElement), `Tab ${press} left the dialog`).toBe(true);
    }
  });

  it('Escape closes the viewer and puts focus back on the thumbnail that opened it', async () => {
    gallery(photos(3));
    const opener = thumb(2);
    opener.focus();
    fireEvent.click(opener);
    pressTab();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('Close closes the dialog and puts focus back on the thumbnail that opened it', async () => {
    gallery(photos(3));
    const opener = thumb(2);
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('the page behind does not scroll while it is open, and scrolls again after', () => {
    gallery(photos(3));
    fireEvent.click(thumb(1));
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(document.documentElement.style.overflow).toBe('');
  });
});

describe('keeping signed URLs working (AC-012.3)', () => {
  it('waits until 60 seconds before the earliest expiry, never under 5 seconds, and not at all when nothing expires', () => {
    const now = 1_000_000;
    expect(refreshDelay(now + 15 * 60_000, now)).toBe(14 * 60_000);
    expect(refreshDelay(now + 62_000, now)).toBe(5_000);
    expect(refreshDelay(now + 10_000, now)).toBe(5_000);
    expect(refreshDelay(now - 1, now)).toBe(5_000);
    expect(refreshDelay(Infinity, now)).toBeNull();
  });

  it('a set of URLs close to expiry is refreshed by itself, and the new URLs replace the old ones', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    gallery(photos(3, 1, inMinutes(1.1)));
    expect(photoCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(5_500);
    await waitFor(() => expect(photoCalls).toBe(1));
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toContain('?token=t2'));
  });

  it('a thumbnail that fails to load asks for fresh URLs (once for the same set)', async () => {
    gallery(photos(3));
    const [first, second] = Array.from(document.querySelectorAll('img'));
    fireEvent.error(first as HTMLImageElement);
    fireEvent.error(second as HTMLImageElement);
    await waitFor(() => expect(photoCalls).toBe(1));
    await waitFor(() => expect(document.querySelector('img')?.getAttribute('src')).toContain('?token=t2'));
    expect(photoCalls).toBe(1);
  });
});
