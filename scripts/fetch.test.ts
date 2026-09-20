/**
 * Tests for the deterministic screen and filter (spec 5.3).
 *
 * This stage is what keeps the model workload small enough to run on a
 * subscription, and it is the last point at which a crisis-language review can
 * be stopped before storage. Both properties are asserted here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import type { Candidate, Seen } from './validate';
import { screen, markerCount, filterComplaints, rankAndCap, type ScreenCounts } from './fetch';

const NOW = new Date('2026-09-19T12:00:00.000Z');
const MS_PER_DAY = 86_400_000;

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * MS_PER_DAY).toISOString();
}

let seq = 0;
function cand(over: Partial<Candidate> = {}): Candidate {
  seq += 1;
  return {
    id: `apple:${seq}`,
    productSlug: 'notion',
    platform: 'ios',
    country: 'us',
    rating: 1,
    title: 'Broken',
    // Long enough to clear the 80-character floor by default.
    body: 'The app crashes every single time I try to open a page and it is incredibly frustrating.',
    version: '1.0.0',
    reviewedAt: daysAgo(1),
    capturedAt: NOW.toISOString(),
    reviewerHash: '0123456789abcdef',
    ...over,
  };
}

function emptyCounts(): ScreenCounts {
  return { alreadySeen: 0, crisis: 0, tooOld: 0, tooShort: 0 };
}

/* ------------------------------------------------------------------ */
/* screen                                                              */
/* ------------------------------------------------------------------ */

test('screen keeps a normal recent complaint', () => {
  const counts = emptyCounts();
  const kept = screen([cand()], {}, NOW, counts);
  assert.equal(kept.length, 1);
  assert.deepEqual(counts, emptyCounts());
});

test('screen rejects reviews already processed', () => {
  const c = cand();
  const seen: Seen = { [c.id]: '2026-09-01' };
  const counts = emptyCounts();
  assert.equal(screen([c], seen, NOW, counts).length, 0);
  assert.equal(counts.alreadySeen, 1);
});

test('screen drops crisis-language reviews entirely', () => {
  const counts = emptyCounts();
  const c = cand({
    body: 'This app is so broken that it honestly makes me want to kill myself every single morning.',
  });
  const kept = screen([c], {}, NOW, counts);
  assert.equal(kept.length, 0, 'a crisis review must never survive screening');
  assert.equal(counts.crisis, 1);
});

test('screen reads the title as well as the body for crisis language', () => {
  const counts = emptyCounts();
  const c = cand({
    title: 'makes me want to die',
    body: 'The sync keeps failing and there is no way to force a refresh from the mobile app.',
  });
  assert.equal(screen([c], {}, NOW, counts).length, 0);
  assert.equal(counts.crisis, 1);
});

test('screen rejects reviews older than 180 days', () => {
  const counts = emptyCounts();
  assert.equal(screen([cand({ reviewedAt: daysAgo(181) })], {}, NOW, counts).length, 0);
  assert.equal(counts.tooOld, 1);
  // The boundary itself is kept.
  const inside = emptyCounts();
  assert.equal(screen([cand({ reviewedAt: daysAgo(179) })], {}, NOW, inside).length, 1);
});

test('screen rejects reviews under 80 characters of title plus body', () => {
  const counts = emptyCounts();
  assert.equal(screen([cand({ title: 'Bad', body: 'very bad app' })], {}, NOW, counts).length, 0);
  assert.equal(counts.tooShort, 1);
});

test('screen applies rejections in order and counts each once', () => {
  const counts = emptyCounts();
  const items = [
    cand(),
    cand({ reviewedAt: daysAgo(400) }),
    cand({ title: 'x', body: 'short' }),
    cand({ body: 'I want to die because this app keeps logging me out of every single workspace.' }),
  ];
  const kept = screen(items, {}, NOW, counts);
  assert.equal(kept.length, 1);
  assert.equal(counts.tooOld, 1);
  assert.equal(counts.tooShort, 1);
  assert.equal(counts.crisis, 1);
});

