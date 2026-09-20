/**
 * Zod schemas for every shape that crosses a boundary in this project.
 *
 * Rule 0.5: model output is parsed here. On failure the process exits
 * non-zero and nothing downstream runs, leaving the previous data intact.
 * Never coerce, never partially accept.
 *
 * The CLI gate itself lives at the bottom of this file.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Enums                                                               */
/* ------------------------------------------------------------------ */

/** The fourteen problem categories (spec 4.3). The model may emit no others. */
export const CATEGORIES = [
  'Onboarding',
  'Navigation',
  'Performance',
  'Crashes and stability',
  'Data loss and sync',
  'Pricing and billing',
  'Ads and interruptions',
  'Notifications',
  'Accounts and login',
  'Search and retrieval',
  'Offline and connectivity',
  'Accessibility',
  'Support',
  'Other',
] as const;

export const VERDICTS = [
  'Worth building',
  'Watch',
  'Already solved',
  'Too small',
] as const;

export const PLATFORMS = ['ios', 'android'] as const;

export const CategorySchema = z.enum(CATEGORIES);
export const VerdictSchema = z.enum(VERDICTS);
export const PlatformSchema = z.enum(PLATFORMS);

export type Category = z.infer<typeof CategorySchema>;
export type Verdict = z.infer<typeof VerdictSchema>;
export type Platform = z.infer<typeof PlatformSchema>;

/** Count words the way the 25-word quote cap is meant to be read. */
export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2}))?$/, 'must be an ISO date');

/* ------------------------------------------------------------------ */
/* Screening (spec 1.4)                                                */
/*                                                                     */
/* These live here, beside the schemas, because admissibility is a     */
/* data rule and because the validation gate itself has to re-check    */
/* the crisis screen against every stored quote. One implementation.   */
/* ------------------------------------------------------------------ */

/**
 * Apps whose subject matter is personal distress or health are never tracked.
 * Matched as case-insensitive substrings against the app name, the developer
 * name and the store category. Several entries are deliberate stems
 * ("pregnan", "depress", "diagnos") so substring matching is the intent.
 *
 * Over-blocking is the safe direction: a false positive drops one app and is
 * reported loudly by resolve-apps, whereas a false negative tracks an app this
 * project has no business tracking.
 */
export const APP_DENYLIST = [
  'mental health', 'therapy', 'counsel', 'mood', 'depress', 'anxiety', 'suicide', 'crisis',
  'addiction', 'recovery', 'sober', 'quit smoking', 'rehab',
  'calorie', 'diet', 'weight loss', 'fasting', 'eating', 'macro', 'bmi',
  'period', 'fertility', 'pregnan', 'medical', 'symptom', 'diagnos', 'telehealth', 'pharmacy',
  'dating', 'hookup',
] as const;

/**
 * A review matching any of these is dropped before it enters the pipeline:
 * never stored, never quoted, never counted (spec 1.4).
 *
 * These nine terms are the canonical list, kept as plain strings because the
 * methodology page prints them verbatim.
 */
export const CRISIS_PATTERNS = [
  'kill myself', 'end my life', 'suicide', 'want to die', 'self harm',
  'cutting myself', 'starve', 'purge', 'relapse',
] as const;

/**
 * What the screen actually matches on: the nine terms above plus their natural
 * inflections.
 *
 * Deviation from the spec's literal list, deliberately. Plain substring
 * matching lets "ending my life" and "suicidal" through, which is the wrong
 * direction for a safety screen to fail in. Each regex below covers exactly
 * one listed term; nothing new is screened for, only inflected forms of what
 * the spec already names.
 */
const CRISIS_REGEXES: RegExp[] = [
  /kill(?:ing|ed)? myself/i,          // kill myself
  /end(?:ing|ed)? my life/i,          // end my life
  /suicid(?:e|al)/i,                  // suicide
  /want(?:ing|ed|s)? to die/i,        // want to die
  /self[ -]?harm/i,                   // self harm
  /cut(?:ting)? myself/i,             // cutting myself
  /starv(?:e|ed|ing)/i,               // starve
  /purg(?:e|ed|ing)/i,                // purge
  /relaps(?:e|ed|ing)/i,              // relapse
];

/**
 * Returns the denylist term that blocks this app, or null if it is allowed.
 * Returning the term rather than a boolean so callers can report *why*.
 */
export function blockedAppReason(fields: {
  name?: string | null;
  developer?: string | null;
  storeCategory?: string | null;
}): string | null {
  const haystack = [fields.name, fields.developer, fields.storeCategory]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return APP_DENYLIST.find((term) => haystack.includes(term)) ?? null;
}

