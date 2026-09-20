/**
 * The scoring formula. This is the only implementation in the codebase —
 * scripts/score.ts computes with it and the site renders the disclosure from it.
 *
 * Rule 0.4: the model never produces a number. Every value here is derived in
 * TypeScript from extracted fields, so any reader can reproduce it.
 */
import type {
  ComponentInputs,
  Components,
  Evidence,
  Verdict,
} from '../../scripts/validate';

export type { ComponentInputs };

/* ------------------------------------------------------------------ */
/* Constants                                                           */
/* ------------------------------------------------------------------ */

/** Components are computed over evidence from this window only. */
export const EVIDENCE_WINDOW_DAYS = 180;

/** A problem with no new evidence for this long is marked stale. */
export const STALE_AFTER_DAYS = 120;

/** "Strong signal" never falls below this, however weak the field is. */
export const MIN_BUILD_THRESHOLD = 70;

/** The threshold tracks this percentile of active scores, holding the pass rate near 1 in 5. */
export const THRESHOLD_PERCENTILE = 80;

/** Full marks at this many distinct reviewers. */
export const USERS_FOR_FULL_MARKS = 12;
/** Full marks at this many distinct ISO weeks carrying evidence. */
export const WEEKS_FOR_FULL_MARKS = 8;
/** Full marks at this many reviewers signalling churn. */
export const CHURN_FOR_FULL_MARKS = 4;
/** Full marks at this many distinct app versions. */
export const VERSIONS_FOR_FULL_MARKS = 4;
/** Recency is undiminished inside this many days. */
export const RECENCY_GRACE_DAYS = 14;

/** Weights sum to exactly 1. Changing one must break the scoring tests. */
export const WEIGHTS = {
  distinctUsers: 0.25,
  recurrence: 0.2,
  recency: 0.15,
  severity: 0.15,
  churnIntent: 0.1,
  versionPersistence: 0.1,
  crossPlatform: 0.05,
} as const satisfies Record<keyof Components, number>;

export type ComponentKey = keyof Components;

/**
 * One line explaining what each verdict means, shown wherever a verdict first
 * appears on a page.
 *
 * The labels describe the *evidence*, not the opportunity. "Too small" read as
 * the site dismissing a complaint rather than reporting how much support it
 * has, which is both wrong and faintly insulting to the person who wrote it.
 */
export const VERDICT_GLOSS: Record<Verdict, string> = {
  'Thin evidence': 'fewer than four distinct reviewers so far',
  Recurring: 'real and repeated, below the current threshold',
  'Strong signal': 'at or above the current threshold',
  'Already solved': 'three or more shipping products already address this',
};

/** Display order for the score disclosure, heaviest weight first. */
export const COMPONENT_ORDER: ComponentKey[] = [
  'distinctUsers',
  'recurrence',
  'recency',
  'severity',
  'churnIntent',
  'versionPersistence',
  'crossPlatform',
];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  distinctUsers: 'Distinct users',
  recurrence: 'Recurrence',
  recency: 'Recency',
  severity: 'Severity',
  churnIntent: 'Churn intent',
  versionPersistence: 'Version persistence',
  crossPlatform: 'Cross-platform',
};

const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* Dates and ISO weeks                                                 */
/* ------------------------------------------------------------------ */

function toDate(d: Date | string): Date {
  return d instanceof Date ? d : new Date(d);
}

/** Whole days between two instants, floored, never negative. */
export function daysBetween(from: Date | string, to: Date | string): number {
  const ms = toDate(to).getTime() - toDate(from).getTime();
  return Math.max(0, Math.floor(ms / MS_PER_DAY));
}

/**
 * ISO-8601 week key, e.g. "2026-W38".
 * Weeks start Monday; week 1 is the week containing the first Thursday.
 */
export function isoWeekKey(d: Date | string): string {
  const date = toDate(d);
  const t = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = t.getUTCDay() || 7; // Monday=1 .. Sunday=7
  t.setUTCDate(t.getUTCDate() + 4 - dayNum); // move to the Thursday of this week
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The `count` ISO week keys ending at `end`'s week, oldest first. */
export function recentIsoWeeks(end: Date | string, count: number): string[] {
  const keys: string[] = [];
  const cursor = toDate(end);
  for (let i = count - 1; i >= 0; i--) {
    keys.push(isoWeekKey(new Date(cursor.getTime() - i * 7 * MS_PER_DAY)));
  }
  return keys;
}

/* ------------------------------------------------------------------ */
/* Components                                                          */
/* ------------------------------------------------------------------ */

export interface Scored {
  components: Components;
  inputs: ComponentInputs;
  score: number;
}

const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);

