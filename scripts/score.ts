/**
 * Merge validated model output into the canonical problem records, compute
 * every number, and write data/problems/ (spec 5.6).
 *
 * Rule 0.4: nothing in here reads a score from the model. Components are
 * computed from extracted fields by src/lib/scoring.ts, which is the only
 * implementation of the formula and is shared with the site.
 *
 *   npm run score
 *   npm run score -- --date=2026-09-20
 *   npm run score -- --dry            compute and report, write nothing
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  CandidatesFileSchema,
  ExtractedFileSchema,
  ProblemSchema,
  RunsFileSchema,
  newestDated,
  type Candidate,
  type Evidence,
  type ExtractedProblem,
  type Problem,
  type Run,
} from './validate';

import {
  computeComponents,
  computeBuildThreshold,
  decideVerdict,
  isStale,
  STALE_AFTER_DAYS,
} from '../src/lib/scoring';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'data');
const PROBLEMS_DIR = join(DATA, 'problems');

/** Titles this similar, for the same product, are the same problem. */
const TITLE_MATCH_THRESHOLD = 0.75;

/* ------------------------------------------------------------------ */
/* Title matching                                                      */
/* ------------------------------------------------------------------ */

/** Classic Levenshtein edit distance, two-row variant. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  // After the final swap `prev` holds the last computed row.
  return prev[b.length]!;
}

function normaliseTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised similarity in 0..1. 1 means identical after normalisation. */
export function titleSimilarity(a: string, b: string): number {
  const x = normaliseTitle(a);
  const y = normaliseTitle(b);
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(x, y) / longest;
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 72) || 'untitled'
  );
}

/* ------------------------------------------------------------------ */
/* Evidence                                                            */
/* ------------------------------------------------------------------ */

/**
 * Build a stored evidence record. `body` is deliberately dropped: raw review
 * text never persists in data/problems/ (spec 1.3).
 */
function toEvidence(
  candidate: Candidate,
  quote: string,
  signals: Evidence['signals'],
): Evidence {
  const { body: _dropped, ...rest } = candidate;
  return { ...rest, quote, signals };
}

/* ------------------------------------------------------------------ */
/* Load and save                                                       */
/* ------------------------------------------------------------------ */

function loadProblems(): Problem[] {
  if (!existsSync(PROBLEMS_DIR)) return [];
  return readdirSync(PROBLEMS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ProblemSchema.parse(JSON.parse(readFileSync(join(PROBLEMS_DIR, f), 'utf8'))));
}

