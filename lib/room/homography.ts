/**
 * Plane-to-plane projective mapping.
 *
 * When each surface gets its own straight-on photo, texturing stops being a
 * camera projection problem and becomes a flat one: the four corners the user
 * marks are the image of that surface's rectangle, and the map between them is
 * a homography. That is exact — no camera pose, no focal length, no assumption
 * about where the photographer stood. It is why six photos produce a far
 * better room than one: every surface is rectified from a frame that actually
 * saw it square-on.
 */

import type { Quad, Vec2 } from "./types";

/** Row-major 3x3. */
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export const IDENTITY_3: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/**
 * Homography mapping the unit square to an arbitrary quad.
 *
 * (0,0)→tl, (1,0)→tr, (1,1)→br, (0,1)→bl. Uses the closed form rather than a
 * general 8x8 solve: the unit-square case collapses to a handful of
 * subtractions, which matters because this runs per surface on every
 * calibration drag.
 */
export function unitSquareToQuad(q: Quad): Mat3 {
  const [x0, y0] = q.tl;
  const [x1, y1] = q.tr;
  const [x2, y2] = q.br;
  const [x3, y3] = q.bl;

  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;

  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;

  // An affine quad (a perfect parallelogram) has no perspective term; the
  // general formula divides by a determinant that is zero there.
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) {
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1];
  }

  const den = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(den) < 1e-12) return IDENTITY_3;

  const g = (sx * dy2 - dx2 * sy) / den;
  const h = (dx1 * sy - sx * dy1) / den;

  return [
    x1 - x0 + g * x1,
    x3 - x0 + h * x3,
    x0,
    y1 - y0 + g * y1,
    y3 - y0 + h * y3,
    y0,
    g,
    h,
    1,
  ];
}

export function applyHomography(m: Mat3, p: Vec2): Vec2 {
  const [x, y] = p;
  const w = m[6] * x + m[7] * y + m[8];
  // A point on the horizon maps to infinity; clamping keeps a degenerate drag
  // from producing NaN UVs that render as black holes in the wall.
  if (Math.abs(w) < 1e-9) return [0, 0];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

export function invertHomography(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return IDENTITY_3;

  const inv = 1 / det;
  return [
    A * inv,
    -(b * i - c * h) * inv,
    (b * f - c * e) * inv,
    B * inv,
    (a * i - c * g) * inv,
    -(a * f - c * d) * inv,
    C * inv,
    -(a * h - b * g) * inv,
    (a * e - b * d) * inv,
  ];
}

/** Map an image point back into the surface's own unit square. */
export function imageToSurface(q: Quad, p: Vec2): Vec2 {
  return applyHomography(invertHomography(unitSquareToQuad(q)), p);
}

/* ------------------------------------------------------------------ */
/* Quad helpers                                                        */
/* ------------------------------------------------------------------ */

/** A quad covering most of the frame — the starting point before the user drags. */
export function defaultSurfaceQuad(inset = 0.08): Quad {
  return {
    tl: [inset, inset],
    tr: [1 - inset, inset],
    br: [1 - inset, 1 - inset],
    bl: [inset, 1 - inset],
  };
}

/** Rotate a quad's corner assignment by 90° steps, to fix a sideways photo. */
export function rotateQuad(q: Quad, steps: number): Quad {
  const corners: Vec2[] = [q.tl, q.tr, q.br, q.bl];
  const n = ((steps % 4) + 4) % 4;
  const r = corners.slice(n).concat(corners.slice(0, n));
  return { tl: r[0], tr: r[1], br: r[2], bl: r[3] };
}

/** Mirror a quad left-to-right, for a photo shot in a mirror or front-camera. */
export function flipQuad(q: Quad): Quad {
  return { tl: q.tr, tr: q.tl, br: q.bl, bl: q.br };
}

/**
 * Is this quad wound clockwise in image space?
 *
 * A quad the user has dragged inside-out projects the texture mirrored, which
 * looks subtly wrong in a way that's hard to name. Detecting it lets the UI
 * warn instead of leaving them to wonder why the door is on the wrong side.
 */
export function isQuadMirrored(q: Quad): boolean {
  const pts: Vec2[] = [q.tl, q.tr, q.br, q.bl];
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % 4];
    area += x1 * y2 - x2 * y1;
  }
  // Image Y points down, so a correctly-ordered quad has negative shoelace area.
  return area > 0;
}
