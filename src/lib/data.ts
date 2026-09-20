/**
 * Typed loaders for data/.
 *
 * Everything is read once at build time and memoised — the site is static, so
 * these run during `astro build` and never in a browser. All loaders tolerate
 * missing or empty data so the site still builds before the first scan.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  ProblemSchema,
  ProductsFileSchema,
  RunsFileSchema,
  type Problem,
  type Product,
  type Run,
} from '../../scripts/validate';
import { computeBuildThreshold, isoWeekKey, recentIsoWeeks } from './scoring';

const DATA = join(process.cwd(), 'data');

function memo<T>(fn: () => T): () => T {
  let cached: T | undefined;
  let done = false;
  return () => {
    if (!done) {
      cached = fn();
      done = true;
    }
    return cached as T;
  };
}

/* ------------------------------------------------------------------ */
/* Loaders                                                             */
/* ------------------------------------------------------------------ */

export const getProblems = memo((): Problem[] => {
  const dir = join(DATA, 'problems');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ProblemSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
    .sort((a, b) => b.score - a.score);
});

export const getProducts = memo((): Product[] => {
  const path = join(DATA, 'products.json');
  if (!existsSync(path)) return [];
  return ProductsFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
});

/** Runs newest first. */
export const getRuns = memo((): Run[] => {
  const path = join(DATA, 'runs.json');
  if (!existsSync(path)) return [];
  return RunsFileSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).sort((a, b) =>
    b.date.localeCompare(a.date),
  );
});

export function getLatestRun(): Run | null {
  return getRuns()[0] ?? null;
}

/** Stale problems stay visible but are excluded from the homepage. */
export function getActiveProblems(): Problem[] {
  return getProblems().filter((p) => p.status === 'active');
}

export function getProduct(slug: string): Product | undefined {
  return getProducts().find((p) => p.slug === slug);
}

export function getProblem(slug: string): Problem | undefined {
  return getProblems().find((p) => p.slug === slug);
}

export function getProblemsForProduct(slug: string): Problem[] {
  return getProblems().filter((p) => p.productSlug === slug);
}

/**
 * Problems that received evidence in a given run, newest-scoring first.
 * Detected from `capturedAt` on the stored evidence rather than from the run
 * index, so it stays correct even if runs.json is trimmed.
 */
export function getProblemsFromRun(runDate: string): Problem[] {
  return getProblems().filter((p) =>
    p.evidence.some((e) => e.capturedAt.slice(0, 10) === runDate),
  );
}

/** Group problems by their product, preserving score order within each group. */
export function groupByProduct(problems: Problem[]): { product: Product; problems: Problem[] }[] {
  const groups = new Map<string, Problem[]>();
  for (const p of problems) {
    const list = groups.get(p.productSlug) ?? [];
    list.push(p);
    groups.set(p.productSlug, list);
  }

  return [...groups.entries()]
    .map(([slug, list]) => ({ product: getProduct(slug), problems: list }))
    .filter((g): g is { product: Product; problems: Problem[] } => g.product !== undefined)
    .sort((a, b) => a.product.name.localeCompare(b.product.name));
}

/** Products that actually have at least one problem recorded. */
export function getProductsWithProblems(): Product[] {
  const slugs = new Set(getProblems().map((p) => p.productSlug));
  return getProducts().filter((p) => slugs.has(p.slug));
}

/**
 * The current build threshold, computed from active scores exactly as
 * scripts/score.ts does. The methodology page prints this number.
 */
export function getBuildThreshold(): number {
  return computeBuildThreshold(getActiveProblems().map((p) => p.score));
}

/** Share of active problems currently carrying the "Strong signal" verdict. */
export function getPassRate(): number {
  const active = getActiveProblems();
  if (active.length === 0) return 0;
  return (active.filter((p) => p.verdict === 'Strong signal').length / active.length) * 100;
}

