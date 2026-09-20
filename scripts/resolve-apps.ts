/**
 * One-time utility: fill in `appleId` for every product from Apple's public
 * lookup endpoint, and confirm every Play package actually resolves (spec 1.1, 8).
 *
 * Idempotent and non-destructive: an appleId that is already set is never
 * overwritten, so a hand-corrected ID sticks across re-runs. Run it again after
 * adding a product to data/products.json.
 *
 *   npm run resolve-apps            resolve and write
 *   npm run resolve-apps -- --dry   resolve and print, write nothing
 *
 * Every candidate Apple returns is printed with its score so the choice can be
 * audited by eye rather than trusted blindly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import gplay from 'google-play-scraper';

import { ProductsFileSchema, blockedAppReason, type Product } from './validate';

const HERE = dirname(fileURLToPath(import.meta.url));
const PRODUCTS_PATH = join(HERE, '..', 'data', 'products.json');
const ICON_DIR = join(HERE, '..', 'public', 'icons');

/**
 * Icons are displayed at 72px at most, so 144 covers a 2x screen exactly.
 * Apple's CDN takes the rendition size in the path, so this asks for the size
 * that will be shown rather than downloading 512 and scaling it down.
 */
const ICON_PX = 144;

/** Spec 5: one request per second per host, serialised. */
const RATE_LIMIT_MS = 1000;
const USER_AGENT =
  'FrictionBot/1.0 (+https://github.com/Jayharwani/friction; non-commercial research)';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface ItunesResult {
  trackId: number;
  trackName: string;
  sellerName: string;
  primaryGenreName: string;
  bundleId: string;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Package/bundle tokens that carry no identifying information. */
const GENERIC_TOKENS = new Set(['com', 'org', 'net', 'io', 'android', 'app', 'apps', 'mobile', 'inc']);

function idTokens(id: string | null | undefined): Set<string> {
  if (!id) return new Set();
  return new Set(
    id
      .toLowerCase()
      .split(/[.\-_]/)
      .filter((t) => t && !GENERIC_TOKENS.has(t)),
  );
}

/**
 * Rank a search result against the product we asked for.
 * Exact name match dominates; the Play package is used as a corroborating
 * signal because iOS bundle ids and Android package names usually share a token.
 */
function scoreCandidate(r: ItunesResult, product: Product, index: number): number {
  const track = normalise(r.trackName);
  const want = normalise(product.name);

  let score = 0;
  if (track === want) score += 1000;
  else if (track.startsWith(`${want} `)) score += 400;
  else if (track.includes(want)) score += 150;

  const shared = [...idTokens(r.bundleId)].filter((t) => idTokens(product.playPackage).has(t));
  if (shared.length) score += 200;

  // Apple's own relevance ordering breaks ties.
  score += Math.max(0, 5 - index);
  return score;
}

/* ------------------------------------------------------------------ */
/* Apple                                                               */
/* ------------------------------------------------------------------ */

async function searchApple(name: string): Promise<ItunesResult[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&country=us&limit=5`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as { results?: ItunesResult[] };
  return data.results ?? [];
}

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

interface Outcome {
  slug: string;
  appleId: string | null;
  appleNote: string;
  playOk: boolean;
  playNote: string;
  blocked: string | null;
}

/**
 * Download an app's icon once, into public/icons/.
 *
 * Used small, unaltered, to identify the app beside its name — the same basis
 * a review site operates on, alongside the non-affiliation notice the site
 * carries. Never hotlinked: the file is served from this origin.
 *
 * Returns what happened, for the report.
 */
async function fetchIcon(slug: string, appleId: string | null): Promise<string> {
  if (!appleId) return 'no apple id';

  const dest = join(ICON_DIR, `${slug}.jpg`);
  if (existsSync(dest)) return 'cached';

  const url = `https://itunes.apple.com/lookup?id=${appleId}&entity=software&country=us`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return `lookup ${res.status}`;

  const json = (await res.json()) as { results?: { artworkUrl512?: string }[] };
  const art = json.results?.[0]?.artworkUrl512;
  if (!art) return 'no artwork in response';

  // .../512x512bb.jpg -> .../144x144bb.jpg. The path carries the rendition
  // size; the file is a JPEG despite the .png earlier in the URL.
  const sized = art.replace(/\/\d+x\d+bb\.jpg$/, `/${ICON_PX}x${ICON_PX}bb.jpg`);
  const img = await fetch(sized, { headers: { 'User-Agent': USER_AGENT } });
  if (!img.ok) return `artwork ${img.status}`;

  mkdirSync(ICON_DIR, { recursive: true });
  writeFileSync(dest, Buffer.from(await img.arrayBuffer()));
  return `saved ${Math.round(Number(img.headers.get('content-length') ?? 0) / 1024)}kb`;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry');
  const iconsOnly = process.argv.includes('--icons-only');
  const products = ProductsFileSchema.parse(JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8')));

  if (iconsOnly) {
    console.log(`Fetching icons for ${products.length} products
`);
    for (const product of products) {
      const note = await fetchIcon(product.slug, product.appleId ?? null);
      console.log(`${product.slug.padEnd(16)}${note}`);
      if (note !== 'cached' && note !== 'no apple id') await sleep(RATE_LIMIT_MS);
    }
    return;
  }

  console.log(`Resolving ${products.length} products${dryRun ? ' (dry run)' : ''}\n`);

  const outcomes: Outcome[] = [];

  for (const product of products) {
    const outcome: Outcome = {
      slug: product.slug,
      appleId: product.appleId,
      appleNote: '',
      playOk: false,
      playNote: '',
      blocked: null,
    };

    /* ---- Apple ---- */
    if (product.appleId) {
      outcome.appleNote = 'already set, left alone';
    } else {
      try {
        const results = await searchApple(product.name);
        await sleep(RATE_LIMIT_MS);

        if (results.length === 0) {
          outcome.appleNote = 'no search results';
        } else {
          const ranked = results
            .map((r, i) => ({ r, score: scoreCandidate(r, product, i) }))
            .sort((a, b) => b.score - a.score);

          console.log(`${product.name} — Apple candidates:`);
          for (const { r, score } of ranked) {
            const mark = r === ranked[0]!.r ? '->' : '  ';
            console.log(
              `  ${mark} ${String(score).padStart(4)}  ${String(r.trackId).padEnd(11)} "${r.trackName}" / ${r.sellerName} / ${r.primaryGenreName}`,
            );
          }

          const best = ranked[0]!.r;

          // Spec 1.4: the denylist runs against what the store actually says,
          // before this app is ever fetched. The seed list is not exempt.
          const reason = blockedAppReason({
            name: best.trackName,
            developer: best.sellerName,
            storeCategory: best.primaryGenreName,
          });

          if (reason) {
            outcome.blocked = reason;
            outcome.appleNote = `BLOCKED by denylist term "${reason}"`;
          } else {
            outcome.appleId = String(best.trackId);
            outcome.appleNote = `"${best.trackName}" / ${best.primaryGenreName}`;
          }
          console.log('');
        }
      } catch (err) {
        outcome.appleNote = `lookup failed: ${(err as Error).message}`;
      }
    }

    /* ---- Google Play ---- */
    if (!product.playPackage) {
      outcome.playNote = 'no package configured';
    } else {
      try {
        const app = await gplay.app({ appId: product.playPackage });
        await sleep(RATE_LIMIT_MS);

        const reason = blockedAppReason({
          name: app.title,
          developer: app.developer,
          storeCategory: app.genre,
        });
        if (reason) {
          outcome.blocked = reason;
          outcome.playNote = `BLOCKED by denylist term "${reason}"`;
        } else {
          outcome.playOk = true;
          outcome.playNote = `"${app.title}" / ${app.genre}`;
        }
      } catch (err) {
        outcome.playNote = `does not resolve: ${(err as Error).message}`;
      }
    }

    outcomes.push(outcome);
  }

  /* ---- Write back ---- */
  const updated: Product[] = products.map((p) => {
    const o = outcomes.find((x) => x.slug === p.slug)!;
    return { ...p, appleId: o.blocked ? null : o.appleId };
  });

  if (!dryRun) {
    writeFileSync(PRODUCTS_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  }

  /* ---- Report ---- */
  console.log('='.repeat(96));
  console.log(
    `${'slug'.padEnd(14)}${'appleId'.padEnd(12)}${'play'.padEnd(6)}detail`,
  );
  console.log('-'.repeat(96));
  for (const o of outcomes) {
    console.log(
      `${o.slug.padEnd(14)}${(o.appleId ?? '—').padEnd(12)}${(o.playOk ? 'ok' : 'FAIL').padEnd(6)}${o.appleNote}`,
    );
    if (!o.playOk) console.log(`${' '.repeat(32)}play: ${o.playNote}`);
  }
  console.log('='.repeat(96));

  const unresolvedApple = outcomes.filter((o) => !o.appleId);
  const failedPlay = outcomes.filter((o) => !o.playOk);
  const blocked = outcomes.filter((o) => o.blocked);

  console.log(`\nApple ids resolved : ${outcomes.length - unresolvedApple.length}/${outcomes.length}`);
  console.log(`Play packages ok   : ${outcomes.length - failedPlay.length}/${outcomes.length}`);
  console.log(`Blocked by denylist: ${blocked.length}`);

  if (blocked.length) {
    console.log('\nBlocked apps (never fetched):');
    for (const o of blocked) console.log(`  ${o.slug}: ${o.blocked}`);
  }
  if (unresolvedApple.length) {
    console.log('\nCould not resolve an Apple id for:');
    for (const o of unresolvedApple) console.log(`  ${o.slug}: ${o.appleNote}`);
  }
  if (failedPlay.length) {
    console.log('\nPlay packages that did not resolve (Apple-only for these):');
    for (const o of failedPlay) console.log(`  ${o.slug}: ${o.playNote}`);
  }

  if (!dryRun) console.log(`\nWrote ${PRODUCTS_PATH}`);

  // Apple is the backbone; a missing Apple id is a hard failure.
  // A missing Play package is a gap, not a failure (spec 1.1).
  if (unresolvedApple.length > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
