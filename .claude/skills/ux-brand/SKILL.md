---
name: ux-brand
description: Brand contract for bl-designer — make sure the project has a linted DESIGN.md (Google design.md format) holding the brand's tokens and rationale, create it from the client's brand kit, logo, site or Instagram when missing, and export it to the Tailwind theme the frontend consumes. Use first in every designer step.
---

# Designer · Brand Contract (DESIGN.md)

Every visual decision comes from one file: `DESIGN.md` at the repo root. It's the brand contract — tokens the code uses exactly, plus the rationale that tells agents how to apply them. Nothing on any screen uses a value that isn't in it.

## 1. Where the brand comes from

Read the **brand source** first. It was decided on the audit call and is in `.baseleap/inputs/client-research.md` under `current_stack` → `brand_source`. Then work down this list and stop at the first match:

| # | You find | You do |
|---|---|---|
| 1 | `DESIGN.md` already in the repo | Use it, and read it every session. You may extend it; you never silently change it. |
| 2 | Brand source **files**: logo, colours or a guide in `.baseleap/inputs/brand/` (the orchestrator runs `stack-ledger client-assets`) | Build `DESIGN.md` from them (§2). The files decide **which** colours and fonts exist; you never add one. Then check how the brand is **already applied** (see "Existing look" below) and match those **roles**. |
| 3 | Brand source **website** only | **Draft pass.** Fetch the site (WebFetch, ≤ 5 pages: home, one service page, contact) and write `DESIGN.md` from what's actually there (§2). Then render one brand board mockup (`design/mockups/SCR-00-brand-board.html`: palette, type scale, buttons, a card, a form field) and return **needs-answers**: "Confirm this palette and type, taken from <site>." Don't design screens until it's confirmed. Scraped palettes often fail contrast; fix that by choosing passing pairings from the same colours, and list each fix in the question. |
| 4 | Brand source **brand_agent** (Marketing's Brand agent is building the kit) and its `DESIGN.md` has arrived | Treat it as #1. |
| 5 | Brand source **brand_agent**, but no `DESIGN.md` yet | Return **needs-answers**: A) wait for the Brand agent (the step stays building); B) start on the placeholder now and swap later. Recommend B when the build's deadline is near. |
| 6 | Brand source **placeholder** (Matthew chose it) | Copy `templates/DESIGN.placeholder.md` to `DESIGN.md` unchanged, and put "**Placeholder brand**" in the Gate 2 summary's first line. Don't polish it or add colours: the real brand replaces it whole. |
| 7 | An internal Baseleap tool | Use the Baseleap contract (`templates/DESIGN.md`), built strictly from BASELEAP Brand Book v2 and Brand Color System v1: dark first, Midnight 60 / Canvas 20 / Volt 10 / Depth 10, Run as the secondary accent, Success / Warning / Error / Info for states only, Garet + Inter. **Never add a colour that isn't in the brand book.** Accessibility comes from choosing passing pairings, not from new shades. |
| 8 | Nothing recorded | Return **needs-answers** with the brand question below. **Never invent a brand.** |

**Existing look (cases 2 and 3).** A brand kit says which colours exist. What the client's customers and staff already see says **how they're used**: which colour is the page background, which one is the main button, where the accent goes. Before you assign roles:
1. Look at what the client already runs. That's the website in the client record, plus any app or portal the research names. Screenshot each with the Playwright MCP at 390 and 1280 px. Page text alone doesn't show the styling.
2. If the client already has a `DESIGN.md` or a theme file in another project they've given us, read its colour roles.
3. Match those roles: page background, surfaces, main action, badges, text. For an **internal tool**, match the client's existing internal tools if there are any, otherwise their website.
4. Only depart from the existing look for a reason the PRD gives (for example, a light background for long reading sessions). Say so as a **DECISION** line in the Gate 2 summary.

Record in `DESIGN.md` which existing screen each role came from.

