/**
 * Command palette behaviour.
 *
 * Fuzzy matching is a subsequence test with a small score: every query
 * character must appear in order, and matches that start a word or sit nearer
 * the front rank higher. That is enough for twenty-five problems and fifteen
 * apps, and it needs no dependency.
 *
 * The native <dialog> supplies the focus trap, the Escape key and the inert
 * background. Everything here is keyboard-first: arrows move, Enter opens.
 */
interface Entry {
  title: string;
  meta: string;
  href: string;
  kind: string;
  haystack: string;
}

const MAX_RESULTS = 8;

/**
 * Subsequence score, or null when the query does not fit.
 * Lower is better: it counts how far the match had to travel.
 */
function score(haystack: string, query: string): number | null {
  let at = 0;
  let total = 0;
  for (const ch of query) {
    const found = haystack.indexOf(ch, at);
    if (found === -1) return null;
    // A character that starts a word costs nothing; a jump costs distance.
    const startsWord = found === 0 || haystack[found - 1] === ' ';
    total += startsWord ? 0 : found - at + 1;
    at = found + 1;
  }
  return total;
}

export function initPalette(): { destroy(): void } | null {
  const dialog = document.querySelector<HTMLDialogElement>('[data-palette]');
  if (!dialog) return null;

  const raw = dialog.querySelector<HTMLScriptElement>('[data-palette-index]');
  const input = dialog.querySelector<HTMLInputElement>('[data-palette-input]');
  const list = dialog.querySelector<HTMLUListElement>('[data-palette-results]');
  const status = dialog.querySelector<HTMLElement>('[data-palette-status]');
  const empty = dialog.querySelector<HTMLElement>('[data-palette-empty]');
  if (!raw || !input || !list || !status || !empty) return null;

  const index = JSON.parse(raw.textContent ?? '[]') as Entry[];
  let shown: Entry[] = [];
  let active = 0;
  /** Restored when the dialog closes, per the focus-return rule. */
  let opener: HTMLElement | null = null;

  function render(): void {
    const query = input!.value.trim().toLowerCase();

    shown = query
      ? index
          .map((e) => ({ e, s: score(e.haystack, query) }))
          .filter((r): r is { e: Entry; s: number } => r.s !== null)
          .sort((a, b) => a.s - b.s || a.e.title.length - b.e.title.length)
          .slice(0, MAX_RESULTS)
          .map((r) => r.e)
      : index.slice(0, MAX_RESULTS);

    active = 0;
    list!.replaceChildren(
      ...shown.map((e, i) => {
        const li = document.createElement('li');
        li.id = `palette-r${i}`;
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', String(i === 0));

        const left = document.createElement('span');
        const title = document.createElement('span');
        title.className = 'r-title';
        title.textContent = e.title;
        const meta = document.createElement('span');
        meta.className = 'r-meta';
        meta.textContent = e.meta;
        left.append(title, meta);

        const kind = document.createElement('span');
        kind.className = 'r-kind';
        kind.textContent = e.kind;

        li.append(left, kind);
        li.addEventListener('click', () => go(i));
        return li;
      }),
    );

    const n = query ? shown.length : index.length;
    status!.textContent = `${n} ${n === 1 ? 'result' : 'results'}`;
    empty!.hidden = shown.length > 0;
    input!.setAttribute('aria-activedescendant', shown.length ? 'palette-r0' : '');
  }

  function highlight(next: number): void {
    if (shown.length === 0) return;
    active = (next + shown.length) % shown.length;
    const items = [...list!.children];
    items.forEach((li, i) => li.setAttribute('aria-selected', String(i === active)));
    items[active]?.scrollIntoView({ block: 'nearest' });
    input!.setAttribute('aria-activedescendant', `palette-r${active}`);
  }

  function go(i: number): void {
    const entry = shown[i];
    if (!entry) return;
    dialog!.close();
    window.location.href = entry.href;
  }

  function open(): void {
    if (dialog!.open) return;
    opener = document.activeElement as HTMLElement | null;
    input!.value = '';
    render();
    dialog!.showModal();
    input!.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    const isOpenCombo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
    if (isOpenCombo) {
      event.preventDefault();
      dialog!.open ? dialog!.close() : open();
      return;
    }
    if (!dialog!.open) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlight(active + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlight(active - 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      go(active);
    }
  }

  function onClose(): void {
    opener?.focus();
    opener = null;
  }

  /* Clicking the backdrop closes: the dialog fills its own box, so a click
     that lands on the dialog element itself is a click outside the panel. */
  function onDialogClick(event: MouseEvent): void {
    if (event.target === dialog) dialog!.close();
  }

  input.addEventListener('input', render);
  document.addEventListener('keydown', onKeydown);
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('click', onDialogClick);

  for (const trigger of document.querySelectorAll('[data-palette-open]')) {
    trigger.addEventListener('click', open);
  }

  render();

  return {
    destroy() {
      document.removeEventListener('keydown', onKeydown);
      dialog.removeEventListener('close', onClose);
      dialog.removeEventListener('click', onDialogClick);
    },
  };
}
