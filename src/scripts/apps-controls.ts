/**
 * Sort, filter and view controls for the apps grid.
 *
 * Entirely client-side and instant: every card is already in the DOM, so this
 * only reorders and hides. Reordering runs through FLIP, so a card visibly
 * travels to its new position rather than teleporting.
 *
 * The view choice is the only thing persisted. Sort and filter are per-visit:
 * a remembered filter that hides most of the page is a trap.
 */
const VIEW_KEY = 'friction-apps-view';

type Sort = 'problems' | 'reviews' | 'name';

function read(el: Element, key: string): string {
  return (el as HTMLElement).dataset[key] ?? '';
}

function num(el: Element, key: string): number {
  return Number(read(el, key)) || 0;
}

export function initAppsControls(): void {
  const gridEl = document.querySelector<HTMLElement>('[data-apps-grid]');
  if (!gridEl) return;
  const grid = gridEl;

  const cards = [...grid.querySelectorAll<HTMLElement>('[data-app]')];
  const sortInputs = document.querySelectorAll<HTMLInputElement>('[name="apps-sort"]');
  const platformSelect = document.querySelector<HTMLSelectElement>('[data-filter-platform]');
  const categorySelect = document.querySelector<HTMLSelectElement>('[data-filter-category]');
  const count = document.querySelector<HTMLElement>('[data-apps-count]');
  const viewInputs = document.querySelectorAll<HTMLInputElement>('[name="apps-view"]');
  const root = document.querySelector<HTMLElement>('[data-apps]');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Read from the tokens rather than restated here, so the reorder cannot
     drift away from the rest of the motion system. */
  const css = getComputedStyle(document.documentElement);
  /* FLIP is a position change, so it takes a spatial curve and overshoots. */
  const duration = parseFloat(css.getPropertyValue('--dur-spatial-default')) || 500;
  const easing = css.getPropertyValue('--spatial-default').trim() || 'ease-out';

  function currentSort(): Sort {
    for (const input of sortInputs) if (input.checked) return input.value as Sort;
    return 'problems';
  }

  function apply(): void {
    const platform = platformSelect?.value ?? 'all';
    const category = categorySelect?.value ?? 'all';
    const sort = currentSort();

    // FLIP: measure before, mutate, measure after, invert, play.
    const first = new Map<HTMLElement, DOMRect>();
    if (!reduced.matches) {
      for (const card of cards) {
        if (card.hidden) continue;
        first.set(card, card.getBoundingClientRect());
      }
    }

    let shown = 0;
    for (const card of cards) {
      const okPlatform = platform === 'all' || read(card, 'platforms').split(' ').includes(platform);
      const okCategory = category === 'all' || read(card, 'category') === category;
      card.hidden = !(okPlatform && okCategory);
      if (!card.hidden) shown += 1;
    }

    const ordered = [...cards].sort((a, b) => {
      if (sort === 'name') return read(a, 'name').localeCompare(read(b, 'name'));
      if (sort === 'reviews') {
        return num(b, 'reviews') - num(a, 'reviews') || read(a, 'name').localeCompare(read(b, 'name'));
      }
      return num(b, 'problems') - num(a, 'problems') || read(a, 'name').localeCompare(read(b, 'name'));
    });
    for (const card of ordered) grid.append(card);

    if (count) {
      count.textContent =
        shown === cards.length
          ? `${cards.length} apps`
          : `${shown} of ${cards.length} apps`;
    }

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

  function applyView(view: string, persist: boolean): void {
    root?.setAttribute('data-view', view);
    for (const input of viewInputs) input.checked = input.value === view;
    if (!persist) return;
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // Storage blocked; the choice still applies for this page.
    }
  }

  for (const input of sortInputs) input.addEventListener('change', apply);
  platformSelect?.addEventListener('change', apply);
  categorySelect?.addEventListener('change', apply);
  for (const input of viewInputs) {
    input.addEventListener('change', () => applyView(input.value, true));
  }

  let saved: string | null = null;
  try {
    saved = localStorage.getItem(VIEW_KEY);
  } catch {
    saved = null;
  }
  if (saved === 'grid' || saved === 'table') applyView(saved, false);

  apply();
}