/* ------------------------------------------------------------------ */
/* Store links (spec 1.2)                                              */
/* ------------------------------------------------------------------ */

/**
 * Reviews have no stable public permalink on either store, so evidence links
 * to the app's review listing. Never to an invented per-review URL.
 */
export function storeListingUrl(
  platform: 'ios' | 'android',
  productSlug: string,
  country: string,
): string | null {
  const product = getProduct(productSlug);
  if (!product) return null;

  if (platform === 'ios') {
    if (!product.appleId) return null;
    return `https://apps.apple.com/${country}/app/id${product.appleId}?see-all=reviews`;
  }
  if (!product.playPackage) return null;
  return `https://play.google.com/store/apps/details?id=${product.playPackage}`;
}

export function storeName(platform: 'ios' | 'android'): string {
  return platform === 'ios' ? 'the App Store' : 'Google Play';
}

export function platformLabel(platform: 'ios' | 'android'): string {
  return platform === 'ios' ? 'iOS' : 'Android';
}

/** "iOS", "Android" or "iOS and Android" — always a word, never a colour. */
export function platformsLabel(platforms: ('ios' | 'android')[]): string {
  const labels = platforms.map(platformLabel);
  if (labels.length === 0) return 'Unknown';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

/* ------------------------------------------------------------------ */
/* Recurrence grid (homepage hero)                                     */
/* ------------------------------------------------------------------ */

export interface GridCell {
  week: string;
  count: number;
}

export interface GridRow {
  problem: Problem;
  cells: GridCell[];
}

export interface RecurrenceGrid {
  weeks: string[];
  rows: GridRow[];
  /** Highest single-cell count, used to scale the colour ramp. */
  max: number;
}

/**
 * Rows are the highest-scoring active problems, columns the last `weekCount`
 * ISO weeks. Each cell counts pieces of evidence dated in that week.
 */
export function buildRecurrenceGrid(
  problems: Problem[],
  weekCount = 12,
  rowCount = 12,
  now: Date = new Date(),
): RecurrenceGrid {
  const weeks = recentIsoWeeks(now, weekCount);
  const top = [...problems].sort((a, b) => b.score - a.score).slice(0, rowCount);

  let max = 0;
  const rows: GridRow[] = top.map((problem) => {
    const counts = new Map<string, number>();
    for (const e of problem.evidence) {
      const key = isoWeekKey(e.reviewedAt);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const cells = weeks.map((week) => {
      const count = counts.get(week) ?? 0;
      if (count > max) max = count;
      return { week, count };
    });
    return { problem, cells };
  });

  return { weeks, rows, max };
}

/**
 * Evidence volume per ISO week for one product, split by platform.
 * Drives the twelve-week trend on the product page.
 */
export function productTrend(
  problems: Problem[],
  weekCount = 12,
  now: Date = new Date(),
): { weeks: string[]; ios: number[]; android: number[]; max: number } {
  const weeks = recentIsoWeeks(now, weekCount);
  const ios = new Array(weekCount).fill(0) as number[];
  const android = new Array(weekCount).fill(0) as number[];
  const index = new Map(weeks.map((w, i) => [w, i]));

  for (const p of problems) {
    for (const e of p.evidence) {
      const i = index.get(isoWeekKey(e.reviewedAt));
      if (i === undefined) continue;
      if (e.platform === 'ios') ios[i]! += 1;
      else android[i]! += 1;
    }
  }

  const max = Math.max(1, ...ios.map((v, i) => v + android[i]!));
  return { weeks, ios, android, max };
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const DATE_FMT = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** "17 Sep 2026" — unambiguous, and stable across build machines. */
export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

/** "2026-W38" -> "15 Sep", the Monday that starts that ISO week. */
export function weekLabel(weekKey: string): string {
  const [yearStr, weekStr] = weekKey.split('-W');
  const year = Number(yearStr);
  const week = Number(weekStr);
  // 4 January is always in ISO week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1));
  const monday = new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(monday);
}
