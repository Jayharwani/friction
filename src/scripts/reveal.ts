/**
 * One-shot reveal for the chart kit and the category glyphs.
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

/*
 * Both attributes, when both apply. A pattern card is a chart *and* carries a
 * glyph that draws on, and setting only one of them left its chart marks
 * permanently un-revealed — invisible under reduced motion, where nothing
 * else was ever going to set it.
 */
function reveal(el: Element): void {
  if (el.hasAttribute('data-chart')) el.setAttribute(REVEALED, '');
  if (el.hasAttribute('data-glyph-draw')) el.setAttribute(DRAWN, '');
}

/*
 * Two selectors, one mechanism. `[data-glyph-draw]` is a card whose family
 * glyph writes itself on once; `[data-chart]` is a chart whose marks rise.
 * Both are one-shot, both are already correct without the attribute.
 */
const DRAWN = 'data-drawn';

export function watchCharts(): void {
  const targets = [
    ...new Set([
      ...document.querySelectorAll(`[data-chart]:not([${REVEALED}])`),
      ...document.querySelectorAll(`[data-glyph-draw]:not([${DRAWN}])`),
    ]),
  ];
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
