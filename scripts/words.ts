/**
 * The prose budget, enforced against the built HTML.
 *
 * Rebuild 5 sets a hard word count per page. A budget nobody measures is a
 * preference, so this measures it: it reads `dist/`, strips everything that is
 * data — problem titles, quotes, counts, labels, chart text, the collapsed
 * methodology — and counts what is left. What is left is prose, and prose is
 * what the budget is about.
 *
 *   npm run words          check every page against its budget
 *   npm run words -- --all list the count for every page, budget or not
 *
 * Exits non-zero if any page is over, so it can gate a build.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/** Hard limits, in words. A page not listed here is reported but not gated. */
const BUDGET: Record<string, number> = {
  'index.html': 110,
  'patterns/index.html': 80,
  'challenges/index.html': 60,
  'about/index.html': 120,
  'apps/index.html': 40,
  /* Raised from 160 when the page became seven full-bleed bands. Each one
     carries an eyebrow, a heading and a one-line lede, which is more visible
     prose than the single narrow column it replaced — while the 1,200-word
     methodology moved out of view into the FAQ's disclosures. More signposts,
     less reading.

     Raised again from 200 when v2 moved every chart here and folded in the
     archive: two more bands, each with its own signposting.

     Back to 200 in v4, and now it means something different: the page is
     four sections and one closed disclosure, and a collapsed <details> is
     already exempt, so this budget is exactly the "outside the disclosure"
     figure the spec asks for.

     140 in v5: four cards of thirty-five words each. The arithmetic moved
     to its own route, which is allowed to be as dense as it needs to be
     because it is reached by choice. */
  'how-it-works/index.html': 140,
};

/**
 * Budgets for whole families of generated pages, longest prefix wins. A
 * challenge page is mostly quotes and written lenses, both exempt; what is
 * left is the standing note about store links, the note about what was
 * written, and four headings. Eighty is the spec's number for that.
 */
const PREFIX_BUDGET: Array<[string, number]> = [['challenges/', 80]];

function budgetFor(file: string): number | null {
  if (file in BUDGET) return BUDGET[file]!;
  for (const [prefix, n] of PREFIX_BUDGET) if (file.startsWith(prefix)) return n;
  return null;
}

/**
 * Regions that are data, not prose. Everything inside these is exempt: the
 * budget is about how much the site explains itself in sentences, not about
 * how much evidence it shows.
 */
/* figcaption is here for the same reason .ch-caption is in EXEMPT_CLASS: the
   label under a chart names an axis, it is not a sentence the site wrote. */
const EXEMPT_TAGS = ['script', 'style', 'svg', 'head', 'nav', 'footer', 'table', 'details', 'dialog', 'figcaption'];

/**
 * Class names that mark an element as data: captions, figures, cards,
 * evidence, and the contents of a data component. An app's name, its store
 * category and a component's one-line definition are records, not sentences
 * the site wrote — they were exempt when they lived inside a <table> and
 * they do not become prose by moving into a card.
 *
 * `written-text` sits here for the same reason `gap` does. Both mark the
 * written half of the site: produced by the prompted step, committed to
 * data/, and carrying a "written" badge wherever they appear. They are the
 * content the site exists to show, not the site explaining itself, and a
 * budget that counted them would push toward showing fewer of them.
 *
 * It is that specific on purpose. The first version of this exemption was
 * `lens`, which also matched a section called `lenses` and silently exempted
 * a whole screen of real prose. An exemption has to name the thing it means.
 */
const EXEMPT_CLASS =
  /\b(?:ch-caption|num|quote|card|slide|listing|chips|plain|weights|evidence|sr-only|toc|wall|proof|w-body|gap|field|strip|axis|heat|spark|hist|flow|funnel|record|dots|cover|timeline|bar|scatter|panel|sum-note|meta|stat|written-text|app-cell|cat-cell|bento|run-card|matrix|compare|sig-|e-|f-|l-)/;

