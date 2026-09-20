/**
 * The Friction Field.
 *
 * A plane subdivided across twelve weeks (X) and the tracked problems (Z),
 * with each vertex displaced by how many reviews reported that problem in
 * that week. It is the dataset rendered as topography, not an ornament: the
 * ridges are clickable and navigate to the problem they describe.
 *
 * Loaded dynamically, and only when the viewport is wide enough and WebGL is
 * available. Every failure path is handled by the caller in FrictionField.astro.
 */
import {
  AmbientLight,
  BufferGeometry,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  FogExp2,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';

import { rampLinearRgb, type FieldData, type RampStop } from '../lib/ramp';

/* ------------------------------------------------------------------ */
/* Tunables                                                            */
/* ------------------------------------------------------------------ */

/** Subdivisions per data cell. Enough to read as terrain, cheap enough for 60fps. */
const SUB_X = 4;
const SUB_Z = 3;

/*
 * The data occupies PLANE_W x PLANE_D. The geometry is larger by APRON, and
 * everything outside the data region tapers to zero height — a flat plain
 * around the terrain, rendered in the same near-paper colour as the valleys.
 *
 * That apron is what removes the rectangular edge. Widening the plane alone
 * did not: the camera sits low and close, so the silhouette of the left edge
 * still cut across the frame. The apron runs past the frustum on every side
 * and the far distance is dissolved by fog, so the surface has no boundary
 * anywhere — which is what stops it reading as a brown quadrilateral.
 */
const PLANE_W = 17;
const PLANE_D = 12;
const APRON = 1.9;
const GEO_W = PLANE_W * APRON;
const GEO_D = PLANE_D * APRON;

/** The outer fraction of the data region over which heights ease to zero. */
const TAPER = 0.07;

/**
 * Tallest peak, as a fraction of the plane's width. The heights themselves are
 * normalised against the busiest week in the current dataset, so the field has
 * the same relief whether it is carrying seven reviews or seven hundred.
 */
const PEAK_RATIO = 0.18;
const PEAK_H = PLANE_W * PEAK_RATIO;

/** Total orbit, degrees. Barely perceptible by design. */
const DRIFT_DEG = 6;
const DRIFT_PERIOD_MS = 24_000;

/** Pointer tilt is clamped and spring-damped so it trails rather than tracks. */
const TILT_DEG = 3;
const SPRING = 0.06;

const SETTLE_MS = 900;
const COL_DELAY_MS = 18;

export interface FieldHandle {
  /** Re-read the colour tokens; call after a theme change. */
  refreshTheme(): void;
  destroy(): void;
}

interface Options {
  canvas: HTMLCanvasElement;
  data: FieldData;
  label: HTMLElement;
  reducedMotion: boolean;
  /** Called with a problem slug when a ridge is clicked. */
  onSelect(slug: string): void;
}

const rad = (deg: number) => (deg * Math.PI) / 180;
const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

/** Hermite ease, for the apron taper. */
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Smooth, monotonic ease for the settle. */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** Read an OKLCH token off the document so the field tracks the theme. */
function readStop(name: string, fallback: RampStop): RampStop {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)/.exec(raw);
  if (!m) return fallback;
  const L = Number(m[1]);
  return { L: L > 1 ? L / 100 : L, C: Number(m[2]), h: Number(m[3]) };
}

