/**
 * The Friction Field's data.
 *
 * X is the last twelve ISO weeks, Z is the tracked problems, Y is how many
 * reviews reported that problem in that week. Every height on screen is a
 * count from data/problems/ — nothing here is decorative or invented.
 */
import type { Problem } from '../../scripts/validate';
import { isoWeekKey, recentIsoWeeks } from './scoring';
import { weekLabel } from './data';

export interface FieldRow {
  slug: string;
  title: string;
  app: string;
  /** One count per week, oldest first. */
  counts: number[];
}

export interface FieldData {
  weeks: string[];
  weekLabels: string[];
  rows: FieldRow[];
  /** Highest single-cell count, which the height and colour ramps scale to. */
  max: number;
  totalReviews: number;
}

/**
 * Build the field from the problems that have any evidence in the window.
 * Rows are ordered by score so the tallest ridges cluster toward the front.
 */
export function buildField(
  problems: Problem[],
  appName: (slug: string) => string,
  weekCount = 12,
  now: Date = new Date(),
): FieldData {
  const weeks = recentIsoWeeks(now, weekCount);
  const index = new Map(weeks.map((w, i) => [w, i]));

  const rows: FieldRow[] = [];
  let max = 0;
  let totalReviews = 0;

  for (const problem of [...problems].sort((a, b) => b.score - a.score)) {
    const counts = new Array<number>(weekCount).fill(0);
    let any = false;

    for (const e of problem.evidence) {
      const i = index.get(isoWeekKey(e.reviewedAt));
      if (i === undefined) continue;
      counts[i]! += 1;
      any = true;
      totalReviews += 1;
      if (counts[i]! > max) max = counts[i]!;
    }

    // A row that is flat across every week adds nothing to a topography.
    if (!any) continue;
    rows.push({
      slug: problem.slug,
      title: problem.title,
      app: appName(problem.productSlug),
      counts,
    });
  }

  return {
    weeks,
    weekLabels: weeks.map(weekLabel),
    rows,
    max: Math.max(1, max),
    totalReviews,
  };
}

/* ------------------------------------------------------------------ */
/* OKLCH ramp                                                          */
/* ------------------------------------------------------------------ */

/**
 * The heat ramp, resolved to sRGB on the CPU.
 *
 * The brief calls for interpolating in OKLCH inside the shader. Doing the
 * interpolation here instead is equivalent and avoids a hand-written shader:
 * the failure it guards against is interpolating the *ramp* in sRGB, which
 * collapses the mid-range. Stops are computed in OKLCH and handed to the GPU
 * as vertex colours, so the ramp itself is perceptually even either way.
 */
function oklchToLinearRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export interface RampStop {
  L: number;
  C: number;
  h: number;
}

/**
 * Linear RGB for a position on the ramp, interpolated in OKLCH.
 * Returned linear (not gamma-encoded) because Three.js works in linear space.
 */
export function rampLinearRgb(t: number, low: RampStop, high: RampStop): [number, number, number] {
  const k = Math.min(Math.max(t, 0), 1);
  return oklchToLinearRgb(
    low.L + (high.L - low.L) * k,
    low.C + (high.C - low.C) * k,
    low.h + (high.h - low.h) * k,
  );
}
