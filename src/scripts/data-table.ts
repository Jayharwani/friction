/**
 * Sorting and entry for every DataTable on the page.
 *
 * Sorts on `data-sort-<key>` attributes rather than on cell text, so the
 * comparison never depends on how a number happens to be formatted — "1,284"
 * and "—" are both hostile to parseFloat, and neither is ever parsed here.
 *
 * Reordering is FLIP: measure, move, invert, play. The rows travel to their
 * new positions instead of blinking into them, which is the one moment that
 * makes a table feel built rather than generated.
 *
 * Everything is one-shot and attribute-driven. No scroll handler, no frame
 * loop, no state in JavaScript that the DOM does not already hold.
 */

const ENTERED = 'data-entered';

function rowsOf(table: HTMLElement): HTMLElement[] {
  const body = table.querySelector('[data-table-body]');
  return body ? [...body.querySelectorAll<HTMLElement>('tr')] : [];
}

/**
 * Always ascending. The direction is applied once, by the caller.
 *
 * This used to return descending for numbers and ascending for text, so the
 * two halves of the sort disagreed about what `desc` meant and a text column
 * arrived Z-to-A while announcing itself as ascending.
 */
function compare(a: string, b: string, numeric: boolean): number {
  if (numeric) return Number(a) - Number(b);
  return a.localeCompare(b, 'en', { sensitivity: 'base' });
}

function sortTable(table: HTMLElement, key: string, numeric: boolean, desc: boolean): void {
  const body = table.querySelector<HTMLElement>('[data-table-body]');
  if (!body) return;

  const rows = rowsOf(table);
  if (rows.length < 2) return;

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = getComputedStyle(document.documentElement);
  const duration = parseFloat(css.getPropertyValue('--dur-long')) || 420;
  const easing = css.getPropertyValue('--ease-out').trim() || 'ease-out';

  /* FIRST: where every row is before anything moves. */
  const first = new Map<HTMLElement, number>();
  if (!reduced) for (const r of rows) first.set(r, r.getBoundingClientRect().top);

  const sorted = [...rows].sort((x, y) => {
    const av = x.dataset[`sort${key[0]!.toUpperCase()}${key.slice(1)}`] ?? '';
    const bv = y.dataset[`sort${key[0]!.toUpperCase()}${key.slice(1)}`] ?? '';
    const r = compare(av, bv, numeric);
    return desc ? -r : r;
  });

  body.append(...sorted);

  /* Re-number so the entry stagger and the bar fills stay in visual order. */
  sorted.forEach((r, i) => r.style.setProperty('--row-i', String(i)));

  if (reduced) return;

  /* LAST, INVERT, PLAY. */
  for (const r of sorted) {
    const before = first.get(r);
    if (before === undefined) continue;
    const delta = before - r.getBoundingClientRect().top;
    if (delta === 0) continue;
    r.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: 'none' }],
      { duration, easing },
    );
  }
}

function wire(table: HTMLElement): void {
  const heads = [...table.querySelectorAll<HTMLButtonElement>('[data-sort]')];

  for (const button of heads) {
    button.addEventListener('click', () => {
      const key = button.dataset.sort!;
      const numeric = button.dataset.numeric !== undefined;
      const th = button.closest('th')!;
      /* A fresh column opens the way its type reads best: numbers high
         first, names from A. Clicking the active column flips it. */
      const active = th.getAttribute('aria-sort');
      const desc = active === 'descending' ? false : active === 'ascending' ? true : numeric;

      for (const other of heads) {
        const otherTh = other.closest('th');
        if (otherTh && otherTh !== th) otherTh.setAttribute('aria-sort', 'none');
      }
      th.setAttribute('aria-sort', desc ? 'descending' : 'ascending');
      table.dataset.sortKey = key;

      sortTable(table, key, numeric, desc);
    });
  }
}

let observer: IntersectionObserver | null = null;

export function initDataTables(): void {
  const tables = [...document.querySelectorAll<HTMLElement>('[data-table]')];
  if (tables.length === 0) return;

  for (const t of tables) {
    wire(t);
    rowsOf(t).forEach((r, i) => r.style.setProperty('--row-i', String(i)));
  }

  /* The entry runs once, when the table is first looked at. Under reduced
     motion the attribute goes on immediately: the rows are already correct
     without it, and the CSS that keys off it does not exist there. */
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    for (const t of tables) t.setAttribute(ENTERED, '');
    return;
  }

  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries, io) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute(ENTERED, '');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -5% 0px', threshold: 0.05 },
  );
  for (const t of tables) {
    if (!t.hasAttribute(ENTERED)) observer.observe(t);
  }

  document.addEventListener('astro:before-swap', () => observer?.disconnect(), { once: true });
}

/** Hide rows that a filter rejected, and show the empty state when none remain. */
export function applyTableFilter(table: HTMLElement, keep: (row: HTMLElement) => boolean): void {
  const empty = table.querySelector<HTMLElement>('[data-table-empty]');
  let shown = 0;
  for (const row of rowsOf(table)) {
    const ok = keep(row);
    row.hidden = !ok;
    if (ok) shown += 1;
  }
  if (empty) empty.hidden = shown > 0;
}
