# Friction — working notes

A public index of recurring complaints about mobile apps, built from App Store and
Google Play reviews. Static Astro site on GitHub Pages, data committed as JSON.

## The rules that matter most

1. **The model never produces a number.** It groups reviews and copies verbatim
   quotes. Every score, weight, threshold and verdict is computed in
   `src/lib/scoring.ts`, which is the only implementation and is imported by both
   the build scripts and the site. If you find yourself asking a model for a
   score, something has gone wrong.
2. **Validation is a hard gate.** `scripts/validate.ts` parses model output with
   Zod and re-checks every quote character by character against the review it
   cites. Any failure exits non-zero and nothing is written. Never coerce,
   never partially accept.
3. **Never invent data.** No placeholder, sample or mock problems, ever. If a
   source is unreachable, fail loudly and leave the previous data alone.
4. **Verify against the real API, not from memory.** Both stores have changed
   behaviour in ways that contradict the original spec — see the deviations
   below. Check before writing, and leave a comment when reality differs.
5. **Privacy is structural, not a policy note.** Reviewer names are hashed on
   read and discarded. Raw review bodies never reach `data/problems/`. Quotes
   are capped at 25 words. `scripts/prune.ts` is what actually enforces the
   30-day deletion promise.

## Verified deviations from the original spec

Each is commented at its call site. Do not "fix" these back.

- **Apple's page 1 can be empty while pages 2–10 are full.** Duolingo's US feed
  does this reliably. The spec says stop at the first empty page; doing so
  discards 450 real reviews. `fetch.ts` pages all ten and stops only on a non-200.
- **`entry[0]` is a real review, not app metadata.** Verified across fifteen apps
  and four storefronts. Metadata is detected by shape (no `im:rating`) instead.
- **Notion's Play package is `notion.id`**, not `com.notion.id`, which 404s.
- **`google-play-scraper` mistypes its own `sort` enum**, returns
  `{data, nextPaginationToken}` rather than an array, sometimes gives `version`
  as `""`, and returns an empty list rather than throwing for a missing package.
- **The crisis screen matches inflected forms.** Plain substring matching lets
  "ending my life" and "suicidal" through, which is the wrong way for a safety
  screen to fail.
- **Astro 7, not the spec's Astro 5**, with Tailwind via `@tailwindcss/vite`.

## Design constraints

- One anchor hue, 45, in OKLCH. Every neutral is tinted toward it — no
  zero-chroma greys — and `--color-accent` is the only saturated colour, spent
  on the heat ramp (`--heat-0..4`) and almost nothing else. It covers 1.6% of
  the homepage fold; treat 5% as the ceiling. Platform badges and verdicts are
  set in type, never carried by colour alone.
- Geist for everything, Newsreader for reviewers' quotes only, Geist Mono for
  the scoring equation. Roman throughout — no italic display type. Tabular
  figures on every number.
- Measures are in `rem` or `em`, never `ch`. Geist's digits are wide relative
  to its average advance, so a `ch` measure reflowed every page the moment the
  web font arrived. `"Geist Fallback"` carries a measured `size-adjust` for
  the same reason. Together they are what holds CLS at zero.
- Six moments move, and they are listed at the top of `global.css`. Adding a
  seventh is a decision, not a detail.
- Every animation lives inside `@media (prefers-reduced-motion: no-preference)`
  so it does not exist under a reduced-motion preference. There is deliberately
  no blanket `animation: none` reset; the one `animation: none` present is
  scoped to Astro's `::view-transition-*` pseudo-elements.
- The Friction Field (`src/scripts/field.ts`) is the homepage's WebGL
  topography. It never loads under 768px or without WebGL, it cancels its
  frame loop offscreen, and it reads its palette from CSS tokens — which is
  why the theme toggle has to tell it when they change. `src/lib/ramp.ts`
  exists so the client never reaches `lib/data.ts`, which imports `node:fs`.
- Avoid the generated-page tells named in the spec: tracked-out all-caps
  eyebrows, middle-dot metadata, arrows after link text, identical rounded cards
  with soft grey shadows, 01/02/03 markers, gradient washes.
- Every internal link goes through `src/lib/url.ts`. The site is served from a
  subpath, so a hardcoded `/problems/foo` works in dev and 404s in production.

## Commands

```bash
npm run dev                                   # dev server
npm run build                                 # astro check, then build
npm test                                      # scoring, screening, merge tests
npm run fetch -- --only=notion --pages=2 --dry   # fast local fetch, writes nothing
npm run validate                              # the gate
npm run score -- --dry                        # score without writing
```

`npm run fetch` needs `AUTHOR_SALT` in `.env`. It refuses to run without one
rather than producing guessable hashes.
