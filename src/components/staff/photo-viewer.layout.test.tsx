// SCR-08 layout in a real browser (BUG-FE2V-1): the photo frame must fit the height the viewport has left after the
// title, the reference line, Close and the Previous / Next row, so nothing is drawn on top of anything else. jsdom has
// no layout, so this test renders the viewer's real markup, styles it with the app's real Tailwind build
// (src/app/globals.css) and measures it in Chromium (Playwright, already a dev dependency) at the four windows QA and the
// designer named: 1280 x 800, 1280 x 720, 390 x 844 and 390 x 640, plus a few harder ones.
//
// The browser here is Chromium from Playwright's own cache. A machine without it (CI's offline job installs no
// browsers) skips this file and says so; QA's tests/e2e/visual run is the staging-side proof.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type Page } from '@playwright/test';
import postcss from 'postcss';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PhotoViewer } from '@/components/staff/photo-viewer';
import type { Photo } from '@/lib/api/generated/model';

const root = process.cwd();
const hasChromium = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
if (!hasChromium) console.warn('photo-viewer.layout.test: Playwright Chromium is not installed here; the SCR-08 layout test is skipped.');

// A landscape and a portrait stand-in photo, so object-contain is exercised both ways.
const svg = (width: number, height: number) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="gray"/></svg>`)}`;

const photoList = (urls: (string | null)[]): Photo[] =>
  urls.map((url, index) => ({
    position: index + 1,
    content_type: 'image/jpeg' as const,
    url,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  }));

const noop = () => undefined;

function viewerMarkup(photos: Photo[], index: number) {
  return renderToStaticMarkup(
    <PhotoViewer reference="NQ-7K3M9P" name="Dana Whitfield" photos={photos} index={index} onIndexChange={noop} onClose={noop} onRefresh={noop} />,
  );
}

interface Box {
  name: string;
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
  /** the element (or a child of it) is what the browser hits at its own centre */
  onTop: boolean;
}

interface Layout {
  frame: Box;
  controls: Box[];
  dialogScrolls: boolean;
}

async function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const dialogElement = document.querySelector('dialog');
    if (!dialogElement) throw new Error('no dialog');
    const box = (name: string, element: Element | null) => {
      if (!element) throw new Error(`missing ${name}`);
      const rect = element.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return {
        name,
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
        onTop: hit !== null && (hit === element || element.contains(hit)),
      };
    };
    const buttons = Array.from(dialogElement.querySelectorAll('button'));
    const button = (label: string) => buttons.find((candidate) => candidate.textContent?.trim() === label) ?? null;
    return {
      frame: box('frame', dialogElement.querySelector('[data-photo-frame]')),
      controls: [
        box('title', dialogElement.querySelector('#viewer-title')),
        box('reference line', dialogElement.querySelector('#viewer-title + p')),
        box('Close', button('Close')),
        box('Previous photo', button('Previous photo')),
        box('Next photo', button('Next photo')),
      ],
      dialogScrolls: dialogElement.scrollHeight > dialogElement.clientHeight + 1,
    };
  });
}

const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

const windows = [
  { width: 1280, height: 800 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
  { width: 390, height: 640 },
  // harder ones: a short laptop window with browser toolbars, a very wide short one, a phone on its side, a narrow tall one
  { width: 1280, height: 600 },
  { width: 1920, height: 500 },
  { width: 844, height: 390 },
  { width: 320, height: 568 },
];

describe.skipIf(!hasChromium)('SCR-08 photo viewer layout in Chromium (BUG-FE2V-1)', () => {
  let browser: Browser;
  let css = '';

  beforeAll(async () => {
    const from = path.join(root, 'src/app/globals.css');
    const result = await postcss([tailwind({ base: root })]).process(readFileSync(from, 'utf8'), { from });
    css = result.css;
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function open(width: number, height: number, markup: string) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.setContent(`<!doctype html><html lang="en-CA"><head><style>${css}</style></head><body><main><p>Request page behind</p></main>${markup}</body></html>`);
    // the component opens itself with showModal() in an effect; static markup needs the same call here
    await page.evaluate(() => document.querySelector('dialog')?.showModal());
    return page;
  }

  const cases = [
    { state: 'a landscape photo, Previous and Next both live', photos: () => photoList([svg(4032, 3024), svg(4032, 3024), svg(4032, 3024)]), index: 1 },
    { state: 'a portrait photo, first of three (Previous paused)', photos: () => photoList([svg(3024, 4032), svg(4032, 3024), svg(4032, 3024)]), index: 0 },
    { state: 'Photo unavailable with Try again', photos: () => photoList([svg(4032, 3024), null, svg(4032, 3024)]), index: 1 },
  ];

  for (const { width, height } of windows) {
    for (const { state, photos, index } of cases) {
      it(`${width} x ${height}, ${state}: the frame overlaps no control, everything is on screen, nothing scrolls`, async () => {
        const page = await open(width, height, viewerMarkup(photos(), index));
        try {
          if (state.startsWith('a ')) {
            // let the stand-in image load, so the loaded state is measured too
            await page.evaluate(() => {
              const image = document.querySelector('dialog img');
              if (image instanceof HTMLImageElement) image.classList.remove('invisible');
            });
          }
          const layout = await measure(page);
          const problems: string[] = [];
          const describeBox = (b: Box) => `${b.name} ${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;
          for (const control of layout.controls) {
            if (overlaps(layout.frame, control)) problems.push(`frame (${describeBox(layout.frame)}) overlaps ${describeBox(control)}`);
            if (!control.onTop) problems.push(`${control.name} is covered at its centre`);
            if (control.top < 0 || control.left < 0 || control.bottom > height + 0.5 || control.right > width + 0.5) problems.push(`${describeBox(control)} is off screen`);
          }
          if (layout.frame.top < 0 || layout.frame.bottom > height + 0.5 || layout.frame.right > width + 0.5) problems.push(`${describeBox(layout.frame)} is off screen`);
          if (layout.dialogScrolls) problems.push('the dialog scrolls');
          expect(problems).toEqual([]);

          // the frame still uses the space: never collapsed, and never wider than the 960 px design maximum
          expect(layout.frame.width).toBeGreaterThan(200);
          expect(layout.frame.height).toBeGreaterThan(150);
          expect(layout.frame.width).toBeLessThanOrEqual(960.5);
          // a photo keeps the designed 4:3 frame (the unavailable panel may grow taller for its words)
          if (state.startsWith('a ')) expect(Math.abs(layout.frame.width / layout.frame.height - 4 / 3)).toBeLessThan(0.02);
          // the controls keep their touch size
          for (const name of ['Close', 'Previous photo', 'Next photo']) {
            const control = layout.controls.find((candidate) => candidate.name === name);
            expect(control?.height, `${name} height`).toBeGreaterThanOrEqual(44);
          }
        } finally {
          await page.close();
        }
      }, 30_000);
    }
  }
});
