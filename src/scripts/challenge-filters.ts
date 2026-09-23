/**
 * The three filters over the challenge grid.
 *
 * Every card is already in the DOM, so this hides, reorders and swaps — no
 * fetch, no template. FLIP on the survivors so a card travels to its new
 * position rather than appearing in it. Nothing is persisted: a remembered
 * filter that hides most of the page is a trap.
 *
 * The lens is not a fourth select. It both narrows the set and changes what
 * every surviving card says, which is why it is held here rather than read
 * back out of the DOM on each test.
 */
export function initChallengeFilters(): void {
  const root = document.querySelector<HTMLElement>('[data-challenges]');
  const gridEl = root?.querySelector<HTMLElement>('[data-challenges-grid]');
  if (!root || !gridEl) return;
  const grid = gridEl;

  const cards = [...grid.querySelectorAll<HTMLElement>('[data-challenge]')];
  const selects = [...root.querySelectorAll<HTMLSelectElement>('[data-filter]')];
  const chips = [...root.querySelectorAll<HTMLButtonElement>('[data-lens-chip]')];
  const count = root.querySelector<HTMLElement>('[data-challenges-count]');
  const empty = root.querySelector<HTMLElement>('[data-challenges-empty]');
  const why = root.querySelector<HTMLElement>('[data-lens-why]');

  /* The rule each lens keys on, in the same words the library states it in. */
  let notes: Record<string, string> = {};
  const notesEl = document.querySelector('[data-lens-notes]');
  if (notesEl?.textContent) {
    try {
      notes = JSON.parse(notesEl.textContent);
    } catch {
      /* A missing sentence is better than a broken filter. */
    }
  }

  const allWhy = why?.textContent ?? '';
  let lens = 'all';

  /*
   * The URL, once, at load. Not persistence — a remembered filter that hides
   * most of the page is a trap — but a link someone was handed. "Here are the
   * startup ones" has to survive being sent to somebody.
   */
  const params = new URLSearchParams(location.search);
  const wanted = params.get('lens');
  if (wanted && chips.some((c) => c.dataset.lensChip === wanted)) lens = wanted;
  for (const chip of chips) {
    chip.setAttribute('aria-pressed', String(chip.dataset.lensChip === lens));
  }
  for (const select of selects) {
    const from = params.get(select.dataset.filter === 'familykey' ? 'family' : 'app');
    if (from && [...select.options].some((o) => o.value === from)) select.value = from;
  }

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const css = getComputedStyle(document.documentElement);
  const duration = parseFloat(css.getPropertyValue('--dur-long')) || 420;
  const easing = css.getPropertyValue('--ease-out').trim() || 'ease-out';

  function matches(card: HTMLElement): boolean {
    if (lens !== 'all' && !(card.dataset.lensfit ?? '').split(' ').includes(lens)) return false;
    for (const select of selects) {
      const key = select.dataset.filter!;
      const want = select.value;
      if (want === 'all') continue;
      if ((card.dataset[key] ?? '') !== want) return false;
    }
    return true;
  }

  /** Show the chosen lens's proposition on a card, or the quote when none. */
  function say(card: HTMLElement): void {
    for (const line of card.querySelectorAll<HTMLElement>('[data-when]')) {
      line.hidden = line.dataset.when !== lens;
    }
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
      /* Said even when hidden: an unfiltered card must not come back stale. */
      say(card);
      card.hidden = !matches(card);
      if (!card.hidden) shown += 1;
    }

    if (count) {
      count.textContent =
        shown === cards.length
          ? `${cards.length} challenges`
          : `${shown} of ${cards.length} challenges`;
    }
    if (empty) empty.hidden = shown > 0;
    if (why) {
      why.textContent = lens === 'all' ? allWhy : `Showing challenges where ${notes[lens] ?? ''}.`;
    }

    if (reduced.matches) return;

    for (const [card, before] of first) {
      if (card.hidden) continue;
      const after = card.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (dx === 0 && dy === 0) continue;
      card.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration,
        easing,
      });
    }
  }

  for (const select of selects) select.addEventListener('change', apply);

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      lens = chip.dataset.lensChip ?? 'all';
      for (const c of chips) c.setAttribute('aria-pressed', String(c === chip));
      apply();
    });
  }

  apply();
}