/**
 * Remove an element and everything inside it, matching tags rather than
 * stopping at the first `</…>`. A non-greedy regex cuts a card off at its
 * first child and leaves the rest of the card counted as prose, which is how
 * the first version of this script reported a 120-word page as 915.
 */
function cut(html: string, opens: (tag: string, attrs: string) => boolean): string {
  const VOID = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/i;
  const tag = /<(\/?)([a-z][a-z0-9-]*)([^>]*?)(\/?)>/gi;
  let out = '';
  let cutFrom = -1;
  let depth = 0;
  let last = 0;
  let m: RegExpExecArray | null;

  while ((m = tag.exec(html)) !== null) {
    const [full, slash, name, attrs, selfClose] = m;
    const closing = slash === '/';
    const empty = selfClose === '/' || VOID.test(name!);

    if (cutFrom === -1) {
      if (!closing && !empty && opens(name!.toLowerCase(), attrs ?? '')) {
        out += html.slice(last, m.index);
        cutFrom = m.index;
        depth = 1;
      }
      continue;
    }

    // Inside a cut region: track only the tag that opened it.
    if (name!.toLowerCase() === (html.slice(cutFrom).match(/^<([a-z0-9-]+)/i)?.[1] ?? '').toLowerCase()) {
      if (closing) depth -= 1;
      else if (!empty) depth += 1;
      if (depth === 0) {
        cutFrom = -1;
        last = m.index + full.length;
      }
    }
  }

  out += cutFrom === -1 ? html.slice(last) : '';
  return out;
}

function prose(html: string): string[] {
  /*
   * Only <main> counts. The wordmark, the search affordance, the theme
   * control and the footer are chrome: they appear on every page and no
   * per-page budget should be able to move them.
   */
  const main = /<main[^>]*>([\s\S]*)<\/main>/i.exec(html);
  let s = (main?.[1] ?? html).replace(/<!--[\s\S]*?-->/g, ' ');
  s = cut(s, (tag, attrs) => {
    if (EXEMPT_TAGS.includes(tag)) return true;
    const cls = /class="([^"]*)"/i.exec(attrs)?.[1];
    return cls !== undefined && EXEMPT_CLASS.test(cls);
  });
  s = s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A "word" is a run with at least one letter, so 1,284 and 63% are not prose.
  return s.split(' ').filter((w) => /[a-z]/i.test(w));
}

async function pages(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await pages(join(dir, entry.name), rel)));
    else if (entry.name.endsWith('.html')) out.push(rel);
  }
  return out;
}

const all = process.argv.includes('--all');
const dist = 'dist';

let files: string[];
try {
  files = (await pages(dist)).sort();
} catch {
  console.error('No dist/ — run `npm run build` first.');
  process.exit(1);
}

let over = 0;
const rows: Array<[string, number, number | null]> = [];

for (const file of files) {
  const budget = budgetFor(file);
  if (budget === null && !all) continue;
  const words = prose(await readFile(join(dist, file), 'utf8')).length;
  rows.push([file, words, budget]);
  if (budget !== null && words > budget) over += 1;
}

const width = Math.max(...rows.map((r) => r[0].length), 10);
for (const [file, words, budget] of rows) {
  const mark = budget === null ? ' ' : words > budget ? '!' : '·';
  const limit = budget === null ? '' : ` / ${budget}`;
  console.log(`${mark} ${file.padEnd(width)}  ${String(words).padStart(4)}${limit}`);
}

/* --show <page> prints the words the budget actually counted, so a cut can be
   aimed at real text rather than guessed at. */
const showIdx = process.argv.indexOf('--show');
if (showIdx !== -1) {
  const target = process.argv[showIdx + 1]!;
  console.log('\n--- counted prose on ' + target + ' ---\n');
  console.log(prose(await readFile(join(dist, target), 'utf8')).join(' '));
}

if (over > 0) {
  console.error(`\n${over} ${over === 1 ? 'page is' : 'pages are'} over budget.`);
  process.exit(1);
}
console.log(`\nAll ${rows.filter((r) => r[2] !== null).length} budgeted pages are within budget.`);
