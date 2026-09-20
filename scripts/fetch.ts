/**
 * Pull reviews from the public stores, screen them, filter them, and write
 * this run's candidate file (spec 5.1 - 5.3).
 *
 * Apple is the backbone and must work. Google Play is an enhancement and its
 * failure is never fatal.
 *
 *   npm run fetch
 *   npm run fetch -- --only=notion,slack --pages=2      fast local run
 *   npm run fetch -- --raw --out=scratch/raw.json       skip screening, dump everything
 *
 * Requires AUTHOR_SALT. Without it reviewer hashes would be guessable, so the
 * script refuses to run rather than degrade quietly (spec 1.3).
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import {
  ProductsFileSchema,
  SeenFileSchema,
  RunsFileSchema,
  containsCrisisLanguage,
  blockedAppReason,
  type Candidate,
  type Product,
  type Run,
  type FunnelStage,
  type Seen,
} from './validate';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const DATA = join(ROOT, 'data');

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

/** One request per second per host, serialised (spec 1.1). */
const RATE_LIMIT_MS = 1000;
const TIMEOUT_MS = 15_000;
const RETRIES = 2;

/** Apple caps the customer reviews feed at ten pages; page 11 returns HTTP 400. */
const MAX_PAGES = 10;

const CANDIDATE_CAP = 60;
const MAX_AGE_DAYS = 180;
const MIN_TEXT_LENGTH = 80;
const BODY_TRUNCATE = 1200;

const USER_AGENT =
  'FrictionBot/1.0 (+https://github.com/Jayharwani/friction; non-commercial research)';

/** Complaint markers (spec 5.3). A review must match at least one. */
const COMPLAINT_MARKERS = [
  "can't", 'cannot', "doesn't", 'does not', "won't", 'stopped working', 'broken', 'bug', 'crash',
  'freeze', 'stuck', 'lag', 'slow', 'keeps', 'every time', 'since the update', 'after the update',
  'used to', 'no longer', 'annoying', 'frustrating', 'useless', 'why does', 'why is',
  'no way to', 'impossible to', 'deleting', 'uninstall', 'switching to', 'cancel my',
  'refund', 'charged', 'forced', 'ads',
];

const MS_PER_DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* Polite HTTP                                                         */
/* ------------------------------------------------------------------ */

const lastRequestAt = new Map<string, number>();

/**
 * Serialised, rate-limited fetch with a timeout and bounded retries.
 * Throttles per host so Apple and Play do not share a budget.
 */
async function politeFetch(url: string): Promise<Response> {
  const host = new URL(url).host;
  const since = Date.now() - (lastRequestAt.get(host) ?? 0);
  if (since < RATE_LIMIT_MS) await sleep(RATE_LIMIT_MS - since);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      lastRequestAt.set(host, Date.now());
      return res;
    } catch (err) {
      lastError = err as Error;
      lastRequestAt.set(host, Date.now());
      if (attempt < RETRIES) await sleep(RATE_LIMIT_MS * (attempt + 2)); // linear backoff
    }
  }
  throw lastError ?? new Error('request failed');
}

/* ------------------------------------------------------------------ */
/* Privacy                                                             */
/* ------------------------------------------------------------------ */

/**
 * sha256(salt + name + platform), truncated to 16 hex (spec 1.3).
 * The reviewer's name is used here and then discarded; it is never stored,
 * never returned, and never rendered.
 */
