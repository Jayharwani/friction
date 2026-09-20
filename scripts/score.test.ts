/**
 * Tests for the merge logic in score.ts.
 *
 * Title matching decides whether this week's report of a problem lands on the
 * existing record or forks a duplicate, so the threshold behaviour is pinned
 * here with realistic titles.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { levenshtein, titleSimilarity, slugify, compareVersions } from './score';

/* ------------------------------------------------------------------ */
/* Levenshtein                                                         */
/* ------------------------------------------------------------------ */

test('levenshtein computes known distances', () => {
  assert.equal(levenshtein('', ''), 0);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
  assert.equal(levenshtein('kitten', 'sitting'), 3);
  assert.equal(levenshtein('flaw', 'lawn'), 2);
  assert.equal(levenshtein('a', 'b'), 1);
});

test('levenshtein is symmetric', () => {
  const pairs: [string, string][] = [
    ['notifications never arrive', 'notifications do not arrive'],
    ['sync fails silently', 'silent sync failure'],
  ];
  for (const [a, b] of pairs) {
    assert.equal(levenshtein(a, b), levenshtein(b, a), `${a} / ${b}`);
  }
});

/* ------------------------------------------------------------------ */
/* Title similarity                                                    */
/* ------------------------------------------------------------------ */

test('identical titles score 1 regardless of case and punctuation', () => {
  assert.equal(titleSimilarity('Sync fails', 'Sync fails'), 1);
  assert.equal(titleSimilarity('Sync fails!', 'sync   fails'), 1);
  assert.equal(titleSimilarity('', ''), 1);
});

test('restatements of the same problem match above the 0.75 threshold', () => {
  const pairs: [string, string][] = [
    [
      'Voice messages stay stuck in the sending state',
      'Voice messages stay stuck in a sending state',
    ],
    ['Notifications stop arriving after an update', 'Notifications stop arriving after the update'],
  ];
  for (const [a, b] of pairs) {
    const s = titleSimilarity(a, b);
    assert.ok(s >= 0.75, `expected >= 0.75 for "${a}" / "${b}", got ${s.toFixed(3)}`);
  }
});

test('different problems on the same product stay below the threshold', () => {
  const pairs: [string, string][] = [
    [
      'Voice messages stay stuck in the sending state',
      'Subscription cannot be cancelled inside the app',
    ],
    ['Notifications stop arriving after an update', 'The iPad layout scrolls to a random position'],
    ['Search returns no results for recent pages', 'Offline edits are silently discarded'],
  ];
  for (const [a, b] of pairs) {
    const s = titleSimilarity(a, b);
    assert.ok(s < 0.75, `expected < 0.75 for "${a}" / "${b}", got ${s.toFixed(3)}`);
  }
});

test('title similarity is bounded and symmetric', () => {
  const a = 'Export to PDF produces a blank document';
  const b = 'Exporting a PDF produces blank documents';
  const s = titleSimilarity(a, b);
  assert.ok(s >= 0 && s <= 1);
  assert.equal(s, titleSimilarity(b, a));
});

/* ------------------------------------------------------------------ */
/* Slugs                                                               */
/* ------------------------------------------------------------------ */

test('slugify produces url-safe stable slugs', () => {
  assert.equal(slugify('Voice messages stay stuck'), 'voice-messages-stay-stuck');
  assert.equal(slugify('Can&apos;t cancel — subscription!'), 'can-apos-t-cancel-subscription');
  assert.equal(slugify('   leading and trailing   '), 'leading-and-trailing');
  assert.equal(slugify('!!!'), 'untitled');
  assert.equal(slugify(''), 'untitled');
});

test('slugify caps length so ids stay manageable', () => {
  const long = 'a'.repeat(200);
  assert.ok(slugify(long).length <= 72);
});

test('slugify output only contains url-safe characters', () => {
  for (const s of ['Ünïcödé títle', 'tabs\tand\nnewlines', '50% faster?']) {
    assert.match(slugify(s), /^[a-z0-9-]+$/, `bad slug for "${s}"`);
  }
});

/* ------------------------------------------------------------------ */
/* Version ordering                                                    */
/* ------------------------------------------------------------------ */

test('versions sort numerically, not lexically', () => {
  const sorted = ['1.10.0', '1.9.0', '1.2.0', '2.0.0'].sort(compareVersions);
  assert.deepEqual(sorted, ['1.2.0', '1.9.0', '1.10.0', '2.0.0']);
});

test('version comparison handles differing segment counts', () => {
  assert.ok(compareVersions('1.2', '1.2.1') < 0);
  assert.equal(compareVersions('1.2.0', '1.2'), 0);
});

test('non-numeric versions fall back to string order without throwing', () => {
  const versions = ['1.0.0', 'beta', '2.0.0', 'alpha'];
  assert.doesNotThrow(() => versions.sort(compareVersions));
});
