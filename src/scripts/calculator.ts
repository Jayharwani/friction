/**
 * Wiring for the methodology page's score calculator.
 *
 * The arithmetic is not here. This reads the controls, builds a ComponentInputs
 * and hands it to the same three functions the pipeline uses. If this file
 * disagrees with the pipeline it is because the pipeline changed, and
 * scoring.test.ts fails.
 *
 * scoring.ts imports only types from validate.ts, so nothing Node-only is
 * reachable from here.
 */
import type { ComponentInputs } from '../../scripts/validate';
import {
  COMPONENT_ORDER,
  WEIGHTS,
  componentsFromInputs,
  computeScore,
  decideVerdict,
} from '../lib/scoring';

interface Seed extends ComponentInputs {
  existingSolutionsCount: number;
  threshold: number;
}

export function initCalculator(): void {
  const root = document.querySelector<HTMLElement>('[data-calc]');
  if (!root) return;

  const seed = JSON.parse(root.dataset.seed ?? '{}') as Seed;
  const inputs = [...root.querySelectorAll<HTMLInputElement>('[data-calc-input]')];
  const scoreEl = root.querySelector<HTMLElement>('[data-calc-score]');
  const verdictEl = root.querySelector<HTMLElement>('[data-calc-verdict]');
  const reset = root.querySelector<HTMLButtonElement>('[data-calc-reset]');

  function field(name: string): HTMLInputElement | undefined {
    return inputs.find((i) => i.name === name);
  }

  function value(name: string, fallback: number): number {
    const el = field(name);
    if (!el) return fallback;
    return el.type === 'checkbox' ? (el.checked ? 1 : 0) : Number(el.value);
  }

  function update(): void {
    const crossPlatform = value('crossPlatform', 0) === 1;
    const uniqueReviewers = value('uniqueReviewers', seed.uniqueReviewers);

    const current: ComponentInputs = {
      uniqueReviewers,
      weeksWithEvidence: value('weeksWithEvidence', seed.weeksWithEvidence),
      daysSinceLastSeen: value('daysSinceLastSeen', seed.daysSinceLastSeen),
      meanRating: value('meanRating', seed.meanRating),
      churnReviewers: value('churnReviewers', seed.churnReviewers),
      distinctVersions: value('distinctVersions', seed.distinctVersions),
      platforms: crossPlatform ? ['ios', 'android'] : ['ios'],
      /* Severity is only scored when there is evidence in the window; with no
         reviewers at all there is nothing to average. */
      evidenceInWindow: Math.max(uniqueReviewers, 0),
    };

    const components = componentsFromInputs(current);
    const score = computeScore(components);
    const existingSolutionsCount = value('existingSolutionsCount', seed.existingSolutionsCount);

    if (scoreEl) scoreEl.textContent = String(score);
    if (verdictEl) {
      verdictEl.textContent = decideVerdict({
        uniqueReviewers,
        existingSolutionsCount,
        score,
        buildThreshold: seed.threshold,
      });
    }

    for (const key of COMPONENT_ORDER) {
      const row = root!.querySelector<HTMLElement>(`[data-calc-row="${key}"]`);
      const fill = row?.querySelector<HTMLElement>('.p-fill');
      const points = root!.querySelector<HTMLElement>(`[data-calc-points="${key}"]`);
      if (fill) fill.style.setProperty('--v', `${(components[key] * 100).toFixed(1)}%`);
      if (points) {
        points.childNodes[0]!.nodeValue = (components[key] * WEIGHTS[key] * 100).toFixed(1);
      }
    }

    // Echo each control's value beside it.
    for (const out of root!.querySelectorAll<HTMLOutputElement>('[data-calc-out]')) {
      const name = out.dataset.calcOut!;
      const el = field(name);
      if (el) out.textContent = el.value;
    }
  }

  for (const input of inputs) input.addEventListener('input', update);

  reset?.addEventListener('click', () => {
    for (const input of inputs) {
      if (input.type === 'checkbox') {
        input.checked = seed.platforms.length === 2;
        continue;
      }
      const key = input.name as keyof Seed;
      const v = seed[key];
      if (typeof v === 'number') input.value = String(v);
    }
    update();
  });

  update();
}