/** True when the app must not be tracked. */
export function isBlockedApp(fields: {
  name?: string | null;
  developer?: string | null;
  storeCategory?: string | null;
}): boolean {
  return blockedAppReason(fields) !== null;
}

/** True when review text contains crisis language and must be dropped entirely. */
export function containsCrisisLanguage(...parts: (string | null | undefined)[]): boolean {
  const text = parts.filter(Boolean).join(' ');
  return CRISIS_REGEXES.some((re) => re.test(text));
}

/* ------------------------------------------------------------------ */
/* 4.1 Product                                                         */
/* ------------------------------------------------------------------ */

export const ProductSchema = z.object({
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'slug must be kebab-case'),
  name: z.string().min(1),
  category: z.string().min(1),
  appleId: z.string().regex(/^\d+$/).nullable(),
  playPackage: z.string().min(1).nullable(),
  countries: z.array(z.string().length(2)).min(1),
});
export type Product = z.infer<typeof ProductSchema>;

export const ProductsFileSchema = z.array(ProductSchema);

/* ------------------------------------------------------------------ */
/* 4.2 Candidate review                                                */
/* ------------------------------------------------------------------ */

export const CandidateSchema = z.object({
  id: z.string().min(1),
  productSlug: z.string().min(1),
  platform: PlatformSchema,
  country: z.string().length(2),
  rating: z.number().int().min(1).max(5),
  /** Empty string for Play, which has no review titles. */
  title: z.string(),
  body: z.string().max(1200),
  version: z.string().nullable(),
  reviewedAt: isoDate,
  capturedAt: isoDate,
  /** sha256(salt + name + platform) truncated to 16 hex. Never a name. */
  reviewerHash: z.string().regex(/^[0-9a-f]{16}$/, 'reviewerHash must be 16 hex chars'),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const CandidatesFileSchema = z.array(CandidateSchema);

/* ------------------------------------------------------------------ */
/* 4.3 Extracted problem (model output)                                */
/* ------------------------------------------------------------------ */

export const SignalsSchema = z.object({
  /** says they are leaving, deleting, downgrading */
  churnIntent: z.boolean(),
  /** names a rival as better */
  competitorNamed: z.boolean(),
  /** about price, subscription or refund */
  billingComplaint: z.boolean(),
  /** says it worked before an update */
  regressionClaim: z.boolean(),
  /** describes a manual hack */
  workaroundDescribed: z.boolean(),
});
export type Signals = z.infer<typeof SignalsSchema>;

export const ExtractedEvidenceSchema = z.object({
  reviewId: z.string().min(1),
  quote: z
    .string()
    .min(1)
    .refine((q) => wordCount(q) <= 25, 'quote must be 25 words or fewer'),
  signals: SignalsSchema,
});

export const ExtractedProblemSchema = z.object({
  productSlug: z.string().min(1),
  title: z.string().min(1).max(90),
  summary: z.string().min(1),
  category: CategorySchema,
  evidence: z.array(ExtractedEvidenceSchema).min(1),
  workarounds: z.array(z.string()).max(3),
  existingSolutions: z.array(z.string()).max(5),
});
export type ExtractedProblem = z.infer<typeof ExtractedProblemSchema>;

export const ExtractedFileSchema = z.array(ExtractedProblemSchema);

/* ------------------------------------------------------------------ */
/* 4.4 Canonical problem (what the site reads)                         */
/* ------------------------------------------------------------------ */

/**
 * Stored evidence = candidate fields + quote + signals, minus `body`.
 * Dropping `body` is what keeps raw review text out of data/problems/ (spec 1.3).
 */
export const EvidenceSchema = CandidateSchema.omit({ body: true }).extend({
  quote: z
    .string()
    .min(1)
    .refine((q) => wordCount(q) <= 25, 'quote must be 25 words or fewer'),
  signals: SignalsSchema,
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ComponentsSchema = z.object({
  distinctUsers: z.number(),
  recurrence: z.number(),
  recency: z.number(),
  severity: z.number(),
  churnIntent: z.number(),
  versionPersistence: z.number(),
  crossPlatform: z.number(),
});
export type Components = z.infer<typeof ComponentsSchema>;

/**
 * The raw counts each component was computed from, stated so the score
 * disclosure can show "9 distinct reviewers, of 12 needed for full marks".
 *
 * Extends the shape in spec 4.4, deliberately. These could be recomputed from
 * `evidence` at page-build time, but the 180-day window moves, so a rebuild
 * days after a scan would render bars that disagree with the stored `score`.
 * Storing them keeps the page a pure render of one scoring run, which is the
 * property that makes the number auditable.
 */
export const ComponentInputsSchema = z.object({
  uniqueReviewers: z.number().int(),
  weeksWithEvidence: z.number().int(),
  daysSinceLastSeen: z.number().int(),
  meanRating: z.number(),
  churnReviewers: z.number().int(),
  distinctVersions: z.number().int(),
  platforms: z.array(PlatformSchema),
  evidenceInWindow: z.number().int(),
});
export type ComponentInputs = z.infer<typeof ComponentInputsSchema>;

export const ProblemSchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  productSlug: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  category: CategorySchema,
  platforms: z.array(PlatformSchema).min(1),
  evidence: z.array(EvidenceSchema).min(1),
  versions: z.array(z.string()),
  workarounds: z.array(z.string()),
  existingSolutions: z.array(z.string()),
  firstSeen: isoDate,
  lastSeen: isoDate,
  history: z.array(
    z.object({
      date: isoDate,
      score: z.number(),
      evidenceCount: z.number().int(),
    }),
  ),
  score: z.number(),
  components: ComponentsSchema,
  /** What each component was computed from, for the score disclosure. */
  inputs: ComponentInputsSchema,
  /** The threshold in force when this verdict was decided, so the page can explain it. */
  buildThreshold: z.number(),
  verdict: VerdictSchema,
  status: z.enum(['active', 'stale']),
});
export type Problem = z.infer<typeof ProblemSchema>;

/* ------------------------------------------------------------------ */
/* Run index (spec 5.6 step 8, rendered by /archive)                   */
/* ------------------------------------------------------------------ */

const FunnelStageSchema = z.object({
  ios: z.number().int(),
  android: z.number().int(),
  total: z.number().int(),
});
export type FunnelStage = z.infer<typeof FunnelStageSchema>;

export const RunSchema = z.object({
  date: isoDate,
  startedAt: isoDate,
  funnel: z.object({
    /** everything pulled from both stores */
    fetched: FunnelStageSchema,
    /** survived the seen / crisis / age / length rejections */
    screened: FunnelStageSchema,
    /** survived rating <= 3 plus a complaint-marker match */
    filtered: FunnelStageSchema,
    /** written to the candidates file after the 60-per-run cap */
    capped: FunnelStageSchema,
  }),
  products: z.array(
    z.object({
      slug: z.string(),
      appleOk: z.boolean(),
      playOk: z.boolean(),
      /** why Play was skipped or failed; null when it worked or was not configured */
      playError: z.string().nullable(),
    }),
  ),
  /** filled in by score.ts; absent on a run that stopped before extraction */
  extractedProblems: z.number().int().optional(),
  problemsTotal: z.number().int().optional(),
  problemsNew: z.number().int().optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const RunsFileSchema = z.array(RunSchema);

/**
 * seen.json maps a processed review id to the date it was first sent to the
 * model. A map rather than a bare array so stale entries can be pruned; the
 * semantics are still "ids already processed" (spec 5.3).
 */
export const SeenFileSchema = z.record(z.string(), isoDate);
export type Seen = z.infer<typeof SeenFileSchema>;

/* ------------------------------------------------------------------ */
/* The CLI gate (spec 5.5)                                             */
/* ------------------------------------------------------------------ */

/**
 * Normalise for the verbatim-quote check.
 *
 * The spec calls for case-insensitive, whitespace-normalised comparison. This
 * also folds typographic punctuation onto its ASCII equivalent, because a
 * curly apostrophe and a straight one are the same character differently
 * encoded, not a change to the words. Nothing here can make a fabricated quote
 * match a review it did not come from.
 */
export function normaliseForQuoteCheck(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface ValidationProblem {
  index: number;
  productSlug: string;
  message: string;
}

/**
 * Cross-check extracted problems against the candidates they claim to quote.
 * Returns every failure rather than the first, so one run surfaces all of them.
 */
export function crossCheckExtracted(
  extracted: ExtractedProblem[],
  candidates: Candidate[],
): ValidationProblem[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const failures: ValidationProblem[] = [];

  extracted.forEach((problem, index) => {
    const fail = (message: string) =>
      failures.push({ index, productSlug: problem.productSlug, message });

    for (const e of problem.evidence) {
      const candidate = byId.get(e.reviewId);

      // Every reviewId must resolve to a candidate in this run.
      if (!candidate) {
        fail(`evidence references unknown reviewId "${e.reviewId}"`);
        continue;
      }

      // Evidence must belong to the product it is filed under.
      if (candidate.productSlug !== problem.productSlug) {
        fail(
          `evidence "${e.reviewId}" belongs to ${candidate.productSlug}, not ${problem.productSlug}`,
        );
      }

      // The quote must be verbatim from that review's title or body.
      const haystack = normaliseForQuoteCheck(`${candidate.title} ${candidate.body}`);
      const needle = normaliseForQuoteCheck(e.quote);
      if (!needle || !haystack.includes(needle)) {
        fail(`quote is not verbatim in review "${e.reviewId}": ${JSON.stringify(e.quote.slice(0, 80))}`);
      }

      // Redundant with the schema, asserted again because it is a privacy cap.
      if (wordCount(e.quote) > 25) {
        fail(`quote on "${e.reviewId}" is ${wordCount(e.quote)} words, cap is 25`);
      }

      // Nothing carrying crisis language may ever reach storage.
      if (containsCrisisLanguage(e.quote)) {
        fail(`quote on "${e.reviewId}" matches the crisis language screen`);
      }
    }

    // Spec 5.4: a problem needs at least three supporting reviews.
    const distinctReviews = new Set(problem.evidence.map((e) => e.reviewId)).size;
    if (distinctReviews < 3) {
      fail(`only ${distinctReviews} supporting review(s), minimum is 3`);
    }
  });

  return failures;
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

/** Newest YYYY-MM-DD.json in a directory, or null when there is none. */
export function newestDated(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  return files.at(-1) ?? null;
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

function main(): void {
  const dateArg = argValue('date');
  const extractedOverride = argValue('file');

  const extractedDir = join(DATA, 'extracted');
  const candidatesDir = join(DATA, 'candidates');

  const extractedName = dateArg ? `${dateArg}.json` : newestDated(extractedDir);
  const extractedPath = extractedOverride
    ? resolve(extractedOverride)
    : extractedName
      ? join(extractedDir, extractedName)
      : null;

  if (!extractedPath || !existsSync(extractedPath)) {
    console.error('No extracted file to validate.');
    console.error(`Looked in ${extractedDir}${dateArg ? ` for ${dateArg}.json` : ' for the newest dated file'}.`);
    process.exit(1);
  }

  // The candidates file is chosen by the extracted file's own date, so a stale
  // or mismatched pair can never validate against the wrong run.
  // Derived from the file's own name, so --file always validates against the
  // candidates of the run it actually belongs to.
  const runDate = (extractedPath.split(/[\\/]/).pop() ?? '').replace(/\.json$/, '');
  const candidatesPath = join(candidatesDir, `${runDate}.json`);

  if (!existsSync(candidatesPath)) {
    console.error(`No candidates file for run ${runDate} at ${candidatesPath}.`);
    console.error('Every reviewId must resolve to a candidate in this run, so validation cannot proceed.');
    process.exit(1);
  }

  console.log(`Validating ${extractedPath}`);
  console.log(`  against  ${candidatesPath}\n`);

  /* ---- shape ---- */
  let rawExtracted: unknown;
  try {
    rawExtracted = JSON.parse(readFileSync(extractedPath, 'utf8'));
  } catch (err) {
    console.error(`FAIL: extracted file is not valid JSON.\n${(err as Error).message}`);
    process.exit(1);
  }

  const parsed = ExtractedFileSchema.safeParse(rawExtracted);
  if (!parsed.success) {
    console.error('FAIL: extracted file does not match the schema.\n');
    console.error(z.prettifyError(parsed.error));
    process.exit(1);
  }

  const candidates = CandidatesFileSchema.parse(JSON.parse(readFileSync(candidatesPath, 'utf8')));

  /* ---- cross-checks ---- */
  const failures = crossCheckExtracted(parsed.data, candidates);

  if (failures.length > 0) {
    console.error(`FAIL: ${failures.length} problem(s) found.\n`);
    for (const f of failures) {
      console.error(`  [${f.index}] ${f.productSlug}: ${f.message}`);
    }
    console.error('\nNothing downstream will run. Previous data is untouched.');
    process.exit(1);
  }

  /* ---- report ---- */
  const evidenceCount = parsed.data.reduce((n, p) => n + p.evidence.length, 0);
  const products = new Set(parsed.data.map((p) => p.productSlug));
  console.log(`OK: ${parsed.data.length} problems across ${products.size} products`);
  console.log(`    ${evidenceCount} pieces of evidence, all verbatim and within the 25-word cap`);
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) main();
