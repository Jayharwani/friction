/**
 * The category system's invariants.
 *
 * The palette is generated arithmetic that happens to be written down in
 * CSS, because CSS is where it has to be used and this project declares no
 * colour inline. These tests are what stop the two copies drifting — and
 * what stop someone nudging one hue because they liked it better, which is
 * exactly how an evenly spaced scale stops being one.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATEGORIES } from './validate.ts';
import {
  FAMILIES,
  FAMILY_LABEL,
  FAMILY_NOTE,
  ACCENT_HUE,
  HUE_STEP,
  categoriesIn,
  familyOf,
  hueOf,
} from '../src/lib/categories.ts';

const css = readFileSync('src/styles/categories.css', 'utf8');

test('every category belongs to exactly one family', () => {
  for (const category of CATEGORIES) {
    const family = familyOf(category);
    assert.ok(FAMILIES.includes(family), `${category} -> ${family} is not a family`);
  }
});

test('the families between them cover every category, with none left over', () => {
  const covered = FAMILIES.flatMap((f) => categoriesIn(f));
  assert.equal(covered.length, CATEGORIES.length);
  assert.deepEqual([...covered].sort(), [...CATEGORIES].sort());
});

test('an unknown category throws rather than defaulting', () => {
  assert.throws(() => familyOf('Telepathy'), /No family for category/);
});

test('the hues are evenly spaced and cover the circle exactly once', () => {
  const hues = FAMILIES.map(hueOf);
  assert.equal(hues.length, 8);
  assert.equal(HUE_STEP, 45);
  for (let i = 1; i < hues.length; i++) {
    assert.equal(hues[i]! - hues[i - 1]!, HUE_STEP, `gap ${i} is not ${HUE_STEP} degrees`);
  }
  assert.ok(hues.at(-1)! < 360, 'the last hue wraps past the circle');
  assert.equal(new Set(hues).size, hues.length, 'two families share a hue');
});

test('no family sits on the UI accent, which is a different role', () => {
  // Half a step is the furthest eight evenly spaced hues can be from a fixed
  // point, so this is the best the ring can do — and it is what the rotation
  // in HUE_START buys. Rounding that offset away would fail here.
  const apart = (a: number, b: number): number => {
    const d = Math.abs(a - b) % 360;
    return Math.min(d, 360 - d);
  };
  for (const family of FAMILIES) {
    assert.ok(
      apart(hueOf(family), ACCENT_HUE) >= HUE_STEP / 2 - 1e-9,
      `${family} at ${hueOf(family)} is nearer the accent than half a step`,
    );
  }
});

test('the stylesheet declares the hues the arithmetic produces', () => {
  for (const family of FAMILIES) {
    const expected = `--cat-${family}: oklch(var(--cat-l) var(--cat-c) ${hueOf(family)});`;
    assert.ok(css.includes(expected), `categories.css is missing or has drifted from: ${expected}`);
  }
});

test('lightness and chroma are one value each, not per family', () => {
  // The scale's whole property is that only hue varies. A per-family L or C
  // would make one family louder, which is what generating them avoids.
  const perFamily = (css.match(/--cat-[a-z]+:[^;]*;/g) ?? []).filter((d) =>
    FAMILIES.some((f) => d.startsWith(`--cat-${f}:`)),
  );
  assert.equal(perFamily.length, FAMILIES.length);
  for (const decl of perFamily) {
    assert.ok(decl.includes('var(--cat-l)'), `a family hard-codes lightness: ${decl}`);
    assert.ok(decl.includes('var(--cat-c)'), `a family hard-codes chroma: ${decl}`);
  }
});

test('every family has a label and a note, and they are distinct', () => {
  const labels = FAMILIES.map((f) => FAMILY_LABEL[f]);
  const notes = FAMILIES.map((f) => FAMILY_NOTE[f]);
  assert.equal(new Set(labels).size, FAMILIES.length);
  assert.equal(new Set(notes).size, FAMILIES.length);
  for (const f of FAMILIES) {
    assert.ok(FAMILY_LABEL[f].length > 0, `${f} has no label`);
    assert.ok(FAMILY_NOTE[f].length > 0, `${f} has no note`);
  }
});

test('the stylesheet binds --cat for every family', () => {
  for (const family of FAMILIES) {
    assert.ok(
      css.includes(`[data-family='${family}']`),
      `categories.css does not bind --cat for ${family}`,
    );
  }
});
