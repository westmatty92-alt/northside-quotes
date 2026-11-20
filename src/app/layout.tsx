// Root layout: scaffold-owned (A2, bl-architect). Loads DESIGN.md's two self-hosted fonts and the global stylesheet.
//
// Fonts (docs/architecture.md "Fonts for A2"): Barlow Semi Condensed 600/700 and Source Sans 3 400/600, both SIL OFL,
// read from the @fontsource packages' woff2 files. next/font/local copies them into the build and serves them from our
// own origin, so CSP `font-src 'self'` holds (SECURITY_MODEL invariant 13). Never a font CDN.
// The CSS variables below are read by src/app/globals.css, which points theme.css's --font-* tokens at them.
//
// No `dynamic = 'force-static'`, `revalidate` or "use cache" here: `/` must render per request (S0 SEC-2, SEC-15).
import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const barlowSemiCondensed = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-barlow-semi-condensed',
  display: 'swap',
  preload: true,
  fallback: ['Arial Narrow', 'sans-serif'],
});

const sourceSans3 = localFont({
  src: [
    {
      path: '../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2',
      weight: '600',
      style: 'normal',
    },
  ],
  variable: '--font-source-sans-3',
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: { default: 'Northside quote requests', template: '%s | Northside' },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-CA" className={`${barlowSemiCondensed.variable} ${sourceSans3.variable}`}>
      <body>{children}</body>
    </html>
  );
}
