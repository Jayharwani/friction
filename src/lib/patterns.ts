/**
 * Cross-app patterns.
 *
 * A complaint in one app is a bug. The same complaint across nine apps is a
 * market. The site has always had the data for that and never shown it.
 *
 * A pattern is one category appearing in three or more apps. Everything here
 * is counted from the committed problems — nothing is written by a model and
 * nothing is estimated. The one generated field on the whole site, the "gap"
 * line, is produced by the pipeline and stored; this module only reads it.
 */
import type { Category, Problem } from '../../scripts/validate';

/** A category has to reach this many apps before it is a pattern. */
export const PATTERN_MIN_APPS = 3;

export interface PatternExample {
  slug: string;
  title: string;
  productSlug: string;
  score: number;
  verdict: string;
}

export interface Pattern {
  category: Category;
  /** Slugs of every app with an active problem in this category. */
  apps: string[];
  problemCount: number;
  /** Distinct reviewers, summed across the pattern's problems. */
  reviewers: number;
  /** Apps affected as a fraction of every tracked app. */
  reach: number;
  /** Workarounds people described, deduplicated across the pattern. */
  workarounds: string[];
  /** Products reviewers named as already solving it. */
  existing: string[];
  /** Highest-scoring problems in the pattern. */
  examples: PatternExample[];
  /**
   * The one written field on the site: a sentence describing what nobody
   * offers, produced from this pattern's evidence by a prompted model step
   * (scripts/gap-prompt.md) and committed to data/gaps.json. Undefined when
   * no line has been written — a missing gap is correct, an invented one is
   * not — and always labelled as written wherever it is shown.
   */
  gap?: { line: string; writtenBy: string; writtenAt: string };
}

/**
 * Build the patterns from active problems.
 *
 * `trackedApps` is the full tracked set, not the set with findings: reach is
 * "how much of what we watch does this affect", so the denominator has to be
 * everything watched.
 */
export function buildPatterns(
  active: Problem[],
  trackedApps: number,
  gaps: Record<string, { line: string; writtenBy: string; writtenAt: string }> = {},
): Pattern[] {
  const byCategory = new Map<Category, Problem[]>();
  for (const problem of active) {
    const list = byCategory.get(problem.category);
    if (list) list.push(problem);
    else byCategory.set(problem.category, [problem]);
  }

  const patterns: Pattern[] = [];

  for (const [category, problems] of byCategory) {
    const apps = [...new Set(problems.map((p) => p.productSlug))].sort();
    if (apps.length < PATTERN_MIN_APPS) continue;

    patterns.push({
      category,
      apps,
      problemCount: problems.length,
      /*
       * Summed per problem rather than deduplicated across the pattern:
       * reviewer hashes are salted per run and a person who reported the same
       * category in two apps is two reports, which is what this counts.
       */
      reviewers: problems.reduce((n, p) => n + p.inputs.uniqueReviewers, 0),
      reach: apps.length / Math.max(1, trackedApps),
      workarounds: dedupe(problems.flatMap((p) => p.workarounds)).slice(0, 6),
      existing: dedupe(problems.flatMap((p) => p.existingSolutions)).slice(0, 6),
      gap: gaps[category],
      examples: [...problems]
        .sort((a, b) => b.score - a.score)
        .slice(0, 2)
        .map((p) => ({
          slug: p.slug,
          title: p.title,
          productSlug: p.productSlug,
          score: p.score,
          verdict: p.verdict,
        })),
    });
  }

  // Most reported first: the pattern with the most people behind it leads.
  return patterns.sort((a, b) => b.reviewers - a.reviewers || b.apps.length - a.apps.length);
}

/** Case-insensitive dedupe that keeps the first spelling seen. */
function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const key = v.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(v.trim());
  }
  return out;
}
