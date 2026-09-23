/**
 * The four lenses, in the order they are always shown.
 *
 * Each borrows one of the eight category hues as its tone. That is the one
 * place the data palette is allowed near a UI element, and it is deliberate:
 * a lens is a *kind of thing*, the same way a family is, and the tones are
 * what make four cards distinguishable at a glance. They never appear on a
 * button, a link or a focus ring.
 */
import type { Problem } from '../../scripts/validate';
import { type Family, familyOf } from './categories';
import { PATTERN_MIN_APPS } from './patterns';

export const LENSES = ['build', 'start', 'study', 'write'] as const;
export type Lens = (typeof LENSES)[number];

export const LENS_LABEL: Record<Lens, string> = {
  build: 'Build it',
  start: 'Start it',
  study: 'Study it',
  write: 'Write it',
};

export const LENS_QUESTION: Record<Lens, string> = {
  build: 'What would fix this?',
  start: 'Is there a company here?',
  study: 'What does this open up?',
  write: 'What is the story?',
};

/** Which category hue each lens borrows. */
export const LENS_HUE: Record<Lens, string> = {
  build: 'var(--cat-stability)',
  start: 'var(--cat-money)',
  study: 'var(--cat-access)',
  write: 'var(--cat-support)',
};

/* ------------------------------------------------------------------ */
/* Lens fit                                                            */
/* ------------------------------------------------------------------ */

/**
 * Which lenses have something to work with on a given challenge.
 *
 * All four lenses are written for every published challenge, so "has a lens"
 * would be a dead control. This is the useful question instead: a founder
 * wants the challenges that could carry a company, a writer wants the ones
 * with enough voices to quote. Each rule keys on exactly one committed fact
 * and is stated on the page next to the filter, so nothing here is a hidden
 * judgement — a reader can check every answer against the data themselves.
 *
 * These thresholds are display thresholds. They do not live in scoring.ts
 * because nothing in the pipeline reads them: they decide what a filter
 * shows, never whether a challenge is published or what it is labelled.
 */
/** Families where the complaint is about behaviour an engineer can change. */
const BUILDABLE: readonly Family[] = ['stability', 'speed', 'data', 'wayfinding', 'interruption'];

/** Study needs a population: this many people, and both stores. */
export const STUDY_MIN_REVIEWERS = 4;

/** Writing needs voices. This many quotes to work from. */
export const WRITE_MIN_QUOTES = 5;

/**
 * What each rule checks, in the words shown beside the filter. Each one
 * completes the sentence "Showing challenges where ___", so it has to read
 * as a clause rather than a label.
 */
export const LENS_FIT_NOTE: Record<Lens, string> = {
  build: 'the failure is in how the app behaves, not what the company decided',
  start: `the same complaint runs across ${PATTERN_MIN_APPS} or more apps`,
  study: `${STUDY_MIN_REVIEWERS} or more people reported it, on both stores`,
  write: `there are ${WRITE_MIN_QUOTES} or more quotes to work from`,
};

/**
 * `appsInCategory` is how many apps have an active problem in this one's
 * category — the same count /patterns is built from, passed in rather than
 * recomputed so the two can never disagree.
 */
export function lensFit(problem: Problem, appsInCategory: number, written = true): Lens[] {
  /* Nothing to filter to. A challenge with no written lenses is still on the
     index — it is real, and its voices are real — but it cannot answer a
     question nobody has answered for it. */
  if (!written) return [];

  const fits: Lens[] = [];
  if (BUILDABLE.includes(familyOf(problem.category))) fits.push('build');
  if (appsInCategory >= PATTERN_MIN_APPS) fits.push('start');
  if (problem.inputs.uniqueReviewers >= STUDY_MIN_REVIEWERS && problem.inputs.platforms.length > 1) {
    fits.push('study');
  }
  if (problem.evidence.length >= WRITE_MIN_QUOTES) fits.push('write');
  return fits;
}
