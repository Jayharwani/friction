/**
 * The lens gates.
 *
 * The four lenses are the only written content on the site. These tests are
 * the deliberate failures the spec asks for: each one is a lens that *should*
 * be rejected, and the test fails if the validator lets it through.
 */
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  ExtractedProblemSchema,
  LensesSchema,
  lensNamesUnknownCompany,
  lensText,
  lensViolations,
} from './validate.ts';

const ok = {
  proposition: 'A way to recover unsaved edits after a crash.',
  specifics: ['Keeps a local copy as you type', 'Offers it back on next launch'],
  limitation: 'The platform may not give background storage this app can reach.',
};

const lenses = { build: ok, start: ok, study: ok, write: ok };

test('a plain, grounded lens passes', () => {
  assert.equal(LensesSchema.safeParse(lenses).success, true);
  assert.deepEqual(lensViolations(lenses), []);
});

test('a lens with no limitation is rejected', () => {
  const bad = { ...lenses, build: { ...ok, limitation: '' } };
  assert.equal(LensesSchema.safeParse(bad).success, false);
});

for (const [name, phrase] of [
  ['a currency symbol', 'Worth about $40 a month to them.'],
  ['a percentage', 'Around 30% of reviewers hit this.'],
  ['market language', 'A clear market for recovery tooling.'],
  ['a size claim', 'A billion people edit documents on phones.'],
  ['demand language', 'An underserved segment nobody serves.'],
  ['scale language', 'A massive opportunity in note-taking.'],
] as const) {
  test(`a lens containing ${name} is rejected`, () => {
    const bad = { ...lenses, start: { ...ok, proposition: phrase } };
    const found = lensViolations(bad);
    assert.ok(found.length > 0, `"${phrase}" was allowed through`);
    assert.match(found[0]!, /^start lens/);
  });
}

test('a lens over the word cap is rejected', () => {
  const long = { ...ok, limitation: 'word '.repeat(90).trim() };
  const found = lensViolations({ ...lenses, write: long });
  assert.ok(found.some((f) => /write lens is \d+ words/.test(f)), found.join('; '));
});

test('lensText covers every string a lens carries', () => {
  const t = lensText(ok);
  assert.ok(t.includes(ok.proposition));
  for (const sp of ok.specifics) assert.ok(t.includes(sp));
  assert.ok(t.includes(ok.limitation));
});

/* ---- humanTitle ---- */

const base = {
  productSlug: 'notion',
  title: 'The mobile app freezes and lags while editing pages',
  summary: 'It freezes.',
  category: 'Performance' as const,
  evidence: [
    {
      reviewId: 'apple:1',
      quote: 'the app freezes',
      signals: {
        churnIntent: false,
        competitorNamed: false,
        billingComplaint: false,
        regressionClaim: false,
        workaroundDescribed: false,
      },
    },
  ],
  workarounds: [],
  existingSolutions: [],
};

test('a humanTitle over twelve words is rejected', () => {
  const bad = { ...base, humanTitle: 'one two three four five six seven eight nine ten eleven twelve thirteen' };
  assert.equal(ExtractedProblemSchema.safeParse(bad).success, false);
});

test('a twelve-word humanTitle passes', () => {
  const good = { ...base, humanTitle: 'People lose work when the app freezes mid-edit' };
  assert.equal(ExtractedProblemSchema.safeParse(good).success, true);
});

/* ---- competitor naming ---- */

test('a lens naming a company no reviewer named is rejected', () => {
  const problem = {
    ...base,
    existingSolutions: [],
    lenses: {
      ...lenses,
      start: { ...ok, proposition: 'A recovery layer that Evernote never shipped.' },
    },
  };
  const parsed = ExtractedProblemSchema.parse(problem);
  assert.match(lensNamesUnknownCompany(parsed) ?? '', /Evernote/);
});

test('a lens may name a company a reviewer named', () => {
  const problem = {
    ...base,
    existingSolutions: ['Evernote'],
    lenses: {
      ...lenses,
      start: { ...ok, proposition: 'A recovery layer that Evernote never shipped.' },
    },
  };
  const parsed = ExtractedProblemSchema.parse(problem);
  assert.equal(lensNamesUnknownCompany(parsed), null);
});

test('ordinary capitalised words are not read as company names', () => {
  const problem = {
    ...base,
    lenses: {
      ...lenses,
      build: { ...ok, proposition: 'People lose work. This would keep it.' },
    },
  };
  const parsed = ExtractedProblemSchema.parse(problem);
  assert.equal(lensNamesUnknownCompany(parsed), null);
});
