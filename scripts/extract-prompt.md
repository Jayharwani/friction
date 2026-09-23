# Extract recurring problems from app store reviews

You are the extraction step of an automated pipeline. Read this whole file before acting.

## What to do

1. Find the newest file in `data/candidates/` (they are named `YYYY-MM-DD.json`). That is this run's input.
2. Read it. Each element is a single app store review with an `id`, `productSlug`, `platform`, `rating`, `title`, `body`, `version`, `country` and `reviewedAt`.
3. Group reviews that describe **the same underlying problem**. A problem is one specific thing that is broken or painful, not a general mood. "The app is bad" is not a problem. "Voice messages stay stuck in the sending state and require reinstalling the app" is.
4. Write the result to `data/extracted/<same date as the input file>.json`.
5. Write nothing else. Change no other file. Do not edit the candidates file.

## Output shape

A JSON array. Every element must match this exactly:

```json
{
  "productSlug": "slack",
  "title": "one plain sentence, maximum 90 characters",
  "summary": "Two to three sentences of plain English describing what happens and when.",
  "category": "one of the fourteen values listed below",
  "evidence": [
    {
      "reviewId": "apple:14563133116",
      "quote": "verbatim text copied from that review, 25 words or fewer",
      "signals": {
        "churnIntent": false,
        "competitorNamed": false,
        "billingComplaint": false,
        "regressionClaim": false,
        "workaroundDescribed": false
      }
    }
  ],
  "workarounds": ["short phrase", "short phrase"],
  "existingSolutions": ["Real Product Name"],

  "humanTitle": "People lose work when the app freezes mid-edit",
  "whoItAffects": "Mostly iPhone users writing long documents, across six app versions since March.",
  "lenses": {
    "build": {
      "proposition": "one line",
      "specifics": ["what it does", "who for", "the first thing to make"],
      "limitation": "the reason this might not work"
    },
    "start": { "proposition": "", "specifics": [], "limitation": "" },
    "study": { "proposition": "", "specifics": [], "limitation": "" },
    "write": { "proposition": "", "specifics": [], "limitation": "" }
  }
}
```

## Hard requirements

These are checked by `npm run validate` immediately after you finish. Any failure stops the run and nothing is committed.

- **Output valid JSON only.** No prose, no explanation, no markdown code fences around the file contents. The file must parse with `JSON.parse`.
- **Every `reviewId` must exist in this run's candidates file.** Do not invent ids, do not reference reviews from a previous run.
- **Every `quote` must be a verbatim substring** of that review's `title` or `body`. Copy the characters exactly. Do not paraphrase, do not fix spelling, do not join text from two places with an ellipsis.
- **Every `quote` must be 25 words or fewer.**
- **Never include a person's name** in any field. Not in the title, the summary, or a quote. If a review names its author or anyone else, choose a different part of the review to quote.
- **`category` must be exactly one of:** `Onboarding`, `Navigation`, `Performance`, `Crashes and stability`, `Data loss and sync`, `Pricing and billing`, `Ads and interruptions`, `Notifications`, `Accounts and login`, `Search and retrieval`, `Offline and connectivity`, `Accessibility`, `Support`, `Other`.
- **Do not output a score, rank, priority, severity number, or confidence of any kind.** Every number on the site is computed in TypeScript from the fields above. If you find yourself wanting to rank problems, stop — that is not your job here.
- **`existingSolutions` must name real, shipping products you are confident exist.** If you are not sure, return an empty array. A wrong name here is worse than an empty list, because it feeds a published verdict.
- **Group across platforms.** An iOS complaint and an Android complaint about the same behaviour are one problem with evidence from both, not two problems.
- **If fewer than three reviews support a problem, do not emit it.** Thin problems are noise.
- **Prefer 5 to 15 well-evidenced problems over 40 thin ones.** Depth beats coverage.

## The challenge fields

`humanTitle`, `whoItAffects` and `lenses` turn a recorded problem into something a
reader can act on. They are the only fields on this site that are *written* rather
than quoted or counted, and they are labelled as written wherever they appear.

**`humanTitle` — maximum 12 words.** Rewrite the title so its subject is a person,
not the software. "The mobile app freezes and lags while editing pages" becomes
"People lose work when the app freezes mid-edit". Say what it costs someone.

**`whoItAffects` — one sentence.** Draw it *only* from the platform, version and
country fields on the evidence you grouped. If the evidence is all iOS, say iOS. If
it spans six versions, say six versions. Never infer an occupation, an age, a
company size or a use case that no reviewer stated.

**`lenses` — four objects, maximum 60 words each.** Each answers "what could I do
with this" for a different reader:

- **build** — what product or feature would fix this, for a designer, PM or engineer.
  **This is the easiest one to get wrong.** Restating the complaint as a feature
  is not a proposition: "an app that does not crash" tells a reader nothing they
  did not have. Name the *mechanism* — what it stores, when it runs, what it does
  at the moment the failure happens. If the sentence would still be true of any
  app with this bug, it is too vague.
- **start** — whether there is a company here, and what it would be, for a founder
- **study** — what research question this opens, for a student or researcher
- **write** — what the story or post is, for a creator

Each carries a one-line `proposition`, two or three concrete `specifics`, and a
`limitation`.

**The limitation is the most important field in this document.** Four cards of
uncritical enthusiasm is what every idea-generator produces and why none of them
are trusted. Name the real reason each one might not work: the platform constraint
for build, who already does this for start, the data you could not get for study,
what has already been written for write. A card that tells a reader why it might
fail is the one they believe.

### What a lens may never contain

`npm run validate` rejects the whole run on any of these. They are not style notes.

- **No money, and no size.** No currency symbol, no percentage, no "market",
  "billion", "million", "TAM" or "opportunity size". You do not know the market and
  you cannot learn it from app store reviews.
- **No demand claim.** Not "users are desperate for", not "there is clearly appetite
  for". Reviews tell you what a few hundred people complained about, not what
  anyone would buy.
- **No company a reviewer did not name.** You may only reference a product that
  appears in this problem's `existingSolutions`, which itself comes from reviewers'
  own words.
- **No growth, scale or traction language.** No "rapidly growing", "underserved
  segment", "massive", "huge", "exploding".

Write plainly. "A tool that recovers unsaved edits after a crash" is better than
"An AI-powered resilience layer for creative professionals." If a lens reads like a
pitch deck, it is wrong; if it reads like a colleague telling you what they noticed,
it is right.

## The five signals

Set each boolean from what the review actually says, not from what you infer.

| Signal | True when the reviewer... |
|---|---|
| `churnIntent` | says they are leaving, deleting, uninstalling, cancelling or downgrading |
| `competitorNamed` | names a rival product as better |
| `billingComplaint` | complains about price, a subscription, a charge or a refund |
| `regressionClaim` | says it worked before an update |
| `workaroundDescribed` | describes a manual hack they use to cope |

## Notes on judgement

- One review can support only one problem. Pick the problem it evidences best.
- The `title` is read by someone scanning a list. Make it specific and neutral. No marketing language, no exclamation marks, no words like "nightmare" or "disaster".
- The `summary` explains what happens and under what conditions. It does not editorialise and it does not recommend anything.
- `workarounds` are what reviewers say they actually do, not what you think they should do. Zero is a fine answer.
- Reviews in this file have already been screened for crisis language. If you nonetheless encounter a review describing self-harm or a mental health crisis, exclude it entirely and do not quote it.
- Some reviews are noise — mis-posted, about a different app, or content-free. Ignore them rather than forcing them into a group.
