/**
 * One-shot reveal for the chart kit.
 *
 * Every chart renders in its finished state by default. This adds
 * `data-revealed` the first time a chart enters the viewport, which is what
 * the CSS animations key off, and then stops watching it.
 *
 * Deliberately not `animation-timeline: view()`. A scroll-driven timeline
 * re-runs every time the element scrolls back into view, which is the
 * animate-on-scroll tell, and the motion inventory allows each chart exactly
 * one entry. Once revealed, an element is never un-revealed.
 *
 * Under a reduced-motion preference nothing is observed at all: the charts are
 * already correct without the class, so the whole mechanism is skipped.
 */
const REVEALED = 'data-revealed';

let observer: IntersectionObserver | null = null;

function reveal(el: Element): void {
  el.setAttribute(REVEALED, '');
}

export function watchCharts(): void {
  const targets = document.querySelectorAll(`[data-chart]:not([${REVEALED}])`);
  if (targets.length === 0) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    targets.forEach(reveal);
    return;
  }

  observer ??= new IntersectionObserver(
    (entries, io) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        reveal(entry.target);
        io.unobserve(entry.target);
      }
    },
    // A little early, so a chart is already settled by the time it is read.
    { rootMargin: '0px 0px -8% 0px', threshold: 0.15 },
  );

  for (const t of targets) observer.observe(t);
}

export function stopWatchingCharts(): void {
  observer?.disconnect();
  observer = null;
}
