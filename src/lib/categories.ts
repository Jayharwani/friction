/**
 * The category system.
 *
 * Fourteen categories is too many to encode visually — fourteen hues is a
 * rainbow, not a system. They group into eight families, and the family is
 * what carries colour and a glyph.
 *
 * The palette is generated, not chosen: fixed lightness, fixed chroma, and
 * eight hues at exactly 45 degrees apart. OKLCH is perceptually uniform, so
 * holding L and C constant means no family is louder than any other — which
 * is the whole point of a categorical scale and the thing a hand-picked set
 * always gets wrong.
 *
 * The rotation is offset so the ring's gap straddles the UI accent's hue.
 * The accent (hue 48) is links, focus rings and the score bar; a family
 * sitting on top of it would blur the two roles. At 22.5 + 45k the nearest
 * family is 22.5 degrees away, which is the furthest any of eight evenly
 * spaced hues can be from a fixed point.
 *
 * Imported by both the site and the build scripts. No React, no node: built-ins.
 */
import type { Category } from '../../scripts/validate';

export const FAMILIES = [
  'stability',
  'speed',
  'money',
  'data',
  'access',
  'wayfinding',
  'interruption',
  'support',
] as const;

export type Family = (typeof FAMILIES)[number];

/** The UI accent's hue. A family may not sit on it — see the note above. */
export const ACCENT_HUE = 48;

export const HUE_STEP = 360 / FAMILIES.length;

/**
 * The ring is rotated so its gap is centred on the accent, which puts the
 * two nearest families exactly half a step away on either side. That is the
 * furthest eight evenly spaced hues can be from a fixed point.
 */
export const HUE_START = (ACCENT_HUE + HUE_STEP / 2) % HUE_STEP;

/** The generated hue for a family, in OKLCH degrees. */
export function hueOf(family: Family): number {
  return HUE_START + FAMILIES.indexOf(family) * HUE_STEP;
}

/**
 * Every category maps to exactly one family. A category missing from here is
 * a bug, not a default — `familyOf` throws rather than guessing, so adding a
 * category to validate.ts without placing it fails the build.
 */
const FAMILY_OF: Record<Category, Family> = {
  'Crashes and stability': 'stability',
  Performance: 'speed',
  'Pricing and billing': 'money',
  'Data loss and sync': 'data',
  'Offline and connectivity': 'data',
  'Accounts and login': 'access',
  Navigation: 'wayfinding',
  'Search and retrieval': 'wayfinding',
  Onboarding: 'wayfinding',
  'Ads and interruptions': 'interruption',
  Notifications: 'interruption',
  Support: 'support',
  Accessibility: 'support',
  Other: 'support',
};

export function familyOf(category: Category | string): Family {
  const family = FAMILY_OF[category as Category];
  if (!family) throw new Error(`No family for category "${category}" — add it to src/lib/categories.ts`);
  return family;
}

/** What the family is called in the interface. */
export const FAMILY_LABEL: Record<Family, string> = {
  stability: 'Stability',
  speed: 'Speed',
  money: 'Money',
  data: 'Data',
  access: 'Access',
  wayfinding: 'Wayfinding',
  interruption: 'Interruption',
  support: 'Support',
};

/** One line on what the family covers, for the legend and for title text. */
export const FAMILY_NOTE: Record<Family, string> = {
  stability: 'Crashes, freezes and the app not staying up',
  speed: 'Slowness and lag',
  money: 'Prices, refunds and billing',
  data: 'Losing work, sync and going offline',
  access: 'Getting in and staying signed in',
  wayfinding: 'Finding things and learning the app',
  interruption: 'Ads and notifications',
  support: 'Getting help, and everything else',
};

/** The categories in a family, in the order validate.ts declares them. */
export function categoriesIn(family: Family): Category[] {
  return (Object.keys(FAMILY_OF) as Category[]).filter((c) => FAMILY_OF[c] === family);
}
