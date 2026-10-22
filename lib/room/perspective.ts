/**
 * Single-image perspective analysis.
 *
 * Estimates the vanishing point of a room photo so we can fit a metric box
 * room to it. The approach is deliberately classical and deterministic — no
 * model weights, no network call, runs in ~40ms on a downscaled copy:
 *
 *   1. downscale → grayscale → Sobel gradients
 *   2. gradient-guided Hough vote (each edge pixel only votes near its own
 *      gradient direction, which is ~90x cheaper than a full Hough sweep)
 *   3. keep the diagonal lines — in a room photo those are the *receding*
 *      edges (wall/ceiling junctions, desk edges); horizontals and verticals
 *      are parallel to the image plane and carry no depth information
 *   4. weighted least-squares intersection of those lines = vanishing point
 *
 * Everything degrades to "image centre" when the photo has no usable
 * structure, which is still a perfectly serviceable one-point perspective.
 */

import type { Quad, Vec2 } from "./types";

const ANALYSIS_WIDTH = 260;
const HOUGH_THETA_BINS = 180;
const HOUGH_RHO_BINS = 220;
const EDGE_THRESHOLD = 42;
/** A line must be at least this many degrees off horizontal AND vertical. */
const DIAGONAL_MIN_DEG = 13;
/** How far along the VP→imageCorner ray the default back-wall corner sits. */
const BACK_WALL_RAY_T = 0.52;

export interface PerspectiveEstimate {
  /** Vanishing point in normalised image coords (0..1). */
  vanishingPoint: Vec2;
  /** 0..1 — how much converging structure we actually found. */
  confidence: number;
  /** Number of receding lines that contributed. */
  lineCount: number;
  palette: { wall: string; floor: string; ceiling: string; accent: string };
}

interface HoughLine {
  theta: number; // normal angle, radians, [0, π)
  rho: number; // distance from origin (analysis-pixel units)
  weight: number;
}

/* ------------------------------------------------------------------ */
/* Image → pixels                                                      */
/* ------------------------------------------------------------------ */

function drawToAnalysisCanvas(
  img: HTMLImageElement | ImageBitmap,
  targetWidth = ANALYSIS_WIDTH,
): ImageData | null {
  const srcW = "naturalWidth" in img ? img.naturalWidth : img.width;
  const srcH = "naturalHeight" in img ? img.naturalHeight : img.height;
  if (!srcW || !srcH) return null;

  const w = Math.min(targetWidth, srcW);
  const h = Math.max(1, Math.round((w * srcH) / srcW));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img as CanvasImageSource, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/* ------------------------------------------------------------------ */
/* Edges                                                               */
/* ------------------------------------------------------------------ */

interface EdgePoint {
  x: number;
  y: number;
  /** Gradient direction as a *normal angle* in [0, π). */
  theta: number;
  mag: number;
}

function sobelEdges(data: ImageData): EdgePoint[] {
  const { width: w, height: h, data: px } = data;
  const gray = new Float32Array(w * h);
  for (let i = 0, p = 0; i < px.length; i += 4, p++) {
    // Rec.709 luma — closer to perceived brightness than a flat average.
    gray[p] = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
  }

  const out: EdgePoint[] = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = gray[i - w - 1],
        t = gray[i - w],
        tr = gray[i - w + 1];
      const l = gray[i - 1],
        r = gray[i + 1];
      const bl = gray[i + w - 1],
        b = gray[i + w],
        br = gray[i + w + 1];

      const gx = tr + 2 * r + br - (tl + 2 * l + bl);
      const gy = bl + 2 * b + br - (tl + 2 * t + tr);
      const mag = Math.hypot(gx, gy);
      if (mag < EDGE_THRESHOLD) continue;

      // Normal angle folded into [0, π) — a line and its 180° flip are the same line.
      let theta = Math.atan2(gy, gx);
      if (theta < 0) theta += Math.PI;
      if (theta >= Math.PI) theta -= Math.PI;
      out.push({ x, y, theta, mag });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Gradient-guided Hough                                               */
/* ------------------------------------------------------------------ */

function houghLines(edges: EdgePoint[], w: number, h: number): HoughLine[] {
  const diag = Math.hypot(w, h);
  const acc = new Float32Array(HOUGH_THETA_BINS * HOUGH_RHO_BINS);
  const thetaStep = Math.PI / HOUGH_THETA_BINS;
  const rhoStep = (2 * diag) / HOUGH_RHO_BINS;

  // Each edge pixel votes only in a ±2-bin window around its own gradient
  // direction. Gradient direction is already an excellent estimate of the
  // line normal, so a full 180-bin sweep would be almost entirely noise.
  const SPREAD = 2;
  for (const e of edges) {
    const centreBin = Math.round(e.theta / thetaStep);
    for (let d = -SPREAD; d <= SPREAD; d++) {
      let tb = centreBin + d;
      // theta wraps at π, and a wrap flips the sign of rho
      let flip = false;
      if (tb < 0) {
        tb += HOUGH_THETA_BINS;
        flip = true;
      } else if (tb >= HOUGH_THETA_BINS) {
        tb -= HOUGH_THETA_BINS;
        flip = true;
      }
      const theta = tb * thetaStep;
      let rho = e.x * Math.cos(theta) + e.y * Math.sin(theta);
      if (flip) rho = -rho;
      const rb = Math.round((rho + diag) / rhoStep);
      if (rb < 0 || rb >= HOUGH_RHO_BINS) continue;
      // Falling weight away from the centre bin, scaled by edge strength.
      acc[tb * HOUGH_RHO_BINS + rb] += e.mag * (1 - Math.abs(d) / (SPREAD + 1));
    }
  }

  // Non-maximum suppression, then keep the strongest peaks.
  const peaks: HoughLine[] = [];
  for (let tb = 0; tb < HOUGH_THETA_BINS; tb++) {
    for (let rb = 1; rb < HOUGH_RHO_BINS - 1; rb++) {
      const v = acc[tb * HOUGH_RHO_BINS + rb];
      if (v <= 0) continue;
      let isMax = true;
      for (let dt = -1; dt <= 1 && isMax; dt++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!dt && !dr) continue;
          const t2 = (tb + dt + HOUGH_THETA_BINS) % HOUGH_THETA_BINS;
          const r2 = rb + dr;
          if (r2 < 0 || r2 >= HOUGH_RHO_BINS) continue;
          if (acc[t2 * HOUGH_RHO_BINS + r2] > v) {
            isMax = false;
            break;
          }
        }
      }
      if (!isMax) continue;
      peaks.push({
        theta: tb * thetaStep,
        rho: rb * rhoStep - diag,
        weight: v,
      });
    }
  }

  peaks.sort((a, b) => b.weight - a.weight);
  return peaks.slice(0, 90);
}

