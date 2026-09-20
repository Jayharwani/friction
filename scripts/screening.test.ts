/**
 * Screening tests (spec 1.4).
 *
 * Two hard rules are asserted here:
 *   1. Apps whose subject matter is personal distress or health are blocked.
 *   2. Reviews containing crisis language are dropped before storage.
 *
 * The seed list is checked against the same denylist the pipeline uses, because
 * the check is what protects future additions — the seed is not exempt.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  APP_DENYLIST,
  CRISIS_PATTERNS,
  blockedAppReason,
  isBlockedApp,
  containsCrisisLanguage,
  ProductsFileSchema,
} from './validate';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'data');

/* ------------------------------------------------------------------ */
/* Blocked apps                                                        */
/* ------------------------------------------------------------------ */

test('apps about personal distress or health are blocked by name', () => {
  const blocked = [
    'Calm - Mental Health & Sleep',
    'BetterHelp - Therapy Online',
    'Talkspace Therapy',
    'Sanvello: Anxiety & Depression',
    'MyFitnessPal: Calorie Counter',
    'Noom: Weight Loss & Health',
    'Zero - Intermittent Fasting',
    'Flo Period Tracker',
    'Clue Period & Cycle Tracker',
    'Teladoc Telehealth',
    'GoodRx - Pharmacy Discounts',
    'Tinder - Dating App',
    'I Am Sober - Addiction Recovery',
    'EasyQuit - Quit Smoking',
    'Ada - Symptom Checker',
  ];

  for (const name of blocked) {
    const reason = blockedAppReason({ name });
    assert.ok(reason !== null, `"${name}" should be blocked but was allowed`);
  }
});

test('the denylist also matches on developer name and store category', () => {
  assert.ok(
    isBlockedApp({ name: 'Neutral Name', developer: 'Crisis Text Line', storeCategory: 'Utilities' }),
    'developer name must be screened',
  );
  assert.ok(
    isBlockedApp({ name: 'Neutral Name', developer: 'Acme', storeCategory: 'Medical' }),
    'store category must be screened',
  );
  assert.equal(
    isBlockedApp({ name: 'Neutral Name', developer: 'Acme', storeCategory: 'Utilities' }),
    false,
  );
});

test('blockedAppReason names the term that blocked the app', () => {
  assert.equal(blockedAppReason({ name: 'Flo Period Tracker' }), 'period');
  assert.equal(blockedAppReason({ name: 'Noom: Weight Loss' }), 'weight loss');
  assert.equal(blockedAppReason({ name: 'Notion' }), null);
});

test('every seed product passes the denylist', () => {
  const products = ProductsFileSchema.parse(
    JSON.parse(readFileSync(join(DATA, 'products.json'), 'utf8')),
  );
  assert.equal(products.length, 15, 'the seed list should hold fifteen products');

  for (const p of products) {
    const reason = blockedAppReason({ name: p.name, storeCategory: p.category });
    assert.equal(reason, null, `seed product "${p.name}" is blocked by "${reason}"`);
  }
});

test('seed products are well formed and unique', () => {
  const products = ProductsFileSchema.parse(
    JSON.parse(readFileSync(join(DATA, 'products.json'), 'utf8')),
  );
  assert.equal(new Set(products.map((p) => p.slug)).size, products.length, 'slugs must be unique');
  assert.equal(
    new Set(products.map((p) => p.playPackage)).size,
    products.length,
    'play packages must be unique',
  );
  // Assert the invariant rather than a literal list: every product must pull
  // from the same storefronts, so comparisons between apps stay fair. The list
  // itself is free to grow.
  const first = products[0]!.countries;
  assert.ok(first.length > 0, 'products must declare at least one storefront');
  for (const p of products) {
    assert.deepEqual(p.countries, first, `${p.slug} storefronts differ from ${products[0]!.slug}`);
  }
});

/* ------------------------------------------------------------------ */
/* Crisis language                                                     */
/* ------------------------------------------------------------------ */

test('reviews containing crisis language are rejected', () => {
  const rejected = [
    'This app is so broken it makes me want to kill myself every morning.',
    'I want to die whenever the sync fails again.',
    'the paywall made me relapse',
    'self harm is what this checkout flow feels like',
    'I had to starve waiting for the delivery to arrive',
  ];
  for (const body of rejected) {
    assert.ok(containsCrisisLanguage('', body), `should reject: "${body}"`);
  }
});

test('the crisis screen catches inflected forms, not just the literal terms', () => {
  // Plain substring matching would let all of these through.
  const inflected = [
    'After the update I thought about ending my life, it is that frustrating.',
    'this app makes me suicidal',
    'killing myself trying to get this to sync',
    'I wanted to die looking at that error screen',
    'it made me start cutting myself off from the team',
    'starving while the order never arrives',
    'kept purging my data',
    'relapsing into the old bug',
    'self-harm with a hyphen still counts',
  ];
  for (const body of inflected) {
    assert.ok(containsCrisisLanguage('', body), `should reject: "${body}"`);
  }
});

test('crisis screen reads the title as well as the body', () => {
  assert.ok(containsCrisisLanguage('makes me want to die', 'the sync is slow'));
  assert.equal(containsCrisisLanguage('sync is slow', 'the sync is slow'), false);
});

test('ordinary complaints are not caught by the crisis screen', () => {
  const allowed = [
    'The app crashes every time I open a database view. Useless since the update.',
    'Cannot cancel my subscription anywhere in the app, had to phone support.',
    'Notifications stopped working after the update and there is no way to fix it.',
    'Slow, laggy, and it keeps logging me out. Switching to a competitor.',
  ];
  for (const body of allowed) {
    assert.equal(containsCrisisLanguage('', body), false, `should allow: "${body}"`);
  }
});

test('screening is case-insensitive', () => {
  assert.ok(containsCrisisLanguage('', 'I WANT TO DIE'));
  assert.ok(isBlockedApp({ name: 'THERAPY Buddy' }));
});

/* ------------------------------------------------------------------ */
/* The lists themselves                                                */
/* ------------------------------------------------------------------ */

test('denylist and crisis list match the spec', () => {
  assert.equal(APP_DENYLIST.length, 30, 'denylist term count');
  assert.equal(CRISIS_PATTERNS.length, 9, 'crisis pattern count');
  // Lowercase is required: every comparison lowercases the haystack.
  for (const term of [...APP_DENYLIST, ...CRISIS_PATTERNS]) {
    assert.equal(term, term.toLowerCase(), `"${term}" must be lowercase`);
  }
});