function hashReviewer(name: string, platform: 'ios' | 'android', salt: string): string {
  return createHash('sha256').update(`${salt}${name}${platform}`).digest('hex').slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Apple                                                               */
/* ------------------------------------------------------------------ */

interface AppleLabel {
  label?: string;
}
interface AppleEntry {
  id?: AppleLabel;
  title?: AppleLabel;
  content?: AppleLabel | AppleLabel[];
  updated?: AppleLabel;
  author?: { name?: AppleLabel };
  'im:rating'?: AppleLabel;
  'im:version'?: AppleLabel;
}

/**
 * The spec says to skip the first entry of page 1 as app metadata. That is no
 * longer true: as of this build every page-1 entry across the fifteen tracked
 * apps and four storefronts is a real review, and blindly dropping index 0
 * would discard one genuine review per fetch.
 *
 * Detect the metadata entry by shape instead — it carries no rating — which is
 * correct whether or not Apple reinstates it. Deviation noted per rule 0.1.
 */
function isMetadataEntry(entry: AppleEntry): boolean {
  return !entry['im:rating']?.label;
}

/** Apple sometimes returns `content` as an array of typed variants. */
function entryBody(entry: AppleEntry): string {
  const c = entry.content;
  if (Array.isArray(c)) return c.find((x) => x.label)?.label ?? '';
  return c?.label ?? '';
}

function mapAppleEntry(
  entry: AppleEntry,
  product: Product,
  country: string,
  capturedAt: string,
  salt: string,
): Candidate | null {
  const id = entry.id?.label;
  const rating = Number(entry['im:rating']?.label);
  const author = entry.author?.name?.label;
  const updated = entry.updated?.label;
  if (!id || !Number.isFinite(rating) || !author || !updated) return null;

  return {
    id: `apple:${id}`,
    productSlug: product.slug,
    platform: 'ios',
    country,
    rating,
    title: entry.title?.label ?? '',
    body: entryBody(entry).slice(0, BODY_TRUNCATE),
    version: entry['im:version']?.label ?? null,
    reviewedAt: new Date(updated).toISOString(),
    capturedAt,
    reviewerHash: hashReviewer(author, 'ios', salt),
  };
}

interface SourceResult {
  candidates: Candidate[];
  ok: boolean;
  error: string | null;
}

/**
 * Pull up to ten pages of the customer reviews feed for one app in one storefront.
 *
 * Deviation from spec 5.1 step 3, with evidence: the spec says to stop early on
 * the first page with no entries. Duolingo's US feed reliably returns an empty
 * page 1 while pages 2-10 each hold 50 reviews, so stopping there would discard
 * 450 real reviews. We page through all ten and stop only on a non-200, which
 * is what Apple returns past the depth limit.
 */
async function fetchApple(
  product: Product,
  country: string,
  capturedAt: string,
  salt: string,
  maxPages: number,
): Promise<SourceResult> {
  const candidates: Candidate[] = [];
  let pageErrors = 0;

  for (let page = 1; page <= maxPages; page++) {
    const url = `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${product.appleId}/sortby=mostrecent/json`;
    try {
      const res = await politeFetch(url);
      if (!res.ok) break; // depth limit or storefront without this app

      const data = (await res.json()) as { feed?: { entry?: AppleEntry | AppleEntry[] } };
      const raw = data.feed?.entry;
      const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];

      for (const entry of entries) {
        if (isMetadataEntry(entry)) continue;
        const candidate = mapAppleEntry(entry, product, country, capturedAt, salt);
        if (candidate) candidates.push(candidate);
      }
    } catch (err) {
      // A single bad page is never fatal (spec 5.1 step 5).
      pageErrors++;
      console.warn(`    ! ${product.slug}/${country} page ${page}: ${(err as Error).message}`);
    }
  }

  return {
    candidates,
    ok: candidates.length > 0 || pageErrors === 0,
    error: pageErrors > 0 ? `${pageErrors} page(s) failed` : null,
  };
}

/* ------------------------------------------------------------------ */
/* Screen and filter (spec 5.3)                                        */
/* ------------------------------------------------------------------ */

export interface ScreenCounts {
  alreadySeen: number;
  crisis: number;
  tooOld: number;
  tooShort: number;
}

/** Text the screens and filters read. */
function fullText(c: Candidate): string {
  return `${c.title} ${c.body}`.trim();
}

