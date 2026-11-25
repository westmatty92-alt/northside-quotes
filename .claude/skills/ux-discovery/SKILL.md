---
name: ux-discovery
description: Design discovery for bl-designer — before any mockup, ask the questions a top app designer asks to understand the client's vision (users, context, feel, references, density, words, imagery), offer 2-3 visual style directions within the brand kit as preview frames, and write it all in plain language Matthew can forward to the client. Use at the start of every new build's design step, and in short form before a feature preview.
---

# Designer · Discovery: understand the vision before drawing it

Matthew's rule (Nov 24 2026): features have come out differently from what was imagined. So before you draw, you find out what the client actually has in mind, the way the best product designers do, and you show options instead of guessing.

## 1. Always inside the brand kit

The brand kit (`DESIGN.md`, the client's brand files, or the Brand agent's kit; `ux-brand` §1) is fixed. Discovery chooses **within** it: how the brand is used, not whether to change it. If the answers pull against the brand (say, "playful" for a brand that's strict and corporate), say so and ask; never quietly change the palette or type.

## 2. When, and how much

- **New build, first design step:** the full set below (§3), then style directions (§4). Status **needs-answers** until they're back.
- **Feature preview or change request on an existing build:** the 2 or 3 questions that matter for this feature only, and one preview (directions only if the feature has a real look-and-feel choice).
- **Skip what's already answered:** read the PRD, the intake answers, `client-research.md` and earlier `design-answers.md` first. Never ask the client something they've told us.

## 3. The questions (new build)

Ask at most 10, in plain words a business owner understands, each with lettered options and your recommendation first (A), and one line on why it matters. Pick from:

1. **Who uses it, and where?** At a desk, on a phone in a shop or van, at home in the evening? How often, and in a rush or relaxed?
2. **The one job it must make effortless.** If people remember one thing as easy, what is it?
3. **Three words for how it should feel** (offer sets: calm, trustworthy, premium / bold, energetic, modern / friendly, simple, warm / sharp, efficient, pro).
4. **Apps or websites they love using, and ones they hate,** and why. Two or three of each; links if they have them.
5. **Busy or spacious?** Lots on one screen (dashboards, staff tools) or one thing at a time with room to breathe (customers, first-time users).
6. **Light, dark or both?**
7. **How it talks:** formal, friendly, playful, straight to the point. One example sentence per option.
8. **Pictures:** their own photos, illustrations, icons only, or mostly text?
9. **Who might struggle with it:** older users, small screens, poor connection, colour-blindness, English as a second language?
10. **The first thing people should see** when they open it.

## 4. Style directions

After the answers (or alongside them, when the brand is clear enough), render **2 or 3 directions** of the screen that matters most, all in the client's brand, each with a short name and one line ("A · Calm and spacious: big type, lots of white space, one action per screen"). Make them genuinely different in layout, density and feel, not three shades of the same thing. Use `ux-handoff` "Feature preview" mechanics: `design/previews/directions-<n>/`, phone and desktop, "Preview, not final". The client picks one, or mixes ("A's layout with B's buttons"); that choice becomes the approved direction (`stack-hitl` §3b) every later screen follows.

## 5. Writing it for the client

Write the questions and the directions to `design/discovery/questions-<n>.md` in a form Matthew can forward as-is: no jargon, no internal names, the client's business name, the preview images listed with one line each. Mark the top **"For the client"** (or **"For Matthew"** when only he can answer, such as budget or scope). In your report, put a `## Design questions` section pointing to the file, status **needs-answers**.

Answers come back as `.baseleap/inputs/design-answers.md`. Record what was chosen in `DESIGN.md`'s notes (which direction, the three feel words, light/dark, density) so every later screen and every future feature on this client follows it.
