/**
 * Four filters over the problem grid, client-side and instant.
 *
 * Every card is already in the DOM, so this only hides and reorders. FLIP on
 * the survivors, so a card travels to its new position rather than appearing
 * in it. Nothing is persisted: a remembered filter that hides most of the
 * page is a trap.
 */
export function initProblemFilters(): void {
  const root = document.querySelector<HTMLElement>('[data-problems]');
  const gridEl = root?.querySelector<HTMLElement>('[data-problems-grid]');
  if (!root || !gridEl) return;
  const grid = gridEl;

  const cards = [...grid.querySelectorAll<HTMLElement>('[data-problem]')];
  const selects = [...root.querySelectorAll<HTMLSelectElement>('[data-filter]')];
  const chips = [...root.querySelectorAll<HTMLButtonElement>('[data-family-chip]')];
  const count = root.querySelector<HTMLElement>('[data-problems-count]');
  const empty = root.querySelector<HTMLElement>('[data-problems-empty]');

  /* The family chips are one exclusive choice, held here rather than read
     back out of the DOM on every card test. */
  let family = 'all';

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const css = getComputedStyle(document.documentElement);
  const duration = parseFloat(css.getPropertyValue('--dur-long')) || 420;
  const easing = css.getPropertyValue('--ease-out').trim() || 'ease-out';

  function matches(card: HTMLElement): boolean {
    if (family !== 'all' && card.dataset.familykey !== family) return false;
    for (const select of selects) {
      const key = select.dataset.filter!;
      const want = select.value;
      if (want === 'all') continue;
      const has = card.dataset[key] ?? '';
      // `platforms` is a space-separated list; everything else is one value.
      const ok = key === 'platforms' ? has.split(' ').includes(want) : has === want;
      if (!ok) return false;
    }
    return true;
  }

  function apply(): void {
    const first = new Map<HTMLElement, DOMRect>();
    if (!reduced.matches) {
      for (const card of cards) {
        if (!card.hidden) first.set(card, card.getBoundingClientRect());
      }
    }

    let shown = 0;
    for (const card of cards) {
      card.hidden = !matches(card);
      if (!card.hidden) shown += 1;
    }

    if (count) {
      count.textContent =
        shown === cards.length
          ? `${cards.length} problems`
          : `${shown} of ${cards.length} problems`;
    }
    if (empty) empty.hidden = shown > 0;

    if (reduced.matches) return;

    for (const [card, before] of first) {
      if (card.hidden) continue;
      const after = card.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) continue;
      card.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration, easing },
      );
    }
  }

  for (const select of selects) select.addEventListener('change', apply);

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      family = chip.dataset.familyChip ?? 'all';
      for (const c of chips) {
        c.setAttribute('aria-pressed', String(c === chip));
      }
      apply();
    });
  }

  apply();
}
