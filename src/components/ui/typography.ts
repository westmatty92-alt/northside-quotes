// The DESIGN.md type styles as class strings, built from src/app/theme.css only.
//
// Why these are spelled out: theme.css names a font family and a font weight with the same key (`--font-h1` and
// `--font-weight-h1`), and Tailwind turns `font-h1` into the FAMILY only (checked in a real build, see the FE1
// report). The weight is reached with the variable form `font-(weight:--font-weight-h1)`, which still points at
// the token. Colour and size keys do not collide: `text-h1` is the size, `text-text-inverse` a colour.
// Line height is not a theme token (DESIGN.md gives it per style; Tailwind's scale is the nearest).
export const type = {
  h1: 'font-h1 font-(weight:--font-weight-h1) text-h1 leading-tight',
  h2: 'font-h2 font-(weight:--font-weight-h2) text-h2 leading-tight',
  /** Semibold labels, button text, banner titles: Source Sans 3 is already the body family, so only the weight. */
  label: 'font-(weight:--font-weight-ui-label) leading-tight',
  /** 15 px semibold with slight tracking: badges, column and section labels. */
  labelSm: 'font-(weight:--font-weight-label-sm) text-label-sm tracking-label-sm leading-tight',
  /** The reference number's tag. */
  ref: 'font-ref font-(weight:--font-weight-ref) text-ref tracking-ref leading-tight',
  /** Regular weight, for words that sit inside a semibold heading. */
  regular: 'font-(weight:--font-weight-body)',
  /** 15 px meta text (hints, times); never used for anything she must read to finish the task. */
  hint: 'text-body-sm leading-normal text-text-secondary',
} as const;