**The brand question** (#8). Lettered options with your recommendation first, the same format as the PM's discovery questions, written in your report under `## Brand questions`:
- **A.** The client uploads a logo, colours or a brand guide to their Console record (recommended when they have anything at all).
- **B.** Draft from their website: <url from the record, or "which site?">.
- **C.** Marketing's Brand agent builds a brand kit first (the client has nothing).
- **D.** Start on the neutral placeholder now and swap the real brand in later.

A brand-free start (D) is a business decision, so you never choose it yourself.

**Fonts.** Screenshots should show the real typefaces, not a fallback. Mockups load nothing from the network, so the font files have to be local:
- If the brand source includes font files, copy them to `design/fonts/`.
- If the fonts are Google Fonts (most are), get the files from npm, which is allowed: `npm pack @fontsource/<font-name>` in a temp folder, then copy the `.woff2` files you need (normal and bold, Latin) to `design/fonts/`.
- Load them in `design/mockups/fonts.css` with `@font-face` and a relative `url()` (local files aren't network requests), and link it from each mockup.

If you can't get the files, say in the Gate 2 summary which fonts are missing from the screenshots. Font licences: Google Fonts and Fontsource are open-licence (OFL). Don't copy paid fonts the client hasn't supplied.

## 2. Building DESIGN.md from a brand source

Creating a brand from scratch (no client kit)? You may consult a style library for vocabulary and starting points — `ui-ux-pro-max` palettes and font pairings, or `awesome-design-skills` styles (both MIT) — but the result is still written as this client's DESIGN.md and checked against their actual audience. A library style is a starting point, never the answer.

Format: Google's open `design.md` (Apache-2.0) — YAML tokens in front matter, rationale under `##` sections. Same approach as Matthew's `design-md-builder` skill.

1. **Look before deciding.** Read every image (logo, screenshots, brand board) and note what's actually there: colours (hex), type character, spacing density, corner radius philosophy, elevation, mood in 2–3 concrete adjectives.
2. **Tokens in three layers:** primitives (raw palette, type families, scales) → semantic (`surface`, `text`, `text-muted`, `primary`, `on-primary`, `border`, `success`, `warning`, `danger`, `focus`) → components (`button-primary`, `button-primary-hover`, `input`, `card`, …). Components reference semantic tokens with `{colors.primary}`; never raw hex.
3. **Variants are separate entries** (`button-primary-hover`, `button-primary-disabled`) — the format doesn't nest states.
4. **Rationale sections**: Overview (mood, signature element), Colors (what each role is for, the one accent), Typography (hierarchy), Layout & spacing, Shapes, Elevation, Motion, Do / Don't.
5. **Signature:** one distinctive element that makes this client's product recognisable (a shape, a type treatment, a colour use) — not decoration for its own sake.

## 3. Mechanical checks (the step's verify)

- `npx @google/design.md lint DESIGN.md` — zero errors. It checks structure, broken token references and **WCAG AA contrast (4.5:1)** on text/background pairs.
- `node scripts/export-brand.mjs` — one command that writes every derived file: `src/app/theme.css` (the Tailwind v4 `@theme` block the frontend imports; it replaces a `tailwind.config`), `docs/tokens.json` (W3C Design Tokens, for Figma token sync or any tool that wants `tokens.json`) and `design/mockups/tokens.css` (the same tokens as `:root`, because browsers ignore `@theme`). Don't write them with shell redirects (`npx … > file`); each redirect needs its own approval.
- They're regenerated whenever `DESIGN.md` changes and never hand-edited; `check-design` compares them with a fresh export.

## 4. Avoid the generic look

Before locking, apply two tests:
- **Slop test** — could someone say "AI made that" with certainty? Usual culprits: purple-blue gradients, glowing accents, three equal feature cards, default centred dark hero, gradient text, emoji icons.
- **Counterfactual test** — would you produce this same look for any similar brief? If yes, it's a default, not a design. Push it toward the client's actual brand.

Distinctive never overrides the client's real brand or accessibility. When a brand pairing fails contrast, **don't invent a new shade** — use a passing pairing from the same palette (e.g. dark text on the accent instead of white), restrict the colour to icons and borders, and record the rule in DESIGN.md's Do / Don't. Changing the client's palette is the client's decision, raised as an open question.

## 5. Locking

`DESIGN.md` is reviewed at Gate 2 with the rest of the blueprint. After the lock, changes are additive (new component variants), and anything that changes an existing token is a contract question to the orchestrator.

---
Sources (ideas adapted, text written for Baseleap): google-labs-code/design.md (Apache-2.0 — format, linter, Tailwind export), buildgreatproducts/builder-os `design-system` (MIT — observe imagery before deciding, design.md as agent contract), nextlevelbuilder/ui-ux-pro-max-skill `design-system` (MIT — primitive → semantic → component tokens, never raw hex in components), owl-listener/designer-skills `design-token` (MIT). ulpi-io/skills `frontend-design-ui-ux` reviewed for ideas only (no licence — slop and counterfactual tests). Matthew's `design-md-builder` skill.
