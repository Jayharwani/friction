/**
 * Run every written challenge through the same gates a scan would.
 *
 * The lenses are produced by a prompted step, not by the build, so this is
 * what stops a bad one reaching the site: the file is checked against the
 * schema, the banned vocabulary, the word caps and the competitor rule
 * before anything renders it.
 *
 *   npm run lenses
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  HUMAN_TITLE_MAX_WORDS,
  LensesSchema,
  lensNamesUnknownCompany,
  lensViolations,
  wordCount,
} from './validate.ts';

const DIR = 'data/challenges';
if (!existsSync(DIR)) {
  console.log('No data/challenges yet.');
  process.exit(0);
}

const problems = new Map<string, { existingSolutions: string[] }>();
for (const f of readdirSync('data/problems')) {
  const p = JSON.parse(readFileSync(join('data/problems', f), 'utf8'));
  problems.set(p.slug, p);
}

let failed = 0;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));

for (const file of files) {
  const raw = JSON.parse(readFileSync(join(DIR, file), 'utf8'));
  const fails: string[] = [];

  if (!problems.has(raw.slug)) fails.push(`no problem with slug "${raw.slug}"`);

  if (!raw.humanTitle) fails.push('missing humanTitle');
  else if (wordCount(raw.humanTitle) > HUMAN_TITLE_MAX_WORDS) {
    fails.push(`humanTitle is ${wordCount(raw.humanTitle)} words, over ${HUMAN_TITLE_MAX_WORDS}`);
  }

  if (!raw.whoItAffects) fails.push('missing whoItAffects');
  if (!raw.writtenBy || !raw.writtenAt) fails.push('missing writtenBy/writtenAt provenance');

  const parsed = LensesSchema.safeParse(raw.lenses);
  if (!parsed.success) {
    for (const i of parsed.error.issues) fails.push(`${i.path.join('.')}: ${i.message}`);
  } else {
    fails.push(...lensViolations(parsed.data));
    const named = lensNamesUnknownCompany({
      ...(problems.get(raw.slug) ?? { existingSolutions: [] }),
      lenses: parsed.data,
    } as never);
    if (named) fails.push(named);
  }

  const words = parsed.success
    ? Object.values(parsed.data).map((l) =>
        wordCount([l.proposition, ...l.specifics, l.limitation].join(' ')),
      )
    : [];

  if (fails.length > 0) {
    failed += 1;
    console.error(`\n✗ ${raw.slug}`);
    for (const f of fails) console.error(`    ${f}`);
  } else {
    console.log(`· ${raw.slug}`);
    console.log(`    ${raw.humanTitle}  [${wordCount(raw.humanTitle)}w]`);
    console.log(`    lenses: ${words.join(', ')} words`);
  }
}

console.log(`\n${files.length} challenge${files.length === 1 ? '' : 's'} checked.`);
if (failed > 0) {
  console.error(`${failed} failed.`);
  process.exit(1);
}
console.log('All pass.');
