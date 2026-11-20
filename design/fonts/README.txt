Self-hosted fonts for the Northside mockups (open licence, SIL OFL 1.1). Loaded by design/mockups/fonts.css. Nothing is fetched from the network.

STATUS: the four files below are NOT here yet. The design session could not run `npm pack` (it needs approval), so the screenshots were drawn with fallback fonts.
To add them, from the repo root:
  npm pack @fontsource/barlow-semi-condensed @fontsource/source-sans-3 --pack-destination design/fonts
then copy these Latin woff2 files out of the unpacked packages' files/ folders into this folder, and re-run node scripts/render-mockups.mjs:
  barlow-semi-condensed-latin-600-normal.woff2
  barlow-semi-condensed-latin-700-normal.woff2
  source-sans-3-latin-400-normal.woff2
  source-sans-3-latin-600-normal.woff2
