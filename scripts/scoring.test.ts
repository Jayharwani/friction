/**
 * Scoring tests.
 *
 * Every expected score below is hand-derived from the weights in scoring.ts.
 * Changing any weight must break this file — that is the point of asserting
 * exact values rather than ranges (spec 5.6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Evidence, Signals } from './validate';
import {
  WEIGHTS,
  computeComponents,
  computeScore,
  computeBuildThreshold,
  decideVerdict,
  percentile,
  isoWeekKey,
  recentIsoWeeks,
  daysBetween,
  isStale,
  heat,
  componentRows,
  EVIDENCE_WINDOW_DAYS,
} from '../src/lib/scoring';

/* ------------------------------------------------------------------ */
/* Fixture helpers                                                     */
/* ------------------------------------------------------------------ */

/** 2026-09-19 is a Saturday; its ISO week runs Mon 14th to Sun 20th. */
const NOW = '2026-09-19T12:00:00.000Z';
const MS_PER_DAY = 86_400_000;

/** ISO timestamp `n` whole days before NOW. Offset 0 is exactly NOW. */
function daysAgo(n: number): string {
  return new Date(new Date(NOW).getTime() - n * MS_PER_DAY).toISOString();
}

const NO_SIGNALS: Signals = {
  churnIntent: false,
  competitorNamed: false,
  billingComplaint: false,
  regressionClaim: false,
  workaroundDescribed: false,
};

let seq = 0;

interface EvOpts {
  reviewer?: string;
  rating?: number;
  offset?: number;
  version?: string | null;
  platform?: 'ios' | 'android';
  churn?: boolean;
}

function ev(o: EvOpts = {}): Evidence {
  seq += 1;
  const reviewer = o.reviewer ?? `r${seq}`;
  return {
    id: `apple:${seq}`,
    productSlug: 'notion',
    platform: o.platform ?? 'ios',
    country: 'us',
    rating: o.rating ?? 1,
    title: 'title',
    version: o.version === undefined ? '1.0.0' : o.version,
    reviewedAt: daysAgo(o.offset ?? 0),
    capturedAt: NOW,
    // 16 hex chars, as the schema requires; distinct per reviewer name.
    reviewerHash: hash16(reviewer),
    quote: 'a short verbatim quote',
    signals: { ...NO_SIGNALS, churnIntent: o.churn ?? false },
  };
}

/** Deterministic 16-hex stand-in so fixtures satisfy the reviewerHash shape. */
function hash16(s: string): string {
  let h = 0n;
  for (const ch of s) h = (h * 131n + BigInt(ch.codePointAt(0)!)) % (1n << 64n);
  return h.toString(16).padStart(16, '0').slice(-16);
}

/* ------------------------------------------------------------------ */
/* Weights                                                             */
/* ------------------------------------------------------------------ */

