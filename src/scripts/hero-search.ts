/**
 * The homepage search.
 *
 * Every problem is already in the page as JSON, so this is a substring match
 * over an in-memory array — no request, no debounce worth the name, no
 * library. Twenty-five records is not a search problem; pretending it is
 * would be the tell.
 *
 * The input is inside a real form that submits to /problems, so with no
 * JavaScript the box still takes you somewhere useful. This only upgrades it.
 */
import { url } from '../lib/url';

interface Row {
  slug: string;
  title: string;
  app: string;
  category: string;
  family: string;
  score: number;
  verdict: string;
  hay: string;
}

const MAX = 6;

export function initHeroSearch(): void {
  const rootEl = document.querySelector<HTMLElement>('[data-hero-search]');
  const inputEl = rootEl?.querySelector<HTMLInputElement>('[data-hero-input]');
  const panelEl = rootEl?.querySelector<HTMLElement>('[data-hero-results]');
  const listEl = rootEl?.querySelector<HTMLUListElement>('[data-hero-list]');
  const noneEl = rootEl?.querySelector<HTMLElement>('[data-hero-none]');
  const raw = rootEl?.querySelector<HTMLScriptElement>('[data-hero-index]');
  if (!rootEl || !inputEl || !panelEl || !listEl || !noneEl || !raw) return;

  /* Re-bound as non-null so the closures below keep the narrowing. */
  const root = rootEl;
  const input = inputEl;
  const panel = panelEl;
  const list = listEl;
  const none = noneEl;

  let index: Row[] = [];
  try {
    index = JSON.parse(raw.textContent ?? '[]') as Row[];
  } catch {
    return;
  }

  /*
   * Every term has to appear somewhere in the record, in any order, so
   * "notion freeze" and "freeze notion" both find the same thing.
   */
  function find(query: string): Row[] {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    return index.filter((row) => terms.every((t) => row.hay.includes(t))).slice(0, MAX);
  }

  function render(rows: Row[], query: string): void {
    list.replaceChildren();

    for (const row of rows) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = url(`/problems/${row.slug}`);
      a.dataset.family = row.family;

      /* The glyph is cloned from a chip so the markup stays in one place. */
      const chipGlyph = root.querySelector(`[data-chip="${row.family}"] svg`);
      if (chipGlyph) a.append(chipGlyph.cloneNode(true));

      const text = document.createElement('span');
      const title = document.createElement('span');
      title.className = 'r-title';
      title.textContent = row.title;
      const app = document.createElement('span');
      app.className = 'r-app';
      app.textContent = `${row.app} · ${row.category}`;
      text.append(title, app);

      const score = document.createElement('span');
      score.className = 'r-score num';
      score.textContent = String(row.score);

      a.append(text, score);
      li.append(a);
      list.append(li);
    }

    const has = query.length > 0;
    panel.hidden = !has;
    none.hidden = rows.length > 0 || !has;
  }

  input.addEventListener('input', () => {
    const q = input.value.trim();
    render(find(q), q);
  });

  /* Enter opens the first match rather than submitting to the index page. */
  input.form?.addEventListener('submit', (e) => {
    const first = list.querySelector<HTMLAnchorElement>('a');
    if (first) {
      e.preventDefault();
      first.click();
    }
  });

  /* Escape clears, which is what a search field is expected to do. */
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    input.value = '';
    render([], '');
  });

  /* Down-arrow walks into the results and back out at the top. */
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const links = [...list.querySelectorAll<HTMLAnchorElement>('a')];
    if (links.length === 0) return;
    const at = links.indexOf(document.activeElement as HTMLAnchorElement);
    e.preventDefault();

    if (e.key === 'ArrowDown') {
      if (at === -1) links[0]!.focus();
      else links[Math.min(at + 1, links.length - 1)]!.focus();
    } else if (at <= 0) {
      input.focus();
    } else {
      links[at - 1]!.focus();
    }
  });

  document.addEventListener('astro:before-swap', () => render([], ''), { once: true });
}
