/**
 * The colour system, generated.
 *
 *   npm run palette        write src/styles/tokens.css
 *   npm run palette -- --check   fail if the file is out of date
 *
 * Two source hues, five tonal palettes, one tone-to-role map, two themes.
 * Nothing in this file is a picked value: every colour the site renders comes
 * out of `tone()` below, which is why the contrast relationships hold without
 * anyone checking them by hand.
 *
 * Material generates its ramps in HCT. This uses OKLCH, which the browser can
 * interpolate natively and which is perceptually uniform in the same way, so a
 * tone maps to a lightness directly. The one thing HCT does that a naive OKLCH
 * ramp does not is taper chroma toward black and white — you cannot have a
 * saturated colour at 4% or 98% lightness — so `chromaAt` does that
 * explicitly. Without it, tone 90 comes out as a fluorescent pastel and tone
 * 10 as a muddy near-black, which is what every hand-rolled "tonal palette"
 * gets wrong.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const OUT = 'src/styles/tokens.css';

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * Primary is what you can do: every action, link and focus ring.
 * Tertiary is what is wrong: quote containers, and the complaint side of a
 * comparison. Two hues with jobs, rather than one decorative accent.
 */
export const SOURCE = {
  primary: { hue: 172, chroma: 0.13 },
  secondary: { hue: 172, chroma: 0.045 },
  tertiary: { hue: 20, chroma: 0.062 },
  neutral: { hue: 172, chroma: 0.006 },
  'neutral-variant': { hue: 172, chroma: 0.016 },
} as const;

export type PaletteName = keyof typeof SOURCE;

/**
 * Chroma cannot hold at the ends of the ramp: pure black and pure white have
 * none, and a colour near either has very little room before it clips out of
 * sRGB. A half-sine over the tone range is the cheapest shape that behaves —
 * full strength through the middle, falling away at both ends — and the 1.18
 * multiplier widens the plateau so tones 30 to 60 stay at full strength
 * rather than peaking only at 50.
 *
 * The second term tilts that curve toward the light end. Symmetric chroma
 * made the dark containers — tone 30, which is what tertiary-container is in
 * dark mode — come out as saturated fills rather than tints, and six of them
 * down a page of quotes read as six warning boxes. A container is a tint.
 */
function chromaAt(peak: number, tone: number): number {
  const t = tone / 100;
  const shape = Math.min(1, 1.18 * Math.sin(Math.PI * t));
  const tilt = 0.62 + 0.38 * t;
  return Math.round(peak * shape * tilt * 10000) / 10000;
}

function tone(palette: PaletteName, t: number): string {
  const { hue, chroma } = SOURCE[palette];
  return `oklch(${t}% ${chromaAt(chroma, t).toFixed(4)} ${hue})`;
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

type Role = [name: string, palette: PaletteName, light: number, dark: number];

/**
 * Material's own tone assignments. The surface-container ramp is the reason
 * this file exists: five steps of neutral that let a page group its content
 * by tone instead of by drawing lines between it.
 */
const ROLES: Role[] = [
  ['primary', 'primary', 40, 80],
  ['on-primary', 'primary', 100, 20],
  ['primary-container', 'primary', 90, 30],
  ['on-primary-container', 'primary', 30, 90],

  ['secondary', 'secondary', 40, 80],
  ['on-secondary', 'secondary', 100, 20],
  ['secondary-container', 'secondary', 90, 30],
  ['on-secondary-container', 'secondary', 30, 90],

  ['tertiary', 'tertiary', 40, 80],
  ['on-tertiary', 'tertiary', 100, 20],
  ['tertiary-container', 'tertiary', 90, 30],
  ['on-tertiary-container', 'tertiary', 30, 90],

  ['surface', 'neutral', 98, 6],
  ['on-surface', 'neutral', 10, 90],
  ['on-surface-variant', 'neutral-variant', 30, 80],
  ['surface-dim', 'neutral', 87, 6],
  ['surface-bright', 'neutral', 98, 24],

  ['surface-container-lowest', 'neutral', 100, 4],
  ['surface-container-low', 'neutral', 96, 10],
  ['surface-container', 'neutral', 94, 12],
  ['surface-container-high', 'neutral', 92, 17],
  ['surface-container-highest', 'neutral', 90, 22],

  ['outline', 'neutral-variant', 50, 60],
  ['outline-variant', 'neutral-variant', 80, 30],

  ['inverse-surface', 'neutral', 20, 90],
  ['inverse-on-surface', 'neutral', 95, 20],
];

const block = (which: 'light' | 'dark', indent: string) =>
  ROLES.map(([name, palette, light, dark]) => {
    const t = which === 'light' ? light : dark;
    return `${indent}--m-${name}: ${tone(palette, t)};`;
  }).join('\n');

/* ------------------------------------------------------------------ */
/* Emit                                                                */
/* ------------------------------------------------------------------ */

const sources = (Object.entries(SOURCE) as [PaletteName, { hue: number; chroma: number }][])
  .map(([name, s]) => `     ${name.padEnd(17)} hue ${String(s.hue).padStart(3)}, peak chroma ${s.chroma}`)
  .join('\n');

const css = `/* ===================================================================
   Generated by scripts/palette.ts. Do not edit by hand.

   Run \`npm run palette\` after changing a source hue; \`npm run palette --
   --check\` fails the build if this file has drifted from the generator.

   Sources:
${sources}

   Dark is the default, so :root carries the dark roles and the light ones
   are written twice — once under a media query for "system", once under the
   attribute for an explicit choice. CSS cannot share a declaration block
   between the two, and the duplication is plainer than the indirection that
   avoids it.
   =================================================================== */

:root {
${block('dark', '  ')}

  color-scheme: dark;
}

@media (prefers-color-scheme: light) {
  :root[data-theme='system'] {
${block('light', '    ')}

    color-scheme: light;
  }
}

:root[data-theme='light'] {
${block('light', '  ')}

  color-scheme: light;
}
`;

if (process.argv.includes('--check')) {
  const current = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n');
  if (current !== css) {
    console.error(`${OUT} is out of date. Run \`npm run palette\`.`);
    process.exit(1);
  }
  console.log(`${OUT} is current: ${ROLES.length} roles from ${Object.keys(SOURCE).length} palettes.`);
} else {
  writeFileSync(OUT, css, 'utf8');
  console.log(`wrote ${OUT}: ${ROLES.length} roles from ${Object.keys(SOURCE).length} palettes.`);
}