/**
 * Deterministic rejection, before the model ever sees anything.
 * Crisis-language reviews are dropped here and never stored anywhere.
 */
export function screen(
  candidates: Candidate[],
  seen: Seen,
  now: Date,
  counts: ScreenCounts,
): Candidate[] {
  const cutoff = now.getTime() - MAX_AGE_DAYS * MS_PER_DAY;

  return candidates.filter((c) => {
    if (seen[c.id]) {
      counts.alreadySeen++;
      return false;
    }
    if (containsCrisisLanguage(c.title, c.body)) {
      counts.crisis++;
      return false;
    }
    if (new Date(c.reviewedAt).getTime() < cutoff) {
      counts.tooOld++;
      return false;
    }
    if (fullText(c).length < MIN_TEXT_LENGTH) {
      counts.tooShort++;
      return false;
    }
    return true;
  });
}

/** How many distinct complaint markers this review hits. */
export function markerCount(c: Candidate): number {
  const text = fullText(c).toLowerCase();
  return COMPLAINT_MARKERS.filter((m) => text.includes(m)).length;
}

/** Keep only low-rated reviews that read like complaints. */
export function filterComplaints(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => c.rating <= 3 && markerCount(c) > 0);
}

/**
 * Rank by marker count, then lower star rating, then recency; cap the run.
 * Deterministic: ties break on id so two runs over the same input agree.
 */
export function rankAndCap(candidates: Candidate[], cap: number): Candidate[] {
  return [...candidates]
    .sort((a, b) => {
      const byMarkers = markerCount(b) - markerCount(a);
      if (byMarkers !== 0) return byMarkers;
      const byRating = a.rating - b.rating;
      if (byRating !== 0) return byRating;
      const byDate = new Date(b.reviewedAt).getTime() - new Date(a.reviewedAt).getTime();
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    })
    .slice(0, cap);
}

/* ------------------------------------------------------------------ */
/* Funnel accounting                                                   */
/* ------------------------------------------------------------------ */

function stage(candidates: Candidate[]): FunnelStage {
  const ios = candidates.filter((c) => c.platform === 'ios').length;
  const android = candidates.filter((c) => c.platform === 'android').length;
  return { ios, android, total: candidates.length };
}

/* ------------------------------------------------------------------ */
/* CLI                                                                 */
/* ------------------------------------------------------------------ */

