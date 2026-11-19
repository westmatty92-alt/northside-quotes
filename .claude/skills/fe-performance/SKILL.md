---
name: fe-performance
description: Front-end performance for bl-frontend — Core Web Vitals budgets, no request waterfalls, small client bundles through server components and code splitting, optimised images and self-hosted fonts, and render hygiene (no effect loops, stable props). Use while building, and check before reporting any page-level step.
---

# Front-End · Performance

Most of a local business's customers are on phones on mobile data. Performance is a feature on every conversion path.

## 1. Budgets (checked on the lane preview)

| Metric | Budget (mobile, 75th percentile target) |
|---|---|
| Largest Contentful Paint | ≤ 2.5 s |
| Interaction to Next Paint | ≤ 200 ms |
| Cumulative Layout Shift | ≤ 0.1 |
| First-load JS per route | ≤ 170 kB gzipped (report the number from `next build`) |

A page over budget isn't done — say what's heavy and what you did about it.

## 2. Data without waterfalls

- Start independent requests in parallel (server: `Promise.all`; client: sibling queries, not nested components that each fetch after the parent renders).
- Prefetch on intent where the design shows a likely next step (hover/focus on a list item → prefetch its detail).
- Never fetch in `useEffect`; never chain a fetch that only needs data you already have.

## 3. Small client bundles

- Server Components by default keeps code off the client; `"use client"` on leaves only.
- Dynamic-import heavy, below-the-fold or rarely used pieces (charts, editors, date pickers in dialogs).
- Import specific modules, not whole libraries; no new dependency without checking its size — and no new paid or licensed dependency at all without the orchestrator (spend gate).

## 4. Images & fonts

- `next/image` with explicit dimensions (or `fill` with a sized parent) — prevents layout shift; `priority` only on the LCP image.
- Fonts via `next/font/local` (Garet is self-hosted) and `next/font/google` (Inter) with `display: swap`; only the weights DESIGN.md uses.
- Reserve space for anything that loads late (skeletons in the real layout shape).

## 5. Render hygiene

- Effect dependencies are primitives; effects clean up what they start.
- Don't pass freshly created objects or callbacks to memoised children; memoise only when a measured re-render is a problem, not by default.
- Long lists (> ~100 rows) are paginated by the contract; virtualise only if a design genuinely needs a long scrolling list.

---
Sources (ideas adapted, text written for Baseleap): leejpsd/typescript-react-nextjs-patterns `performance-and-accessibility`, `playbooks/effect-dependency-bugs` (MIT), mindrally/skills (Apache-2.0). vercel-labs/agent-skills `react-best-practices` reviewed for ideas only (no licence file — waterfalls, bundle size). Core Web Vitals thresholds: Google's published "good" thresholds.