test('weights sum to 1', () => {
  const sum = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum to ${sum}, expected 1`);
});

test('weights are exactly the documented values', () => {
  assert.deepEqual(WEIGHTS, {
    distinctUsers: 0.25,
    recurrence: 0.2,
    recency: 0.15,
    severity: 0.15,
    churnIntent: 0.1,
    versionPersistence: 0.1,
    crossPlatform: 0.05,
  });
});

/* ------------------------------------------------------------------ */
/* Fixture 1 — every component maxed, cross-platform                   */
/* ------------------------------------------------------------------ */

test('fixture 1: all components at full marks scores exactly 100 and is Worth building', () => {
  // 12 distinct reviewers, 8 distinct ISO weeks, newest today,
  // all 1-star, 4 churn reviewers, 4 distinct versions, both platforms.
  const offsets = [0, 0, 0, 0, 0, 7, 14, 21, 28, 35, 42, 49];
  const evidence = offsets.map((offset, idx) =>
    ev({
      reviewer: `u${idx}`,
      offset,
      rating: 1,
      version: `v${idx % 4}`,
      platform: idx % 2 === 0 ? 'ios' : 'android',
      churn: idx < 4,
    }),
  );

  const { components, inputs, score } = computeComponents(evidence, NOW);

  assert.equal(inputs.uniqueReviewers, 12);
  assert.equal(inputs.weeksWithEvidence, 8);
  assert.equal(inputs.daysSinceLastSeen, 0);
  assert.equal(inputs.meanRating, 1);
  assert.equal(inputs.churnReviewers, 4);
  assert.equal(inputs.distinctVersions, 4);
  assert.deepEqual(inputs.platforms, ['android', 'ios']);

  assert.deepEqual(components, {
    distinctUsers: 1,
    recurrence: 1,
    recency: 1,
    severity: 1,
    churnIntent: 1,
    versionPersistence: 1,
    crossPlatform: 1,
  });

  assert.equal(score, 100);
  assert.equal(
    decideVerdict({
      uniqueReviewers: inputs.uniqueReviewers,
      existingSolutionsCount: 0,
      score,
      buildThreshold: 70,
    }),
    'Worth building',
  );
});

/* ------------------------------------------------------------------ */
/* Fixture 2 — Too small                                               */
/* ------------------------------------------------------------------ */

test('fixture 2: three reviewers scores 41 and is Too small regardless of score', () => {
  // 3 reviewers, all inside one ISO week, newest today, all 1-star,
  // no churn, one version, iOS only.
  //   0.25*(3/12) + 0.20*(1/8) + 0.15*1 + 0.15*1 + 0.10*0 + 0.10*(1/4) + 0.05*0
  // = 0.0625 + 0.025 + 0.15 + 0.15 + 0 + 0.025 + 0 = 0.4125 -> 41
  const evidence = [0, 1, 2].map((offset, idx) =>
    ev({ reviewer: `u${idx}`, offset, rating: 1, version: 'v0', platform: 'ios' }),
  );

  const { inputs, score } = computeComponents(evidence, NOW);

  assert.equal(inputs.uniqueReviewers, 3);
  assert.equal(inputs.weeksWithEvidence, 1, 'offsets 0,1,2 from Saturday stay in one ISO week');
  assert.equal(score, 41);

  assert.equal(
    decideVerdict({
      uniqueReviewers: inputs.uniqueReviewers,
      existingSolutionsCount: 0,
      score,
      buildThreshold: 70,
    }),
    'Too small',
  );
});

/* ------------------------------------------------------------------ */
/* Fixture 3 — Already solved beats a passing score                    */
/* ------------------------------------------------------------------ */

test('fixture 3: score 92 but three existing solutions yields Already solved', () => {
  // 8 reviewers across 8 ISO weeks, newest today, all 1-star, 4 churn,
  // 4 versions, both platforms.
  //   0.25*(8/12) + 0.20 + 0.15 + 0.15 + 0.10 + 0.10 + 0.05
  // = 0.1666667 + 0.75 = 0.9166667 -> 92
  const evidence = [0, 7, 14, 21, 28, 35, 42, 49].map((offset, idx) =>
    ev({
      reviewer: `u${idx}`,
      offset,
      rating: 1,
      version: `v${idx % 4}`,
      platform: idx % 2 === 0 ? 'ios' : 'android',
      churn: idx < 4,
    }),
  );

  const { inputs, score } = computeComponents(evidence, NOW);

  assert.equal(inputs.uniqueReviewers, 8);
  assert.equal(inputs.weeksWithEvidence, 8);
  assert.equal(score, 92);

  // Ordering matters: this outranks the build threshold but is still Already solved.
  assert.equal(
    decideVerdict({
      uniqueReviewers: inputs.uniqueReviewers,
      existingSolutionsCount: 3,
      score,
      buildThreshold: 70,
    }),
    'Already solved',
  );
  // Same problem with two known solutions passes instead.
  assert.equal(
    decideVerdict({
      uniqueReviewers: inputs.uniqueReviewers,
      existingSolutionsCount: 2,
      score,
      buildThreshold: 70,
    }),
    'Worth building',
  );
});

/* ------------------------------------------------------------------ */
/* Fixture 4 — Watch, single platform                                  */
/* ------------------------------------------------------------------ */

/** Shared by fixture 4 and the cross-platform pair below. */
function watchEvidence(): Evidence[] {
  // 6 reviewers across 3 ISO weeks, newest 30 days ago, all 2-star,
  // 1 churn reviewer, 2 versions, iOS only.
  return [30, 30, 37, 37, 44, 44].map((offset, idx) =>
    ev({
      reviewer: `u${idx}`,
      offset,
      rating: 2,
      version: `v${idx % 2}`,
      platform: 'ios',
      churn: idx === 0,
    }),
  );
}

test('fixture 4: mid-strength single-platform problem scores 52 and is Watch', () => {
  //   recency = 1 - (30-14)/166 = 0.9036144578
  //   0.25*0.5 + 0.20*0.375 + 0.15*0.9036144578 + 0.15*0.75
  // + 0.10*0.25 + 0.10*0.5 + 0.05*0
  // = 0.125 + 0.075 + 0.1355421687 + 0.1125 + 0.025 + 0.05 = 0.5230421687 -> 52
  const { components, inputs, score } = computeComponents(watchEvidence(), NOW);

  assert.equal(inputs.uniqueReviewers, 6);
  assert.equal(inputs.weeksWithEvidence, 3);
  assert.equal(inputs.daysSinceLastSeen, 30);
  assert.equal(inputs.meanRating, 2);
  assert.equal(inputs.churnReviewers, 1);
  assert.equal(inputs.distinctVersions, 2);
  assert.deepEqual(inputs.platforms, ['ios']);

  assert.equal(components.crossPlatform, 0);
  assert.ok(Math.abs(components.recency - 0.9036144578313253) < 1e-12);
  assert.equal(components.severity, 0.75);

  assert.equal(score, 52);
  assert.equal(
    decideVerdict({
      uniqueReviewers: inputs.uniqueReviewers,
      existingSolutionsCount: 0,
      score,
      buildThreshold: 70,
    }),
    'Watch',
  );
});

/* ------------------------------------------------------------------ */
/* Fixture 5 — the cross-platform bonus is worth exactly 5 points      */
/* ------------------------------------------------------------------ */

test('fixture 5: same evidence on both platforms scores exactly 5 higher', () => {
  const single = watchEvidence();
  const both = watchEvidence();
  both[0] = { ...both[0]!, platform: 'android' };

  const a = computeComponents(single, NOW);
  const b = computeComponents(both, NOW);

  // Only the platform changed, so every other component must be identical.
  assert.equal(a.inputs.uniqueReviewers, b.inputs.uniqueReviewers);
  assert.equal(a.inputs.distinctVersions, b.inputs.distinctVersions);
  assert.equal(a.inputs.weeksWithEvidence, b.inputs.weeksWithEvidence);
  assert.equal(a.components.crossPlatform, 0);
  assert.equal(b.components.crossPlatform, 1);

  assert.equal(a.score, 52);
  assert.equal(b.score, 57);
  assert.equal(b.score - a.score, 5);
});

/* ------------------------------------------------------------------ */
/* Fixture 6 — evidence outside the window                             */
/* ------------------------------------------------------------------ */

test('fixture 6: evidence older than the 180-day window scores 0', () => {
  const evidence = [200, 210, 220, 230].map((offset, idx) =>
    ev({ reviewer: `u${idx}`, offset, rating: 1 }),
  );

  const { components, inputs, score } = computeComponents(evidence, NOW);

  assert.equal(inputs.evidenceInWindow, 0);
  assert.equal(inputs.uniqueReviewers, 0);
  assert.equal(inputs.daysSinceLastSeen, EVIDENCE_WINDOW_DAYS);
  assert.deepEqual(components, {
    distinctUsers: 0,
    recurrence: 0,
    recency: 0,
    severity: 0,
    churnIntent: 0,
    versionPersistence: 0,
    crossPlatform: 0,
  });
  assert.equal(score, 0);
});

/* ------------------------------------------------------------------ */
/* Verdict ordering                                                    */
/* ------------------------------------------------------------------ */

test('verdict branches are evaluated in the documented order', () => {
  // Too small wins even with many solutions and a perfect score.
  assert.equal(
    decideVerdict({ uniqueReviewers: 3, existingSolutionsCount: 5, score: 100, buildThreshold: 70 }),
    'Too small',
  );
  // Already solved wins over Worth building.
  assert.equal(
    decideVerdict({ uniqueReviewers: 4, existingSolutionsCount: 3, score: 100, buildThreshold: 70 }),
    'Already solved',
  );
  // Exactly at the threshold passes.
  assert.equal(
    decideVerdict({ uniqueReviewers: 4, existingSolutionsCount: 0, score: 70, buildThreshold: 70 }),
    'Worth building',
  );
  // One point below does not.
  assert.equal(
    decideVerdict({ uniqueReviewers: 4, existingSolutionsCount: 0, score: 69, buildThreshold: 70 }),
    'Watch',
  );
});

/* ------------------------------------------------------------------ */
/* Threshold                                                           */
/* ------------------------------------------------------------------ */

test('percentile uses linear interpolation', () => {
  // index = (5-1)*0.8 = 3.2 -> 40 + 0.2*(50-40) = 42
  assert.equal(percentile([10, 20, 30, 40, 50], 80), 42);
  assert.equal(percentile([], 80), 0);
  assert.equal(percentile([55], 80), 55);
  assert.equal(percentile([10, 20], 50), 15);
  // Input order must not matter.
  assert.equal(percentile([50, 10, 40, 20, 30], 80), 42);
});

test('build threshold never drops below 70', () => {
  assert.equal(computeBuildThreshold([10, 20, 30, 40, 50]), 70);
  assert.equal(computeBuildThreshold([]), 70);
  // index = 3.2 -> 95 + 0.2*(100-95) = 96
  assert.equal(computeBuildThreshold([80, 85, 90, 95, 100]), 96);
});

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

test('isoWeekKey follows ISO-8601 year boundaries', () => {
  assert.equal(isoWeekKey('2026-01-01T00:00:00Z'), '2026-W01'); // a Thursday
  assert.equal(isoWeekKey('2021-01-01T00:00:00Z'), '2020-W53'); // Friday, prior ISO year
  assert.equal(isoWeekKey('2016-01-03T00:00:00Z'), '2015-W53'); // Sunday, prior ISO year
  assert.equal(isoWeekKey('2026-09-19T12:00:00Z'), '2026-W38');
  // Monday starts a new week; the Sunday before belongs to the previous one.
  assert.equal(isoWeekKey('2026-09-14T00:00:00Z'), '2026-W38');
  assert.equal(isoWeekKey('2026-09-13T23:00:00Z'), '2026-W37');
});

test('recentIsoWeeks returns consecutive weeks oldest first', () => {
  const weeks = recentIsoWeeks(NOW, 12);
  assert.equal(weeks.length, 12);
  assert.equal(weeks.at(-1), '2026-W38');
  assert.equal(weeks[0], '2026-W27');
  assert.equal(new Set(weeks).size, 12, 'no duplicate weeks');
});

test('daysBetween floors and never goes negative', () => {
  assert.equal(daysBetween('2026-09-01T00:00:00Z', '2026-09-19T00:00:00Z'), 18);
  assert.equal(daysBetween('2026-09-19T00:00:00Z', '2026-09-19T23:59:00Z'), 0);
  assert.equal(daysBetween('2026-09-19T00:00:00Z', '2026-09-01T00:00:00Z'), 0);
});

test('isStale trips after 120 days without evidence', () => {
  assert.equal(isStale(daysAgo(119), NOW), false);
  assert.equal(isStale(daysAgo(120), NOW), false);
  assert.equal(isStale(daysAgo(121), NOW), true);
});

/* ------------------------------------------------------------------ */
/* Disclosure rows                                                     */
/* ------------------------------------------------------------------ */

test('componentRows states every raw input in words and contributions total the score', () => {
  const { components, inputs, score } = computeComponents(watchEvidence(), NOW);
  const rows = componentRows(components, inputs);

  assert.equal(rows.length, 7, 'all seven components are disclosed');
  for (const row of rows) {
    assert.ok(row.detail.length > 0, `${row.key} has no raw input stated`);
    assert.ok(row.value >= 0 && row.value <= 1, `${row.key} out of range`);
  }

  assert.match(rows[0]!.detail, /6 distinct reviewers, of 12 needed/);
  assert.match(rows[2]!.detail, /last reported 30 days ago/);
  assert.match(rows[6]!.detail, /iOS only/);

  const total = rows.reduce((sum, r) => sum + r.contribution, 0);
  assert.equal(Math.round(total), score, 'contributions must total the published score');
});

test('heat clamps to the two-temperature scale', () => {
  assert.equal(heat(0, 10), 0);
  assert.equal(heat(5, 10), 0.5);
  assert.equal(heat(20, 10), 1);
  assert.equal(heat(3, 0), 0);
});

/* ------------------------------------------------------------------ */
/* computeScore is pure                                                */
/* ------------------------------------------------------------------ */

test('computeScore depends only on components', () => {
  assert.equal(
    computeScore({
      distinctUsers: 0,
      recurrence: 0,
      recency: 0,
      severity: 0,
      churnIntent: 0,
      versionPersistence: 0,
      crossPlatform: 0,
    }),
    0,
  );
  assert.equal(
    computeScore({
      distinctUsers: 1,
      recurrence: 1,
      recency: 1,
      severity: 1,
      churnIntent: 1,
      versionPersistence: 1,
      crossPlatform: 1,
    }),
    100,
  );
  // Only distinctUsers at full marks -> 25 points.
  assert.equal(
    computeScore({
      distinctUsers: 1,
      recurrence: 0,
      recency: 0,
      severity: 0,
      churnIntent: 0,
      versionPersistence: 0,
      crossPlatform: 0,
    }),
    25,
  );
});
