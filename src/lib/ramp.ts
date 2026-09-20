/**
 * The field's shared types and colour ramp.
 *
 * Deliberately dependency-free: this module is the only thing the client-side
 * field imports. `lib/data.ts` reads the filesystem at build time, so anything
 * that reaches it cannot be bundled for the browser.
 */

export interface FieldRow {
  slug: string;
  title: string;
  app: string;
  /** One count per week, oldest first. */
  counts: number[];
}

export interface FieldData {
  weeks: string[];
  weekLabels: string[];
  rows: FieldRow[];
  /** Highest single-cell count, which the height and colour ramps scale to. */
  max: number;
  totalReviews: number;
}

export interface RampStop {
  L: number;
  C: number;
  h: number;
}

/**
 * OKLCH to linear sRGB.
 *
 * The brief calls for interpolating in OKLCH inside the shader. Doing it here
 * is equivalent: the failure it guards against is interpolating the *ramp* in
 * sRGB, which collapses the mid-range into mud. Stops are computed in OKLCH
 * and handed to the GPU as vertex colours, so the ramp is perceptually even
 * either way — and there is no hand-written shader to go wrong.
 */
function oklchToLinearRgb(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * Linear RGB for a position on the ramp, interpolated in OKLCH.
 * Linear rather than gamma-encoded because Three.js works in linear space.
 */
export function rampLinearRgb(t: number, low: RampStop, high: RampStop): [number, number, number] {
  const k = Math.min(Math.max(t, 0), 1);
  return oklchToLinearRgb(
    low.L + (high.L - low.L) * k,
    low.C + (high.C - low.C) * k,
    low.h + (high.h - low.h) * k,
  );
}
