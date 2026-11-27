// Wordmark: the client's supplied northside-wordmark.svg, drawn inline so it uses the page fonts (Barlow Semi
// Condensed and Source Sans 3 are self-hosted by the root layout, so it never falls back to a system font).
// Paper text on teal, the pipe stays copper, 44 px high, never recoloured. Its accessible name is the business
// name. The font sizes, tracking and coordinates are the logo's own drawing units, not page tokens.
export function Wordmark() {
  return (
    <svg
      viewBox="0 0 260 64"
      role="img"
      aria-label="Northside Plumbing, Hamilton"
      className="block h-11 w-auto overflow-visible"
    >
      <path d="M10 54 V30 a14 14 0 0 1 14 -14 H44" fill="none" strokeWidth={9} strokeLinecap="round" className="stroke-accent" />
      <rect x="40" y="9" width="10" height="14" rx="2" className="fill-accent" />
      <rect x="5" y="50" width="10" height="10" rx="2" className="fill-accent" />
      {/* One <text> with a space between its two lines (each tspan keeps its own position), so the words it shows read as
          "NORTHSIDE PLUMBING · HAMILTON" to a checker that joins text nodes, not "NORTHSIDEPLUMBING": WCAG 2.5.3 Label in
          Name for the staff header link that wraps this logo (BUG-QA1-2). The drawing does not change. */}
      <text>
        <tspan
          x="62"
          y="36"
          fontSize="30"
          letterSpacing="1.5"
          className="fill-text-inverse font-h1 font-(weight:--font-weight-h1)"
        >
          NORTHSIDE
        </tspan>{' '}
        <tspan
          x="63"
          y="55"
          fontSize="12.5"
          letterSpacing="3"
          className="fill-text-inverse font-ui-label font-(weight:--font-weight-ui-label)"
        >
          PLUMBING · HAMILTON
        </tspan>
      </text>
    </svg>
  );
}