/** Evidence from the last EVIDENCE_WINDOW_DAYS, by review date. */
export function evidenceInWindow(evidence: Evidence[], now: Date | string): Evidence[] {
  const cutoff = toDate(now).getTime() - EVIDENCE_WINDOW_DAYS * MS_PER_DAY;
  return evidence.filter((e) => new Date(e.reviewedAt).getTime() >= cutoff);
}

/**
 * Compute the seven components (spec 5.6 step 3).
 *
 * Note: platforms and versions are taken from the windowed evidence, not from
 * the problem's full history, because the score measures current friction. The
 * version list shown on the page is the full historical set; the disclosure
 * says "in the last 180 days" so the two never read as contradicting.
 */
export function computeComponents(evidence: Evidence[], now: Date | string): Scored {
  const win = evidenceInWindow(evidence, now);

  const uniqueReviewers = new Set(win.map((e) => e.reviewerHash)).size;
  const weeksWithEvidence = new Set(win.map((e) => isoWeekKey(e.reviewedAt))).size;
  const distinctVersions = new Set(
    win.map((e) => e.version).filter((v): v is string => Boolean(v)),
  ).size;
  const platforms = [...new Set(win.map((e) => e.platform))].sort();
  const churnReviewers = new Set(
    win.filter((e) => e.signals.churnIntent).map((e) => e.reviewerHash),
  ).size;

  const meanRating = win.length ? win.reduce((s, e) => s + e.rating, 0) / win.length : 0;

  const newest = win.reduce<number>(
    (max, e) => Math.max(max, new Date(e.reviewedAt).getTime()),
    0,
  );
  const daysSinceLastSeen = newest ? daysBetween(new Date(newest), now) : EVIDENCE_WINDOW_DAYS;

  // Decays linearly from 1 at 14 days to exactly 0 at 180 days.
  const recency =
    daysSinceLastSeen <= RECENCY_GRACE_DAYS
      ? 1
      : Math.max(
          0,
          1 -
            (daysSinceLastSeen - RECENCY_GRACE_DAYS) /
              (EVIDENCE_WINDOW_DAYS - RECENCY_GRACE_DAYS),
        );

  const components: Components = {
    distinctUsers: clamp01(uniqueReviewers / USERS_FOR_FULL_MARKS),
    recurrence: clamp01(weeksWithEvidence / WEEKS_FOR_FULL_MARKS),
    recency,
    // 1 star -> 1.0, 5 star -> 0
    severity: win.length ? clamp01((5 - meanRating) / 4) : 0,
    churnIntent: clamp01(churnReviewers / CHURN_FOR_FULL_MARKS),
    versionPersistence: clamp01(distinctVersions / VERSIONS_FOR_FULL_MARKS),
    crossPlatform: platforms.length === 2 ? 1 : 0,
  };

  const inputs: ComponentInputs = {
    uniqueReviewers,
    weeksWithEvidence,
    daysSinceLastSeen,
    meanRating,
    churnReviewers,
    distinctVersions,
    platforms: platforms as ('ios' | 'android')[],
    evidenceInWindow: win.length,
  };

  return { components, inputs, score: computeScore(components) };
}

/** Weighted sum, scaled to 0-100 and rounded. */
export function computeScore(c: Components): number {
  const raw =
    WEIGHTS.distinctUsers * c.distinctUsers +
    WEIGHTS.recurrence * c.recurrence +
    WEIGHTS.recency * c.recency +
    WEIGHTS.severity * c.severity +
    WEIGHTS.churnIntent * c.churnIntent +
    WEIGHTS.versionPersistence * c.versionPersistence +
    WEIGHTS.crossPlatform * c.crossPlatform;
  return Math.round(100 * raw);
}

