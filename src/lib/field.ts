/**
 * The Friction Field's data, assembled at build time.
 *
 * X is the last twelve ISO weeks, Z is the tracked problems, Y is how many
 * reviews reported that problem in that week. Every height on screen is a
 * count from data/problems/ — nothing here is decorative or invented.
 *
 * This module touches the filesystem through lib/data.ts, so it must never be
 * imported by client code. The browser side imports lib/ramp.ts instead.
 */
import type { Problem } from '../../scripts/validate';
import { isoWeekKey, recentIsoWeeks } from './scoring';
import { weekLabel } from './data';
import type { FieldData, FieldRow } from './ramp';

export type { FieldData, FieldRow } from './ramp';

/**
 * Build the field from the problems that have evidence in the window.
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

    // A row flat across every week adds nothing to a topography.
    if (!any) continue;
    rows.push({
      slug: problem.slug,
      title: problem.title,
      app: appName(problem.productSlug),
      category: problem.category,
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
