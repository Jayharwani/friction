/**
 * Build-time data shaping for the chart kit.
 *
 * Every function here runs during `astro build` and nothing in it ships to the
 * browser. The charts are inline SVG generated from these numbers, so there is
 * no charting library and no client-side data.
 *
 * Nothing here smooths, interpolates or pads a series. A problem with one week
 * of evidence produces a series with one non-zero week, and the chart shows
 * exactly that.
 */
import type { Evidence, Platform, Problem, Verdict } from '../../scripts/validate';
import { VERDICTS } from '../../scripts/validate';
import { isoWeekKey, recentIsoWeeks } from './scoring';
import { weekLabel } from './data';

export interface WeeklySeries {
  /** ISO week keys, oldest first. */
  weeks: string[];
  /** Human labels for the same weeks. */
  labels: string[];
  counts: number[];
  /** Highest single week, floored at 1 so a flat series still divides. */
  max: number;
  total: number;
}

/** Evidence bucketed into the last `weekCount` ISO weeks. */
export function weeklySeries(
  evidence: Evidence[],
  weekCount = 12,
  now: Date = new Date(),
): WeeklySeries {
  const weeks = recentIsoWeeks(now, weekCount);
  const index = new Map(weeks.map((w, i) => [w, i]));
  const counts = new Array<number>(weekCount).fill(0);
  let total = 0;

  for (const e of evidence) {
    const i = index.get(isoWeekKey(e.reviewedAt));
    if (i === undefined) continue;
    counts[i]! += 1;
    total += 1;
  }

  return {
    weeks,
    labels: weeks.map(weekLabel),
    counts,
    max: Math.max(1, ...counts),
    total,
  };
}

/** The same buckets, split by store, for a two-series trend. */
export function weeklyByPlatform(
  evidence: Evidence[],
  weekCount = 12,
  now: Date = new Date(),
): { ios: WeeklySeries; android: WeeklySeries; max: number; labels: string[] } {
  const ios = weeklySeries(evidence.filter((e) => e.platform === 'ios'), weekCount, now);
  const android = weeklySeries(evidence.filter((e) => e.platform === 'android'), weekCount, now);
  const max = Math.max(
    1,
    ...ios.counts.map((n, i) => n + android.counts[i]!),
  );
  return { ios, android, max, labels: ios.labels };
}

export interface Segment {
  label: string;
  value: number;
}

/** How many problems carry each verdict, in the canonical verdict order. */
export function verdictMix(problems: Problem[]): Segment[] {
  return VERDICTS.map((verdict: Verdict) => ({
    label: verdict,
    value: problems.filter((p) => p.verdict === verdict).length,
  })).filter((s) => s.value > 0);
}

/** How many problems sit in each category, largest first. */
export function categoryMix(problems: Problem[]): Segment[] {
  const counts = new Map<string, number>();
  for (const p of problems) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

/** How the evidence divides between the two stores. */
export function platformSplit(evidence: Evidence[]): Segment[] {
  const labels: Record<Platform, string> = { ios: 'iOS', android: 'Android' };
  return (['ios', 'android'] as Platform[])
    .map((p) => ({ label: labels[p], value: evidence.filter((e) => e.platform === p).length }))
    .filter((s) => s.value > 0);
}

/** The five extracted signals, as counts, in a fixed order. */
export const SIGNAL_LABELS = [
  ['churnIntent', 'said they were leaving'],
  ['regressionClaim', 'worked before an update'],
  ['workaroundDescribed', 'described a workaround'],
  ['billingComplaint', 'about billing'],
  ['competitorNamed', 'named a competitor'],
] as const;

export function signalCounts(evidence: Evidence[]): { key: string; label: string; count: number }[] {
  return SIGNAL_LABELS.map(([key, label]) => ({
    key,
    label,
    count: evidence.filter((e) => e.signals[key]).length,
  }));
}

export interface Bucket {
  from: number;
  to: number;
  count: number;
}

/**
 * Scores bucketed for the distribution chart. The range is taken from the data
 * and rounded out to bucket boundaries rather than assumed to be 0–100, so an
 * empty 0–35 stretch does not fill the chart with nothing.
 */
export function scoreBuckets(scores: number[], size = 5): Bucket[] {
  if (scores.length === 0) return [];
  const lo = Math.floor(Math.min(...scores) / size) * size;
  const hi = Math.ceil((Math.max(...scores) + 0.001) / size) * size;
  const buckets: Bucket[] = [];
  for (let from = lo; from < hi; from += size) {
    const to = from + size;
    buckets.push({
      from,
      to,
      count: scores.filter((s) => s >= from && s < to).length,
    });
  }
  return buckets;
}

export interface VersionMark {
  version: string;
  platform: Platform;
  count: number;
  /** ISO date this version was first reported. Stands in for release order. */
  first: string;
  last: string;
}

/**
 * Versions along a real time axis.
 *
 * Ordered by first report rather than by version number: the two stores number
 * independently, so 0.6.4100 and 1.7.338 do not sort against each other. The
 * date axis is also what makes the gaps between releases visible, which is the
 * point of the chart.
 */
export function versionMarks(problem: Problem): VersionMark[] {
  const byVersion = new Map<string, Evidence[]>();
  for (const e of problem.evidence) {
    if (!e.version) continue;
    const list = byVersion.get(e.version);
    if (list) list.push(e);
    else byVersion.set(e.version, [e]);
  }

  return [...byVersion.entries()]
    .map(([version, list]) => {
      const dates = list.map((e) => e.reviewedAt).sort();
      return {
        version,
        platform: list[0]!.platform,
        count: list.length,
        first: dates[0]!,
        last: dates.at(-1)!,
      };
    })
    .sort((a, b) => a.first.localeCompare(b.first));
}

/**
 * A position on the heat ramp as a color-mix percentage.
 *
 * The mix itself happens in CSS, in OKLCH, so the ramp is perceptually even.
 * Interpolating a heat ramp in sRGB is what turned the first version of the
 * recurrence grid into mud.
 */
export function heatPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round(Math.min(1, Math.max(0, value / max)) * 100);
}