/* ------------------------------------------------------------------ */
/* Disclosure rows                                                     */
/* ------------------------------------------------------------------ */

export interface ComponentRow {
  key: ComponentKey;
  label: string;
  /** 0 to 1 */
  value: number;
  weight: number;
  /** points this component contributes to the final score */
  contribution: number;
  /** the raw input, stated in words */
  detail: string;
}

/**
 * One row per component for the "How this score is calculated" disclosure.
 * Each states its raw input in words, as spec 6.1 requires.
 */
export function componentRows(c: Components, i: ComponentInputs): ComponentRow[] {
  const details: Record<ComponentKey, string> = {
    distinctUsers: `${i.uniqueReviewers} distinct ${plural(i.uniqueReviewers, 'reviewer')}, of ${USERS_FOR_FULL_MARKS} needed for full marks`,
    recurrence: `${i.weeksWithEvidence} separate ${plural(i.weeksWithEvidence, 'week')} carrying evidence, of ${WEEKS_FOR_FULL_MARKS} needed for full marks`,
    recency:
      i.daysSinceLastSeen === 0
        ? 'last reported today; full marks inside 14 days'
        : `last reported ${i.daysSinceLastSeen} ${plural(i.daysSinceLastSeen, 'day')} ago; full marks inside ${RECENCY_GRACE_DAYS} days, zero at ${EVIDENCE_WINDOW_DAYS}`,
    severity: `mean rating ${i.meanRating.toFixed(1)} of 5 across ${i.evidenceInWindow} ${plural(i.evidenceInWindow, 'quote')}`,
    churnIntent: `${i.churnReviewers} ${plural(i.churnReviewers, 'reviewer')} said they were leaving, of ${CHURN_FOR_FULL_MARKS} needed for full marks`,
    versionPersistence: `${i.distinctVersions} distinct app ${plural(i.distinctVersions, 'version')} in the last ${EVIDENCE_WINDOW_DAYS} days, of ${VERSIONS_FOR_FULL_MARKS} needed for full marks`,
    crossPlatform:
      i.platforms.length === 2
        ? 'reported on both iOS and Android'
        : `reported on ${i.platforms[0] === 'android' ? 'Android' : 'iOS'} only`,
  };

  return COMPONENT_ORDER.map((key) => ({
    key,
    label: COMPONENT_LABELS[key],
    value: c[key],
    weight: WEIGHTS[key],
    contribution: 100 * WEIGHTS[key] * c[key],
    detail: details[key],
  }));
}

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

/* ------------------------------------------------------------------ */
/* Threshold and verdict                                               */
/* ------------------------------------------------------------------ */

/**
 * Linear-interpolation percentile (the same method as numpy's default).
 * Stated explicitly on the methodology page so the threshold is reproducible.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0]!;
  const index = ((sorted.length - 1) * p) / 100;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (index - lower) * (sorted[upper]! - sorted[lower]!);
}

/** max(70, 80th percentile of all active problem scores). */
export function computeBuildThreshold(activeScores: number[]): number {
  return Math.max(MIN_BUILD_THRESHOLD, percentile(activeScores, THRESHOLD_PERCENTILE));
}

export interface VerdictInput {
  uniqueReviewers: number;
  existingSolutionsCount: number;
  score: number;
  buildThreshold: number;
}

/** Evaluated strictly in this order (spec 5.6 step 5). */
export function decideVerdict(v: VerdictInput): Verdict {
  if (v.uniqueReviewers < 4) return 'Thin evidence';
  if (v.existingSolutionsCount >= 3) return 'Already solved';
  if (v.score >= v.buildThreshold) return 'Strong signal';
  return 'Recurring';
}

/** True when no evidence has arrived for STALE_AFTER_DAYS. */
export function isStale(lastSeen: string, now: Date | string): boolean {
  return daysBetween(lastSeen, now) > STALE_AFTER_DAYS;
}

/* ------------------------------------------------------------------ */
/* Heat scale                                                          */
/* ------------------------------------------------------------------ */

/**
 * Position on the single two-temperature scale, 0 = --cold, 1 = --hot.
 * The recurrence grid and the score bars both read from this; there is
 * deliberately no third colour anywhere in the product (spec 6.2).
 */
export function heat(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return clamp01(count / max);
}
