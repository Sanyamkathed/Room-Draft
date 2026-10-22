"use client";

/**
 * Flattening a photographed surface into a straight-on rectangle.
 *
 * Canvas2D can only apply *affine* transforms, and a quad-to-rectangle map is
 * projective — so the warp is done as a grid of small triangles, each drawn
 * with the affine transform that maps its own source triangle onto its
 * destination. With enough subdivision the piecewise-affine approximation is
 * visually exact, and it runs on the GPU-backed 2D canvas rather than pixel by
 * pixel in JavaScript.
 *
 * The 3D room does NOT go through this — it maps the homography per vertex
 * and lets the GPU do the rest. This exists for the flat previews: the live
 * "here's your wall, de-skewed" feedback while dragging corners, and the
 * before/after comparison in full-room mode.
 */

import { applyHomography, unitSquareToQuad } from "./homography";
import type { Quad, Vec2 } from "./types";

/** Pixels per metre of real surface, before the size cap. */
const RESOLUTION = 260;
const MAX_DIM = 2048;
const SEGMENTS = 18;

export function rectifiedSize(
  acrossMetres: number,
  downMetres: number,
): { width: number; height: number } {
  const scale = Math.min(
    1,
    MAX_DIM / Math.max(acrossMetres * RESOLUTION, downMetres * RESOLUTION),
  );
  return {
    width: Math.max(16, Math.round(acrossMetres * RESOLUTION * scale)),
    height: Math.max(16, Math.round(downMetres * RESOLUTION * scale)),
  };
}

/** Nudge a triangle outward from its centroid, so neighbours overlap slightly. */
function expand(p: Vec2, cx: number, cy: number, by: number): Vec2 {
  const dx = p[0] - cx;
  const dy = p[1] - cy;
  const len = Math.hypot(dx, dy) || 1;
  return [p[0] + (dx / len) * by, p[1] + (dy / len) * by];
}

function drawTriangle(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  s: [Vec2, Vec2, Vec2],
  d: [Vec2, Vec2, Vec2],
) {
  // Linear part: how the source triangle's edges map onto the destination's.
  const denom =
    s[0][0] * (s[2][1] - s[1][1]) +
    s[1][0] * (s[0][1] - s[2][1]) +
    s[2][0] * (s[1][1] - s[0][1]);
  if (Math.abs(denom) < 1e-9) return;

  const a =
    (d[0][0] * (s[2][1] - s[1][1]) +
      d[1][0] * (s[0][1] - s[2][1]) +
      d[2][0] * (s[1][1] - s[0][1])) /
    denom;
  const b =
    (d[0][1] * (s[2][1] - s[1][1]) +
      d[1][1] * (s[0][1] - s[2][1]) +
      d[2][1] * (s[1][1] - s[0][1])) /
    denom;
  const c =
    (d[0][0] * (s[1][0] - s[2][0]) +
      d[1][0] * (s[2][0] - s[0][0]) +
      d[2][0] * (s[0][0] - s[1][0])) /
    denom;
  const e =
    (d[0][1] * (s[1][0] - s[2][0]) +
      d[1][1] * (s[2][0] - s[0][0]) +
      d[2][1] * (s[0][0] - s[1][0])) /
    denom;

  // Translation solved from the linear part against a known corner, rather
  // than expanded as its own determinant. The expanded form is easy to get
  // sign-flipped, and a flipped translation warps every cell by exactly the
  // offset of its own source triangle — which looks like a plausible image
  // rather than an obvious failure.
  const f = d[0][0] - (a * s[0][0] + c * s[0][1]);
  const g = d[0][1] - (b * s[0][0] + e * s[0][1]);

  // Grow the clip a hair so adjacent cells overlap; otherwise antialiasing
  // leaves a visible lattice of hairlines across the flattened wall.
  const cx = (d[0][0] + d[1][0] + d[2][0]) / 3;
  const cy = (d[0][1] + d[1][1] + d[2][1]) / 3;
  const p0 = expand(d[0], cx, cy, 0.6);
  const p1 = expand(d[1], cx, cy, 0.6);
  const p2 = expand(d[2], cx, cy, 0.6);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0[0], p0[1]);
  ctx.lineTo(p1[0], p1[1]);
  ctx.lineTo(p2[0], p2[1]);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, e, f, g);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

/**
 * Warp the region of `img` bounded by `quad` into a `width` x `height` canvas.
 * Returns null if the quad is degenerate.
 */
export function rectifyToCanvas(
  img: HTMLImageElement,
  quad: Quad,
  width: number,
  height: number,
  segments = SEGMENTS,
): HTMLCanvasElement | null {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (!iw || !ih || width < 2 || height < 2) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.imageSmoothingQuality = "high";

  const H = unitSquareToQuad(quad);
  // Source point in pixels for a given surface-local (s, t).
  const src = (s: number, t: number): Vec2 => {
    const [nx, ny] = applyHomography(H, [s, t]);
    return [nx * iw, ny * ih];
  };

  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const s0 = i / segments;
      const s1 = (i + 1) / segments;
      const t0 = j / segments;
      const t1 = (j + 1) / segments;

      const sa = src(s0, t0);
      const sb = src(s1, t0);
      const sc = src(s1, t1);
      const sd = src(s0, t1);

      const da: Vec2 = [s0 * width, t0 * height];
      const db: Vec2 = [s1 * width, t0 * height];
      const dc: Vec2 = [s1 * width, t1 * height];
      const dd: Vec2 = [s0 * width, t1 * height];

      drawTriangle(ctx, img, [sa, sb, sc], [da, db, dc]);
      drawTriangle(ctx, img, [sa, sc, sd], [da, dc, dd]);
    }
  }

  return canvas;
}

export function rectifyToDataUrl(
  img: HTMLImageElement,
  quad: Quad,
  width: number,
  height: number,
): string | null {
  const canvas = rectifyToCanvas(img, quad, width, height);
  return canvas ? canvas.toDataURL("image/jpeg", 0.86) : null;
}