export function createField({ canvas, data, label, reducedMotion, onSelect }: Options): FieldHandle {
  const cols = data.weeks.length;
  const rows = data.rows.length;
  // Too little data to make a surface: hand back an inert handle.
  if (cols < 2 || rows < 2) return { refreshTheme() {}, destroy() {} };

  const segX = Math.round((cols - 1) * SUB_X * APRON);
  const segZ = Math.round((rows - 1) * SUB_Z * APRON);

  /* ---- heights, sampled bilinearly from the real counts ---- */

  /**
   * Height at a point in data space, 0..1 on both axes.
   *
   * Outside that range there is no data, so the height is zero — the apron.
   * The last few per cent of each edge eases down rather than dropping, so
   * the terrain meets the plain without a crease.
   */
  function sample(gx: number, gz: number): number {
    if (gx < 0 || gx > 1 || gz < 0 || gz > 1) return 0;
    const edge = Math.min(gx, 1 - gx, gz, 1 - gz);
    const taper = edge >= TAPER ? 1 : smoothstep(edge / TAPER);

    const x = clamp01(gx) * (cols - 1);
    const z = clamp01(gz) * (rows - 1);
    const x0 = Math.floor(x);
    const z0 = Math.floor(z);
    const x1 = Math.min(x0 + 1, cols - 1);
    const z1 = Math.min(z0 + 1, rows - 1);
    const fx = x - x0;
    const fz = z - z0;

    const c = (r: number, k: number) => data.rows[r]!.counts[k]! / data.max;
    const a = c(z0, x0) * (1 - fx) + c(z0, x1) * fx;
    const b = c(z1, x0) * (1 - fx) + c(z1, x1) * fx;
    return (a * (1 - fz) + b * fz) * taper;
  }

  /* ---- scene ---- */

  const scene = new Scene();

  // Color.setStyle() does not parse oklch(). Handed one it silently stays
  // white, which fogged the whole surface to white — the ramp was correct all
  // along. Convert the token through the same OKLCH path the ramp uses.
  const paperStop = readStop('--color-paper', { L: 0.14, C: 0.01, h: 45 });
  const [pr, pg, pb] = rampLinearRgb(0, paperStop, paperStop);
  const paper = new Color().setRGB(pr, pg, pb);

  /*
   * Exponential, not linear. Linear fog has a start plane, and at this camera
   * angle that plane was visible as a band across the surface. Exp2 thickens
   * smoothly from the camera outward, so the far edge dissolves into the page
   * with no boundary of its own.
   */
  scene.fog = new FogExp2(paper, 0.045);

  const camera = new PerspectiveCamera(38, 1, 0.1, 100);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(paper, 0);

  /* ---- geometry ---- */

  const geometry = new PlaneGeometry(GEO_W, GEO_D, segX, segZ);
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position!;
  const count = pos.count;
  const targetY = new Float32Array(count);
  const colAt = new Float32Array(count); // 0..1 across the week axis, for the settle
  const colours = new Float32Array(count * 3);

  for (let i = 0; i < count; i++) {
    const gx = (pos.getX(i) + PLANE_W / 2) / PLANE_W;
    const gz = (pos.getZ(i) + PLANE_D / 2) / PLANE_D;
    targetY[i] = sample(gx, gz) * PEAK_H;
    colAt[i] = clamp01(gx);
    pos.setY(i, reducedMotion ? targetY[i]! : 0);
  }

  const colourAttr = new Float32BufferAttribute(colours, 3);
  geometry.setAttribute('color', colourAttr);

  /**
   * Read the ramp off the document and paint it onto the vertices.
   *
   * Called again whenever the theme changes: the field is coloured from CSS
   * tokens, and without this a light/dark switch left the terrain holding the
   * other theme's palette until the next full page load.
   */
  function paintTheme(): void {
    const low = readStop('--color-paper-2', { L: 0.18, C: 0.012, h: 45 });
    const high = readStop('--color-accent', { L: 0.76, C: 0.17, h: 55 });
    for (let i = 0; i < count; i++) {
      // Bias the ramp so low ground still separates from the page.
      const [r, g, b] = rampLinearRgb(Math.pow(targetY[i]! / PEAK_H, 0.72), low, high);
      colourAttr.setXYZ(i, r, g, b);
    }
    colourAttr.needsUpdate = true;

    const stop = readStop('--color-paper', { L: 0.14, C: 0.01, h: 45 });
    const [fr, fg, fb] = rampLinearRgb(0, stop, stop);
    (scene.fog as FogExp2).color.setRGB(fr, fg, fb);
    renderer.setClearColor((scene.fog as FogExp2).color, 0);

    /*
     * The hairlines run from the page colour in the valleys to the ink colour
     * on the ridges, so they brighten over a peak on a dark page and darken
     * over one on a light page. A fixed white line disappeared entirely in
     * light mode.
     */
    const inkStop = readStop('--color-ink', { L: 0.95, C: 0.006, h: 60 });
    const [ir, ig, ib] = rampLinearRgb(1, inkStop, inkStop);
    for (let i = 0; i < gridShades.length; i++) {
      const k = gridShades[i]!;
      gridColourAttr.setXYZ(i, fr + (ir - fr) * k, fg + (ig - fg) * k, fb + (ib - fb) * k);
    }
    gridColourAttr.needsUpdate = true;
  }

  geometry.computeVertexNormals();

  // No emissive: a flat white emissive term washes the ramp out entirely.
  // The vertex colours are the ramp; the lights only shape it.
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
  });

  const mesh = new Mesh(geometry, material);
  scene.add(mesh);

  /* ---- hairline grid along the week and problem axes ---- */

  const gridPositions: number[] = [];
  /** Per-vertex 0..1, how high that point sits. The theme supplies the hue. */
  const gridShades: number[] = [];
  const LIFT = 0.012;

  /**
   * A line segment on the surface, shaded by how high it sits.
   *
   * The hairlines are what give the surface scale — without them it is a
   * smooth brown shape with no sense that it is a grid of measurements. They
   * stay near-invisible in the valleys and brighten over the ridges, so they
   * read as contour rather than as a wireframe laid on top.
   */
  function pushSegment(gx0: number, gz0: number, gx1: number, gz1: number): void {
    const h0 = sample(gx0, gz0);
    const h1 = sample(gx1, gz1);
    gridPositions.push(
      (gx0 - 0.5) * PLANE_W, h0 * PEAK_H + LIFT, (gz0 - 0.5) * PLANE_D,
      (gx1 - 0.5) * PLANE_W, h1 * PEAK_H + LIFT, (gz1 - 0.5) * PLANE_D,
    );
    for (const h of [h0, h1]) {
      gridShades.push(0.1 + 0.9 * Math.pow(h, 0.55));
    }
  }

  // Along the week axis.
  for (let c = 0; c < cols; c++) {
    const gx = c / (cols - 1);
    for (let s = 0; s < segZ; s++) {
      pushSegment(gx, s / segZ, gx, (s + 1) / segZ);
    }
  }
  // Along the problem axis.
  for (let r = 0; r < rows; r++) {
    const gz = r / (rows - 1);
    for (let s = 0; s < segX; s++) {
      pushSegment(s / segX, gz, (s + 1) / segX, gz);
    }
  }

  const gridGeo = new BufferGeometry();
  gridGeo.setAttribute('position', new Float32BufferAttribute(gridPositions, 3));
  const gridColourAttr = new Float32BufferAttribute(new Float32Array(gridShades.length * 3), 3);
  gridGeo.setAttribute('color', gridColourAttr);
  const gridMat = new LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.34,
  });
  const gridLines = new LineSegments(gridGeo, gridMat);
  paintTheme();
  gridLines.visible = reducedMotion;
  scene.add(gridLines);

  /* ---- lighting: one key from upper left, one dim warm fill behind ---- */

  /*
   * One key from the upper left at about 33 degrees, and a dim warm rim from
   * behind the horizon. The low key is what makes the valleys go genuinely
   * dark — ambient is kept down to 0.05 for the same reason. Contrast between
   * a lit ridge and a shadowed valley is the only thing that reads as depth;
   * an emissive surface cannot fake it.
   */
  const key = new DirectionalLight(0xfff1e2, 1.9);
  key.position.set(-7, 5.4, 4.5);
  scene.add(key);

  const rim = new DirectionalLight(0xff9a4d, 0.5);
  rim.position.set(2.5, 0.6, -9);
  scene.add(rim);

  scene.add(new AmbientLight(0xffffff, 0.05));

  /* ---- camera ---- */

  const BASE_AZ = -18;
  /*
   * Twenty degrees above the horizon. At the old thirty-one the surface was
   * being looked down on, which flattens every ridge into a stain; down here
   * the peaks occlude each other and the thing reads as terrain.
   */
  const BASE_EL = 20;
  const DIST = 11.2;
  /**
   * The camera looks at a point left of the surface, which pushes the surface
   * right of centre and clear of the statement. Close enough that the terrain
   * runs off the right edge: a landscape continuing past the frame, not an
   * object sitting in the middle of one.
   */
  /*
   * Aimed right of the surface's centre. The data thins toward the older
   * weeks on the left, so this brings the busy recent end into the middle of
   * the frame and lets the quiet end run off to the left, under the
   * statement, where flat dark terrain is exactly what is wanted.
   */
  const TARGET = { x: 2.4, y: 0.7, z: 0.4 };

  function placeCamera(azDeg: number, elDeg: number): void {
    const az = rad(azDeg);
    const el = rad(elDeg);
    camera.position.set(
      TARGET.x + Math.sin(az) * Math.cos(el) * DIST,
      TARGET.y + Math.sin(el) * DIST,
      TARGET.z + Math.cos(az) * Math.cos(el) * DIST,
    );
    camera.lookAt(TARGET.x, TARGET.y, TARGET.z);
  }

  /* ---- sizing ---- */

  function resize(): void {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    // Cap DPR: the surface is large and 3x costs a lot for no visible gain.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  /* ---- pointer ---- */

  const pointer = new Vector2(0, 0);
  const tilt = { x: 0, y: 0 };
  const tiltTarget = { x: 0, y: 0 };
  const raycaster = new Raycaster();
  let pointerMoved = false;
  let hoverRow = -1;
  let hoverCol = -1;
  let hasPointer = false;

  function onPointerMove(ev: PointerEvent): void {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
    hasPointer = true;
    pointerMoved = true;
    // Under reduced motion the camera never moves, but hovering still reads
    // the surface — the labels are the point, the parallax is the decoration.
    if (reducedMotion) {
      updateLabel(0);
      return;
    }
    tiltTarget.x = pointer.x * TILT_DEG;
    tiltTarget.y = pointer.y * TILT_DEG;
  }

  function onPointerLeave(): void {
    hasPointer = false;
    tiltTarget.x = 0;
    tiltTarget.y = 0;
    hideLabel();
  }

  function hideLabel(): void {
    label.hidden = true;
    canvas.style.cursor = '';
    hoverRow = -1;
    hoverCol = -1;
  }

  /** Which data cell the pointer is over, via a raycast against the surface. */
  function pick(): { row: number; col: number } | null {
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(mesh, false)[0];
    if (!hit) return null;
    const p = hit.point;
    const gx = (p.x + PLANE_W / 2) / PLANE_W;
    const gz = (p.z + PLANE_D / 2) / PLANE_D;
    /*
     * The apron is geometry with no data behind it. Clamping a hit there to
     * the nearest cell would label empty plain with a real problem, and make
     * a click on it navigate — so a hit outside the data region is a miss.
     */
    if (gx < 0 || gx > 1 || gz < 0 || gz > 1) return null;
    return {
      col: Math.round(gx * (cols - 1)),
      row: Math.round(gz * (rows - 1)),
    };
  }

  /**
   * Raycasting every frame costs more than it is worth: the pointer is still
   * most of the time. Pick when it has moved, and once every tenth frame
   * otherwise, so the label still keeps up with the drifting surface.
   */
  function updateLabel(frame: number): void {
    if (!hasPointer || settleT < 1) return;
    if (!pointerMoved && frame % 10 !== 0) return;
    pointerMoved = false;
    const cell = pick();
    if (!cell) {
      hideLabel();
      return;
    }
    if (cell.row === hoverRow && cell.col === hoverCol) return;

    hoverRow = cell.row;
    hoverCol = cell.col;

    const row = data.rows[cell.row]!;
    const n = row.counts[cell.col]!;
    label.hidden = false;
    label.querySelector('[data-f-title]')!.textContent = row.title;
    label.querySelector('[data-f-meta]')!.textContent =
      `${row.app} · week of ${data.weekLabels[cell.col]} · ${n} ${n === 1 ? 'review' : 'reviews'}`;

    // Kept inside the canvas, so a label near the right edge does not hang off it.
    const r = canvas.getBoundingClientRect();
    const lw = label.offsetWidth;
    const lh = label.offsetHeight;
    const lx = Math.min(((pointer.x + 1) / 2) * r.width, r.width - lw - 24);
    const ly = Math.min(((1 - pointer.y) / 2) * r.height, r.height - lh - 24);
    label.style.transform = `translate3d(${Math.round(Math.max(lx, 0))}px, ${Math.round(Math.max(ly, 0))}px, 0)`;
    // The whole row is the problem, so any part of it is a link to it.
    canvas.style.cursor = 'pointer';
  }

  function onClick(): void {
    if (hoverRow < 0) return;
    onSelect(data.rows[hoverRow]!.slug);
  }

  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('click', onClick);

  /* ---- loop ---- */

  let raf = 0;
  let running = false;
  let start = 0;
  /** Animation time consumed before the current run, so a pause is a pause. */
  let elapsedBase = 0;
  let elapsed = 0;
  let frameNo = 0;
  let settleT = reducedMotion ? 1 : 0;

  function frame(now: number): void {
    if (!start) start = now;
    elapsed = elapsedBase + (now - start);

    if (settleT < 1) {
      settleT = clamp01(elapsed / (SETTLE_MS + COL_DELAY_MS * cols));
      // Column by column, left to right.
      for (let i = 0; i < count; i++) {
        const delay = colAt[i]! * COL_DELAY_MS * cols;
        const t = clamp01((elapsed - delay) / SETTLE_MS);
        pos.setY(i, targetY[i]! * easeOutCubic(t));
      }
      pos.needsUpdate = true;
      geometry.computeVertexNormals();
      if (settleT >= 1) gridLines.visible = true;
    }

    const driftAz = reducedMotion
      ? 0
      : Math.sin((elapsed / DRIFT_PERIOD_MS) * Math.PI * 2) * (DRIFT_DEG / 2);

    tilt.x += (tiltTarget.x - tilt.x) * SPRING;
    tilt.y += (tiltTarget.y - tilt.y) * SPRING;

    placeCamera(BASE_AZ + driftAz + tilt.x, BASE_EL - tilt.y);
    frameNo += 1;
    updateLabel(frameNo);
    renderer.render(scene, camera);

    raf = requestAnimationFrame(frame);
  }

  function play(): void {
    if (running) return;
    running = true;
    // Resume where it stopped: a mid-settle pause must not replay the drop,
    // and the drift must not jump phase when the field scrolls back in.
    start = 0;
    raf = requestAnimationFrame(frame);
  }

  function pause(): void {
    if (!running) return;
    running = false;
    cancelAnimationFrame(raf);
    elapsedBase = elapsed;
  }

  /* ---- only run while visible ---- */

  const io = new IntersectionObserver(
    ([entry]) => {
      // A reduced-motion field has no loop to start: one frame, then nothing.
      if (reducedMotion) return;
      if (entry?.isIntersecting) play();
      else pause();
    },
    { threshold: 0 },
  );
  io.observe(canvas);

  function onVisibility(): void {
    if (reducedMotion) return;
    if (document.hidden) pause();
    else if (canvas.getBoundingClientRect().bottom > 0) play();
  }
  document.addEventListener('visibilitychange', onVisibility);

  // A reduced-motion field is one static frame: place, render, stop.
  if (reducedMotion) {
    placeCamera(BASE_AZ, BASE_EL);
    renderer.render(scene, camera);
  }

  return {
    refreshTheme() {
      paintTheme();
      // Repaint immediately: under reduced motion no frame is coming.
      renderer.render(scene, camera);
    },

    destroy() {
      pause();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('click', onClick);
      geometry.dispose();
      gridGeo.dispose();
      material.dispose();
      gridMat.dispose();
      renderer.dispose();
    },
  };
}