function flag(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

async function main(): Promise<void> {
  const salt = process.env.AUTHOR_SALT;
  if (!salt) {
    console.error(
      'AUTHOR_SALT is not set. Reviewer hashes would be guessable without it.\n' +
        'Local runs: copy .env.example to .env and fill it in.\n' +
        'CI: set it as a repository secret.',
    );
    process.exit(1);
  }

  const raw = process.argv.includes('--raw');
  const onlySlugs = flag('only')?.split(',').map((s) => s.trim());
  const maxPages = Number(flag('pages') ?? MAX_PAGES);
  const countryOverride = flag('countries')?.split(',').map((s) => s.trim());

  const now = new Date();
  const runDate = now.toISOString().slice(0, 10);
  const capturedAt = now.toISOString();

  const allProducts = ProductsFileSchema.parse(
    JSON.parse(readFileSync(join(DATA, 'products.json'), 'utf8')),
  );
  const products = onlySlugs ? allProducts.filter((p) => onlySlugs.includes(p.slug)) : allProducts;

  if (products.length === 0) {
    console.error('No products selected.');
    process.exit(1);
  }

  const seen = SeenFileSchema.parse(readJson<Seen>(join(DATA, 'seen.json'), {}));

  console.log(`Friction fetch — ${runDate}`);
  console.log(`${products.length} product(s), max ${maxPages} page(s) per storefront\n`);

  const fetched: Candidate[] = [];
  const productStatus: Run['products'] = [];

  for (const product of products) {
    // Spec 1.4: the denylist runs before any fetch, and the seed list is not exempt.
    const blocked = blockedAppReason({ name: product.name, storeCategory: product.category });
    if (blocked) {
      console.log(`${product.slug}: SKIPPED, denylist term "${blocked}"`);
      productStatus.push({ slug: product.slug, appleOk: false, playOk: false, playError: `denylisted: ${blocked}` });
      continue;
    }

    let appleOk = false;
    const countries = countryOverride ?? product.countries;

    if (product.appleId) {
      let total = 0;
      for (const country of countries) {
        const result = await fetchApple(product, country, capturedAt, salt, maxPages);
        fetched.push(...result.candidates);
        total += result.candidates.length;
      }
      appleOk = total > 0;
      console.log(`${product.slug.padEnd(14)} apple ${String(total).padStart(5)} reviews`);
    } else {
      console.log(`${product.slug.padEnd(14)} apple     — no appleId`);
    }

    productStatus.push({ slug: product.slug, appleOk, playOk: false, playError: 'play not implemented yet' });
  }

  /* ---- raw dump for hand inspection ---- */
  if (raw) {
    const out = resolve(ROOT, flag('out') ?? 'scratch/raw.json');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${JSON.stringify(fetched, null, 2)}\n`);
    console.log(`\nRaw dump: ${fetched.length} mapped reviews -> ${out}`);
    return;
  }

  /* ---- screen, filter, cap ---- */
  const counts: ScreenCounts = { alreadySeen: 0, crisis: 0, tooOld: 0, tooShort: 0 };
  const screened = screen(fetched, seen, now, counts);
  const filtered = filterComplaints(screened);
  const capped = rankAndCap(filtered, CANDIDATE_CAP);

  const funnel = {
    fetched: stage(fetched),
    screened: stage(screened),
    filtered: stage(filtered),
    capped: stage(capped),
  };

  console.log('\nFunnel');
  console.log(`  fetched   ${String(funnel.fetched.total).padStart(6)}   (ios ${funnel.fetched.ios}, android ${funnel.fetched.android})`);
  console.log(`  screened  ${String(funnel.screened.total).padStart(6)}   (ios ${funnel.screened.ios}, android ${funnel.screened.android})`);
  console.log(`            dropped: ${counts.alreadySeen} already seen, ${counts.crisis} crisis language, ${counts.tooOld} older than ${MAX_AGE_DAYS} days, ${counts.tooShort} under ${MIN_TEXT_LENGTH} chars`);
  console.log(`  filtered  ${String(funnel.filtered.total).padStart(6)}   (ios ${funnel.filtered.ios}, android ${funnel.filtered.android})`);
  console.log(`  capped    ${String(funnel.capped.total).padStart(6)}   (ios ${funnel.capped.ios}, android ${funnel.capped.android})`);

  /* ---- write ---- */
  mkdirSync(join(DATA, 'candidates'), { recursive: true });
  const candidatesPath = join(DATA, 'candidates', `${runDate}.json`);
  writeFileSync(candidatesPath, `${JSON.stringify(capped, null, 2)}\n`);

  for (const c of capped) seen[c.id] = runDate;
  writeFileSync(join(DATA, 'seen.json'), `${JSON.stringify(seen, null, 2)}\n`);

  const runs = RunsFileSchema.parse(readJson<Run[]>(join(DATA, 'runs.json'), []));
  const run: Run = { date: runDate, startedAt: capturedAt, funnel, products: productStatus };
  const existing = runs.findIndex((r) => r.date === runDate);
  if (existing >= 0) runs[existing] = run;
  else runs.push(run);
  writeFileSync(join(DATA, 'runs.json'), `${JSON.stringify(runs, null, 2)}\n`);

  console.log(`\nWrote ${candidatesPath}`);
}

// Only run when executed directly, so the screening helpers stay importable
// by the tests. Compared as resolved paths because Windows drive letters and
// separators make URL comparison unreliable.
const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
