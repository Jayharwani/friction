# The gap line

One sentence per pattern, describing what nobody offers. It is the only
written field on the site — every other value is extracted from a review or
computed in `src/lib/scoring.ts`. Run it the same way extraction is run: paste
this prompt with the pattern's evidence, put the result in `data/gaps.json`.

## Input

For one pattern, you are given only:

- the category name
- the titles of its problems
- the workarounds reviewers described
- the existing products reviewers named

Nothing else. Do not look anything up.

## Rules

1. **One sentence. Twenty words maximum.**
2. It describes a **gap** — something the evidence shows nobody does. Not a
   product, not a pitch.
3. **Never name a product, a company, a price, a market size, or any claim
   about demand.** "A tool that…", "there's a big market for…", "users would
   pay for…" are all failures.
4. Use only what the evidence supports. If every workaround is "reinstall",
   you may say the only remedy is reinstalling. You may not say anyone wants
   an alternative — nobody said that.
5. If the evidence does not support a gap, return nothing. A missing line is
   correct; an invented one is not.

## Worked example

Category: Crashes and stability
Workarounds: uninstall and reinstall · restart the app · restart the phone ·
wait several minutes for a lesson to load
Existing products named: none

> Every workaround reviewers found is reinstall or restart. Nothing offers
> recovery that preserves what was in progress.

Why it passes: it states what the workarounds are, and what is absent from
them. It names no product and claims no demand.

## Failing examples

- "A crash-recovery SDK would be a huge opportunity here." — names a product
  shape and claims opportunity.
- "Millions of users are frustrated by this." — invented number, invented
  emotion.
- "Sentry already solves this." — names a product the evidence did not.