/** Keep lines whose *direction* is diagonal — those are the receding edges. */
function recedingLines(lines: HoughLine[]): HoughLine[] {
  const minRad = (DIAGONAL_MIN_DEG * Math.PI) / 180;
  return lines.filter((l) => {
    // Line direction is perpendicular to its normal.
    let dir = l.theta + Math.PI / 2;
    if (dir >= Math.PI) dir -= Math.PI;
    const offHorizontal = Math.min(dir, Math.PI - dir);
    const offVertical = Math.abs(dir - Math.PI / 2);
    return offHorizontal > minRad && offVertical > minRad;
  });
}

/* ------------------------------------------------------------------ */
/* Least-squares vanishing point                                       */
/* ------------------------------------------------------------------ */

/**
 * Each line constrains the VP to satisfy `p · n = rho`. With 3+ lines the
 * system is overdetermined, so we minimise the weighted squared residual —
 * which reduces to a symmetric 2x2 solve.
 */
function intersectLines(lines: HoughLine[]): { point: Vec2; residual: number } | null {
  if (lines.length < 3) return null;

  let a = 0,
    b = 0,
    c = 0,
    d = 0,
    e = 0,
    f = 0,
    wsum = 0;
  for (const l of lines) {
    const nx = Math.cos(l.theta);
    const ny = Math.sin(l.theta);
    const w = l.weight;
    a += w * nx * nx;
    b += w * nx * ny;
    c += w * nx * ny;
    d += w * ny * ny;
    e += w * nx * l.rho;
    f += w * ny * l.rho;
    wsum += w;
  }

  const det = a * d - b * c;
  // A near-singular system means every line was near-parallel — no real
  // intersection exists and any "solution" would be numerical garbage.
  if (Math.abs(det) < 1e-6 * wsum * wsum) return null;

  const x = (e * d - b * f) / det;
  const y = (a * f - e * c) / det;

  let residual = 0;
  for (const l of lines) {
    const r = x * Math.cos(l.theta) + y * Math.sin(l.theta) - l.rho;
    residual += l.weight * r * r;
  }
  residual = Math.sqrt(residual / wsum);

  return { point: [x, y], residual };
}

/* ------------------------------------------------------------------ */
/* Palette                                                             */
/* ------------------------------------------------------------------ */

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