/* ------------------------------------------------------------------ */
/* markers and filtering                                               */
/* ------------------------------------------------------------------ */

test('markerCount counts distinct complaint markers', () => {
  assert.equal(markerCount(cand({ title: '', body: 'a'.repeat(100) })), 0);
  // "crash" only
  assert.equal(markerCount(cand({ title: '', body: `it will crash ${'x'.repeat(90)}` })), 1);
  // "crash", "slow", "every time"
  const three = cand({ title: '', body: `it is slow and will crash every time ${'x'.repeat(70)}` });
  assert.equal(markerCount(three), 3);
});

test('markerCount is case-insensitive and reads the title', () => {
  assert.ok(markerCount(cand({ title: 'CRASHES CONSTANTLY', body: 'x'.repeat(90) })) > 0);
});

test('filterComplaints keeps only low ratings that read like complaints', () => {
  // Titles are set explicitly: the default fixture title is "Broken", which is
  // itself a complaint marker.
  const items = [
    cand({ rating: 1, title: '', body: `it will crash ${'x'.repeat(90)}` }), // keep
    cand({ rating: 3, title: '', body: `so slow now ${'x'.repeat(90)}` }), // keep, boundary
    cand({ rating: 4, title: '', body: `it will crash ${'x'.repeat(90)}` }), // drop, rating
    cand({ rating: 1, title: '', body: 'x'.repeat(100) }), // drop, no marker
  ];
  const kept = filterComplaints(items);
  assert.equal(kept.length, 2);
  assert.ok(kept.every((c) => c.rating <= 3));
});

/* ------------------------------------------------------------------ */
/* ranking and cap                                                     */
/* ------------------------------------------------------------------ */

test('rankAndCap orders by marker count, then rating, then recency', () => {
  const oneMarker = cand({ id: 'apple:one', rating: 1, body: `crash ${'x'.repeat(90)}` });
  const threeMarkers = cand({
    id: 'apple:three',
    rating: 3,
    body: `slow crash every time ${'x'.repeat(80)}`,
  });
  const twoMarkersLowRating = cand({
    id: 'apple:two',
    rating: 1,
    body: `slow crash ${'x'.repeat(90)}`,
  });

  const ranked = rankAndCap([oneMarker, threeMarkers, twoMarkersLowRating], 10);
  assert.deepEqual(
    ranked.map((c) => c.id),
    ['apple:three', 'apple:two', 'apple:one'],
    'more markers wins even at a higher star rating',
  );
});

test('rankAndCap breaks rating ties on recency', () => {
  const older = cand({ id: 'apple:older', rating: 1, reviewedAt: daysAgo(30), body: `crash ${'x'.repeat(90)}` });
  const newer = cand({ id: 'apple:newer', rating: 1, reviewedAt: daysAgo(2), body: `crash ${'x'.repeat(90)}` });
  const ranked = rankAndCap([older, newer], 10);
  assert.deepEqual(ranked.map((c) => c.id), ['apple:newer', 'apple:older']);
});

test('rankAndCap enforces the cap and is deterministic', () => {
  const items = Array.from({ length: 200 }, (_, i) =>
    cand({ id: `apple:${String(i).padStart(4, '0')}`, rating: 1, body: `crash ${'x'.repeat(90)}` }),
  );
  const a = rankAndCap(items, 60);
  const b = rankAndCap([...items].reverse(), 60);
  assert.equal(a.length, 60);
  // Identical input in a different order must produce an identical run.
  assert.deepEqual(a.map((c) => c.id), b.map((c) => c.id));
});

test('rankAndCap does not mutate its input', () => {
  const items = [cand({ id: 'apple:a' }), cand({ id: 'apple:b' })];
  const before = items.map((c) => c.id);
  rankAndCap(items, 1);
  assert.deepEqual(items.map((c) => c.id), before);
});
