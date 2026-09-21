/**
 * The words the site has to teach, and a tracker so it teaches each one once.
 *
 * A page where every instance of "score" carries a dotted underline is noisier
 * than one where none does. `firstUse` returns true the first time a term is
 * asked for during a render and false afterwards, so the marker lands on the
 * first appearance and nowhere else.
 *
 * Definitions are in plain language on purpose: these exist for a reader who
 * has not opened the methodology page and should not have to.
 */
import type { Verdict } from '../../scripts/validate';

export const TERMS: Record<string, string> = {
  score:
    'How much evidence there is for a problem, out of 100 — not how serious it is.',
  'Strong signal':
    'More evidence than most problems have: enough different people, over enough weeks, recently enough.',
  Recurring:
    'Real and repeated, but with less evidence than most problems have.',
  'Thin evidence':
    'Fewer than four different people have reported it so far.',
  'Already solved':
    'Three or more shipping products already address this.',
};

export function definitionFor(term: string): string | undefined {
  return TERMS[term];
}

/**
 * One tracker per page render.
 *
 * Astro renders each page in its own module scope, but components are shared,
 * so the tracker is created by the page and passed down rather than living as
 * a module-level set that would leak between pages in one build.
 */
export function createTermTracker(): (term: string) => boolean {
  const seen = new Set<string>();
  return (term: string) => {
    if (seen.has(term)) return false;
    seen.add(term);
    return true;
  };
}

export type { Verdict };
