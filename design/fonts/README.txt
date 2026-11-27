Brand fonts for the Northside mockups (open licence, SIL OFL 1.1).

No font files are copied into this folder. design/mockups/fonts.css points its @font-face rules at the @fontsource packages that `npm ci` installs:
  ../../node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2
  ../../node_modules/@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2
  ../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-400-normal.woff2
  ../../node_modules/@fontsource/source-sans-3/files/source-sans-3-latin-600-normal.woff2

Mockups need `npm ci` to render with the brand fonts. Without node_modules the screenshots fall back to system fonts.
The app self-hosts the same files through next/font/local (see docs/architecture.md), so the mockups and the build show the same typefaces.
Nothing is fetched from the network.
