/**
 * Delete candidate and extracted files older than 30 days (spec 5.7).
 *
 * This is not housekeeping. Those files are the only place raw review text
 * exists, so this script is what actually enforces the promise on the
 * methodology page that raw text is deleted after 30 days (spec 1.3).
 *
 * data/problems/ and data/runs.json are never pruned.
 *
 *   npm run prune
 *   npm run prune -- --dry     list what would go, delete nothing
 */
import { readdirSync, existsSync, unlinkSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { SeenFileSchema, type Seen } from './validate';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

const RETAIN_DAYS = 30;
/**
 * seen.json is not raw text, so it is kept far longer — but not forever, or it
 * grows without bound. A year is well past the 180-day age filter, so pruning
 * here can never resurrect a review the pipeline would still accept.
 */
const SEEN_RETAIN_DAYS = 365;
const MS_PER_DAY = 86_400_000;

function pruneDir(dir: string, cutoff: Date, dry: boolean): { deleted: string[]; kept: number } {
  if (!existsSync(dir)) return { deleted: [], kept: 0 };

  const deleted: string[] = [];
  let kept = 0;

  for (const file of readdirSync(dir)) {
    const match = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file);
    // Date the file by its name, falling back to mtime for anything unexpected.
    const stamp = match ? new Date(`${match[1]}T00:00:00Z`) : statSync(join(dir, file)).mtime;

    if (stamp < cutoff) {
      deleted.push(file);
      if (!dry) unlinkSync(join(dir, file));
    } else {
      kept++;
    }
  }
  return { deleted, kept };
}

function main(): void {
  const dry = process.argv.includes('--dry');
  const now = Date.now();
  const cutoff = new Date(now - RETAIN_DAYS * MS_PER_DAY);

  console.log(`Pruning files older than ${cutoff.toISOString().slice(0, 10)}${dry ? ' (dry run)' : ''}\n`);

  let total = 0;
  for (const name of ['candidates', 'extracted']) {
    const { deleted, kept } = pruneDir(join(DATA, name), cutoff, dry);
    total += deleted.length;
    console.log(`  ${name.padEnd(11)} ${String(deleted.length).padStart(3)} deleted, ${kept} kept`);
    for (const f of deleted) console.log(`      - ${f}`);
  }

  /* ---- seen.json ---- */
  const seenPath = join(DATA, 'seen.json');
  if (existsSync(seenPath)) {
    const seen = SeenFileSchema.parse(JSON.parse(readFileSync(seenPath, 'utf8')));
    const seenCutoff = new Date(now - SEEN_RETAIN_DAYS * MS_PER_DAY).toISOString().slice(0, 10);

    const trimmed: Seen = {};
    let dropped = 0;
    for (const [id, date] of Object.entries(seen)) {
      if (date >= seenCutoff) trimmed[id] = date;
      else dropped++;
    }

    console.log(`  ${'seen'.padEnd(11)} ${String(dropped).padStart(3)} ids dropped, ${Object.keys(trimmed).length} kept`);
    if (!dry && dropped > 0) writeFileSync(seenPath, `${JSON.stringify(trimmed, null, 2)}\n`);
  }

  console.log(
    dry
      ? '\nDry run: nothing deleted.'
      : `\nDone. ${total} file(s) removed; raw review text does not persist beyond ${RETAIN_DAYS} days.`,
  );
}

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) main();