function averageBand(data: ImageData, y0: number, y1: number): [number, number, number] {
  const { width: w, data: px } = data;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (let y = Math.floor(y0); y < Math.floor(y1); y++) {
    for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4;
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : [128, 128, 128];
}

function samplePalette(data: ImageData) {
  const h = data.height;
  const ceiling = averageBand(data, 0, h * 0.18);
  const wall = averageBand(data, h * 0.25, h * 0.62);
  const floor = averageBand(data, h * 0.78, h);

  // Accent = most common strongly-saturated colour, coarsely quantised so that
  // a poster and its neighbouring pixels land in the same bucket.
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const px = data.data;
  for (let i = 0; i < px.length; i += 16) {
    const r = px[i],
      g = px[i + 1],
      b = px[i + 2];
    const mx = Math.max(r, g, b),
      mn = Math.min(r, g, b);
    if (mx < 40 || mx - mn < 46) continue; // too dark or too grey to be an accent
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const cur = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    cur.n++;
    cur.r += r;
    cur.g += g;
    cur.b += b;
    buckets.set(key, cur);
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const v of buckets.values()) if (!best || v.n > best.n) best = v;

  return {
    ceiling: toHex(ceiling[0], ceiling[1], ceiling[2]),
    wall: toHex(wall[0], wall[1], wall[2]),
    floor: toHex(floor[0], floor[1], floor[2]),
    accent: best
      ? toHex(best.r / best.n, best.g / best.n, best.b / best.n)
      : toHex(wall[0] * 1.1, wall[1] * 1.1, wall[2] * 1.1),
  };
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function analysePerspective(
  img: HTMLImageElement | ImageBitmap,
): PerspectiveEstimate {
  const fallback: PerspectiveEstimate = {
    vanishingPoint: [0.5, 0.5],
    confidence: 0,
    lineCount: 0,
    palette: { wall: "#8d8d93", floor: "#5b5147", ceiling: "#b9b9bd", accent: "#7a8fa6" },
  };

  const data = drawToAnalysisCanvas(img);
  if (!data) return fallback;

  const palette = samplePalette(data);
  const edges = sobelEdges(data);
  if (edges.length < 120) return { ...fallback, palette };

  const lines = recedingLines(houghLines(edges, data.width, data.height));
  const hit = intersectLines(lines);
  if (!hit) return { ...fallback, palette };

  const nx = hit.point[0] / data.width;
  const ny = hit.point[1] / data.height;

  // A VP far outside the frame means the photo is a two-point perspective (shot
  // into a corner) or the estimate is junk. Either way a centred one-point fit
  // is the safer starting guess — the user can drag from there.
  const inFrame = nx > -0.35 && nx < 1.35 && ny > -0.35 && ny < 1.35;
  if (!inFrame) return { ...fallback, palette, lineCount: lines.length };

  const diag = Math.hypot(data.width, data.height);
  const tightness = Math.max(0, 1 - hit.residual / (diag * 0.06));
  const support = Math.min(1, lines.length / 14);
  const confidence = Math.max(0, Math.min(1, tightness * 0.6 + support * 0.4));

  return {
    // Clamp into the central region: a room's VP is essentially never in the
    // outer 12% of the frame, and clamping keeps the derived quads well-formed.
    vanishingPoint: [clamp(nx, 0.12, 0.88), clamp(ny, 0.14, 0.86)],
    confidence,
    lineCount: lines.length,
    palette,
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Default back-wall quad for a given vanishing point.
 *
 * Corners are placed along the rays from the VP to each image corner. This is
 * the "spidery mesh" of Tour Into The Picture (Horry et al., 1997) and it
 * guarantees the four side trapezoids are always well-formed, even when the
 * vanishing point is well off-centre.
 */
export function defaultBackWall(vp: Vec2, t = BACK_WALL_RAY_T): Quad {
  const ray = (cx: number, cy: number): Vec2 => [
    clamp(vp[0] + (cx - vp[0]) * t, 0.04, 0.96),
    clamp(vp[1] + (cy - vp[1]) * t, 0.04, 0.96),
  ];
  return {
    tl: ray(0, 0),
    tr: ray(1, 0),
    br: ray(1, 1),
    bl: ray(0, 1),
  };
}

/** Snap a freely-dragged quad back to an axis-aligned rectangle. */
export function rectifyQuad(q: Quad): Quad {
  const left = (q.tl[0] + q.bl[0]) / 2;
  const right = (q.tr[0] + q.br[0]) / 2;
  const top = (q.tl[1] + q.tr[1]) / 2;
  const bottom = (q.bl[1] + q.br[1]) / 2;
  return {
    tl: [left, top],
    tr: [right, top],
    br: [right, bottom],
    bl: [left, bottom],
  };
}