function argValue(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main(): void {
  const dry = process.argv.includes('--dry');
  const dateArg = argValue('date');

  const extractedName = dateArg ? `${dateArg}.json` : newestDated(join(DATA, 'extracted'));
  if (!extractedName) {
    console.error('No extracted file found. Run the extraction step first.');
    process.exit(1);
  }
  const runDate = extractedName.replace(/\.json$/, '');

  const extractedPath = join(DATA, 'extracted', extractedName);
  const candidatesPath = join(DATA, 'candidates', extractedName);
  if (!existsSync(extractedPath) || !existsSync(candidatesPath)) {
    console.error(`Missing extracted or candidates file for ${runDate}.`);
    process.exit(1);
  }

  const extracted = ExtractedFileSchema.parse(JSON.parse(readFileSync(extractedPath, 'utf8')));
  const candidates = CandidatesFileSchema.parse(JSON.parse(readFileSync(candidatesPath, 'utf8')));
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const problems = loadProblems();
  const now = new Date();

  console.log(`Scoring run ${runDate}`);
  console.log(`  ${extracted.length} extracted problems, ${problems.length} existing records\n`);

  let created = 0;
  let merged = 0;
  let newEvidence = 0;

  /* ---- 1. match or create ---- */
  for (const ex of extracted) {
    const match = bestMatch(ex, problems);

    if (match) {
      merged++;
      // Stored evidence keeps the candidate's `id`; extracted evidence calls
      // the same value `reviewId`. Dedupe across that rename.
      const seenIds = new Set(match.evidence.map((e) => e.id));
      for (const e of ex.evidence) {
        const candidate = byId.get(e.reviewId);
        if (!candidate || seenIds.has(e.reviewId)) continue;
        match.evidence.push(toEvidence(candidate, e.quote, e.signals));
        seenIds.add(e.reviewId);
        newEvidence++;
      }
      // Refresh the prose and the lists; the title is kept from first sighting
      // so the id and URL stay stable.
      match.summary = ex.summary;
      match.workarounds = ex.workarounds;
      match.existingSolutions = ex.existingSolutions;
      match.category = ex.category;
      console.log(`  merged   ${match.id}`);
    } else {
      created++;
      const evidence = ex.evidence
        .map((e) => {
          const candidate = byId.get(e.reviewId);
          return candidate ? toEvidence(candidate, e.quote, e.signals) : null;
        })
        .filter((e): e is Evidence => e !== null);

      if (evidence.length === 0) continue;
      newEvidence += evidence.length;

      const id = `${ex.productSlug}--${slugify(ex.title)}`;
      problems.push({
        id,
        slug: id,
        productSlug: ex.productSlug,
        title: ex.title,
        summary: ex.summary,
        category: ex.category,
        platforms: [],
        evidence,
        versions: [],
        workarounds: ex.workarounds,
        existingSolutions: ex.existingSolutions,
        firstSeen: runDate,
        lastSeen: runDate,
        history: [],
        score: 0,
        // Placeholders; every field below is overwritten by the recompute pass.
        components: {
          distinctUsers: 0,
          recurrence: 0,
          recency: 0,
          severity: 0,
          churnIntent: 0,
          versionPersistence: 0,
          crossPlatform: 0,
        },
        inputs: {
          uniqueReviewers: 0,
          weeksWithEvidence: 0,
          daysSinceLastSeen: 0,
          meanRating: 0,
          churnReviewers: 0,
          distinctVersions: 0,
          platforms: [],
          evidenceInWindow: 0,
        },
        buildThreshold: 0,
        verdict: 'Thin evidence',
        status: 'active',
      });
      console.log(`  created  ${id}`);
    }
  }

  /* ---- 2 & 3. recompute everything from evidence ---- */
  for (const p of problems) {
    // Platforms and versions shown on the page come from the full history.
    p.platforms = [...new Set(p.evidence.map((e) => e.platform))].sort();
    p.versions = [...new Set(p.evidence.map((e) => e.version).filter((v): v is string => Boolean(v)))]
      .sort(compareVersions);

    const dates = p.evidence.map((e) => e.reviewedAt).sort();
    // firstSeen/lastSeen track when users reported it, not when the scan ran.
    // That is what makes `recency` and `stale` mean something to a reader.
    p.firstSeen = dates[0] ?? p.firstSeen;
    p.lastSeen = dates.at(-1) ?? p.lastSeen;

    const { components, inputs, score } = computeComponents(p.evidence, now);
    p.components = components;
    p.inputs = inputs;
    p.score = score;
    p.status = isStale(p.lastSeen, now) ? 'stale' : 'active';
  }

  /* ---- 4 & 5. threshold, then verdicts ---- */
  // Stale problems are excluded from the threshold so a backlog of dead
  // problems cannot drag the bar down (spec 5.6 step 7).
  const activeScores = problems.filter((p) => p.status === 'active').map((p) => p.score);
  const buildThreshold = computeBuildThreshold(activeScores);

  for (const p of problems) {
    // inputs were stored in the pass above; no need to recompute.
    p.buildThreshold = buildThreshold;
    p.verdict = decideVerdict({
      uniqueReviewers: p.inputs.uniqueReviewers,
      existingSolutionsCount: p.existingSolutions.length,
      score: p.score,
      buildThreshold,
    });
  }

  /* ---- 6. history ---- */
  for (const p of problems) {
    const entry = { date: runDate, score: p.score, evidenceCount: p.evidence.length };
    const last = p.history.at(-1);
    // Past entries are never rewritten; only a same-day re-run replaces its own.
    if (last && last.date === runDate) p.history[p.history.length - 1] = entry;
    else p.history.push(entry);
  }

  /* ---- report ---- */
  const active = problems.filter((p) => p.status === 'active');
  const byVerdict = (v: string) => problems.filter((p) => p.verdict === v).length;
  const passRate = active.length ? (byVerdict('Strong signal') / active.length) * 100 : 0;

  console.log(`\nThreshold: ${buildThreshold.toFixed(1)} (max of 70 and the 80th percentile of ${activeScores.length} active scores)`);
  console.log(`Verdicts:  ${byVerdict('Strong signal')} worth building, ${byVerdict('Recurring')} watch, ${byVerdict('Already solved')} already solved, ${byVerdict('Thin evidence')} too small`);
  console.log(`Pass rate: ${passRate.toFixed(0)}% of active problems`);
  console.log(`Records:   ${created} created, ${merged} merged, ${newEvidence} new pieces of evidence`);
  console.log(`Stale:     ${problems.length - active.length} (no evidence in ${STALE_AFTER_DAYS} days)`);

  if (dry) {
    console.log('\nDry run: nothing written.');
    return;
  }

  /* ---- write ---- */
  mkdirSync(PROBLEMS_DIR, { recursive: true });
  for (const p of problems) {
    // Parse before writing: a record that would not load must never be saved.
    const validated = ProblemSchema.parse(p);
    writeFileSync(join(PROBLEMS_DIR, `${validated.slug}.json`), `${JSON.stringify(validated, null, 2)}\n`);
  }

  /* ---- 8. run index ---- */
  const runsPath = join(DATA, 'runs.json');
  const runs: Run[] = existsSync(runsPath)
    ? RunsFileSchema.parse(JSON.parse(readFileSync(runsPath, 'utf8')))
    : [];
  const idx = runs.findIndex((r) => r.date === runDate);
  if (idx >= 0) {
    runs[idx] = {
      ...runs[idx]!,
      extractedProblems: extracted.length,
      problemsTotal: problems.length,
      problemsNew: created,
    };
    writeFileSync(runsPath, `${JSON.stringify(runs, null, 2)}\n`);
  }

  console.log(`\nWrote ${problems.length} problem records to ${PROBLEMS_DIR}`);
}

/** Closest existing problem for the same product, above the match threshold. */
function bestMatch(ex: ExtractedProblem, problems: Problem[]): Problem | null {
  let best: Problem | null = null;
  let bestScore = 0;

  for (const p of problems) {
    if (p.productSlug !== ex.productSlug) continue;
    const similarity = titleSimilarity(p.title, ex.title);
    if (similarity >= TITLE_MATCH_THRESHOLD && similarity > bestScore) {
      best = p;
      bestScore = similarity;
    }
  }
  return best;
}

/** Sort version strings numerically by segment, so 1.10 follows 1.9. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10));
  const pb = b.split('.').map((n) => parseInt(n, 10));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return a.localeCompare(b);
    if (x !== y) return x - y;
  }
  return 0;
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) main();
