import {
  CatmullRomCurve3,
  CurvePath,
  LineCurve3,
  QuadraticBezierCurve3,
  Vector3,
  type Curve,
} from "three";
import type { Product } from "@/lib/catalog/types";

/**
 * Neon signs, drawn the way the real ones are made.
 *
 * Every LED neon sign on a shop shelf is the same construction: flexible
 * silicone tube about a centimetre across, bent into strokes — letters,
 * outlines, bars — each run in its own colour, screwed onto a sheet of clear
 * acrylic. A sign is a set of STROKES, not one squiggle in one colour; that
 * is what makes "GAME OVER" read as two lines of coloured letters rather
 * than a glowing scribble.
 *
 * Strokes are authored in a unit box (x right, y up, 0..1) and fitted to the
 * product's real width and height, keeping their proportions.
 */

export interface NeonStroke {
  points: [number, number][];
  /** Tube colour; defaults to the product's emissive colour. */
  colour?: string;
  closed?: boolean;
  /** Smooth curve through the points, or straight runs with bent corners. */
  smooth?: boolean;
}

type P = [number, number];

/* ---------------- a small block font, the style signs use ---------------- */

const LETTERS: Record<string, P[][]> = {
  A: [
    [[0, 0], [0, 0.72], [0.28, 1], [0.72, 1], [1, 0.72], [1, 0]],
    [[0, 0.45], [1, 0.45]],
  ],
  E: [
    [[1, 1], [0, 1], [0, 0], [1, 0]],
    [[0, 0.5], [0.78, 0.5]],
  ],
  G: [[[1, 0.8], [0.82, 1], [0.18, 1], [0, 0.8], [0, 0.2], [0.18, 0], [0.82, 0], [1, 0.2], [1, 0.5], [0.52, 0.5]]],
  M: [[[0, 0], [0, 1], [0.5, 0.52], [1, 1], [1, 0]]],
  O: [[[0.2, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0.2, 1], [0, 0.8], [0, 0.2], [0.2, 0]]],
  R: [
    [[0, 0], [0, 1], [0.78, 1], [1, 0.84], [1, 0.64], [0.78, 0.5], [0, 0.5]],
    [[0.5, 0.5], [1, 0]],
  ],
  V: [[[0, 1], [0.5, 0], [1, 1]]],
};

/** Lay out lines of text in the unit box, one colour per letter if given. */
function text(lines: string[], colours?: string[][]): NeonStroke[] {
  const out: NeonStroke[] = [];
  const rows = lines.length;
  const gapY = 0.16;
  const letterH = (1 - gapY * (rows - 1)) / rows;
  lines.forEach((line, r) => {
    const n = line.length;
    const letterW = Math.min(letterH * 0.78, 1 / (n * 1.22));
    const gapX = letterW * 0.22;
    const total = n * letterW + (n - 1) * gapX;
    const x0 = (1 - total) / 2;
    const y0 = 1 - (r + 1) * letterH - r * gapY;
    [...line].forEach((ch, i) => {
      const glyph = LETTERS[ch];
      if (!glyph) return;
      for (const stroke of glyph) {
        out.push({
          points: stroke.map(([x, y]) => [x0 + i * (letterW + gapX) + x * letterW, y0 + y * letterH]),
          colour: colours?.[r]?.[i],
        });
      }
    });
  });
  return out;
}

const circle = (cx: number, cy: number, r: number, n = 24, ry = r): P[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * ry] as P;
  });


/* ---------------- the designs ---------------- */

function butterfly(): NeonStroke[] {
  // Wider than tall, like the real signs: a broad upper wing sweeping out
  // from the body and a smaller rounded lower wing, mirrored. x is measured
  // from the body's centre line.
  const right: P[] = [
    [0.05, 0.6], [0.14, 0.84], [0.32, 0.98], [0.52, 0.98], [0.65, 0.88], [0.64, 0.7],
    [0.5, 0.56], [0.43, 0.5], [0.56, 0.4], [0.6, 0.22], [0.5, 0.07], [0.31, 0.05],
    [0.15, 0.17], [0.06, 0.4],
  ];
  const left: P[] = right.map(([x, y]) => [-x, y]);
  return [
    { points: right, smooth: true },
    { points: left, smooth: true },
    // Slim body down the middle, and two curling antennae.
    { points: [[-0.025, 0.72], [-0.035, 0.45], [0, 0.14], [0.035, 0.45], [0.025, 0.72], [-0.025, 0.72]], smooth: true },
    { points: [[-0.015, 0.74], [-0.07, 0.88], [-0.14, 0.95], [-0.18, 0.92]], smooth: true },
    { points: [[0.015, 0.74], [0.07, 0.88], [0.14, 0.95], [0.18, 0.92]], smooth: true },
  ];
}

function bolt(): NeonStroke[] {
  return [
    {
      points: [[0.62, 1], [0.12, 0.44], [0.46, 0.44], [0.32, 0], [0.9, 0.6], [0.54, 0.6], [0.62, 1]],
      closed: false,
    },
  ];
}

function soundWave(): NeonStroke[] {
  // Equaliser bars, each its own outlined tube, pink shading through violet to cyan.
  const heights = [0.32, 0.56, 0.78, 1, 0.66, 0.88, 0.48, 0.26];
  const colours = ["#ff4fd8", "#e14dff", "#b44dff", "#7c4dff", "#5b6cff", "#3d8bff", "#2fb6ff", "#3df0ff"];
  const n = heights.length;
  const w = 1 / (n * 1.45);
  const gap = (1 - n * w) / (n - 1);
  return heights.map((h, i) => {
    const x = i * (w + gap);
    return {
      points: [[x, 0], [x, h], [x + w, h], [x + w, 0], [x, 0]] as P[],
      colour: colours[i],
    };
  });
}

function cherry(): NeonStroke[] {
  return [
    { points: [...circle(0.3, 0.26, 0.22), circle(0.3, 0.26, 0.22)[0]], smooth: true, colour: "#ff2d55" },
    { points: [...circle(0.7, 0.3, 0.22), circle(0.7, 0.3, 0.22)[0]], smooth: true, colour: "#ff2d55" },
    { points: [[0.3, 0.48], [0.4, 0.72], [0.56, 0.92]], smooth: true, colour: "#39ff6a" },
    { points: [[0.7, 0.52], [0.64, 0.74], [0.56, 0.92]], smooth: true, colour: "#39ff6a" },
    { points: [[0.56, 0.92], [0.7, 1], [0.88, 0.96], [0.94, 0.86], [0.78, 0.82], [0.62, 0.86], [0.56, 0.92]], smooth: true, colour: "#39ff6a" },
  ];
}

function smiley(): NeonStroke[] {
  const ring = circle(0.5, 0.5, 0.48, 32);
  return [
    { points: [...ring, ring[0]], smooth: true },
    { points: [[0.36, 0.7], [0.36, 0.56]] },
    { points: [[0.64, 0.7], [0.64, 0.56]] },
    { points: [[0.26, 0.42], [0.36, 0.3], [0.5, 0.25], [0.64, 0.3], [0.74, 0.42]], smooth: true },
  ];
}

function kawaii(): NeonStroke[] {
  // か わ い い — "kawaii" in hiragana, four characters in a row.
  const glyphs: P[][][] = [
    [
      [[0.05, 0.6], [0.55, 0.7], [0.62, 0.45], [0.55, 0.12], [0.42, 0.05]],
      [[0.36, 0.95], [0.26, 0.5], [0.12, 0.05]],
      [[0.78, 0.72], [0.9, 0.48]],
    ],
    [
      [[0.3, 0.98], [0.3, 0.02]],
      [[0.06, 0.72], [0.36, 0.76]],
      [[0.3, 0.5], [0.58, 0.74], [0.86, 0.6], [0.84, 0.24], [0.56, 0.06]],
    ],
    [
      [[0.2, 0.86], [0.14, 0.42], [0.3, 0.1]],
      [[0.72, 0.76], [0.86, 0.42]],
    ],
    [
      [[0.2, 0.86], [0.14, 0.42], [0.3, 0.1]],
      [[0.72, 0.76], [0.86, 0.42]],
    ],
  ];
  const out: NeonStroke[] = [];
  glyphs.forEach((g, i) => {
    for (const s of g) {
      // Each character keeps a square cell: the row is four times as wide as tall.
      out.push({ points: s.map(([x, y]) => [i * 1.1 + x, y] as P), smooth: true });
    }
  });
  return out;
}

function gamerTag(): NeonStroke[] {
  // A long name-plate: a rounded frame three times as wide as tall, with the
  // name lettered inside it.
  const W = 3;
  return [
    { points: [[0, 0.12], [0, 0.88], [0.1, 1], [W - 0.1, 1], [W, 0.88], [W, 0.12], [W - 0.1, 0], [0.1, 0], [0, 0.12]] },
    ...text(["GAMER"]).map((s) => ({
      ...s,
      // text() lays the word out in a unit box; stretch it across the plate.
      points: s.points.map(([x, y]) => [0.25 + x * (W - 0.5), 0.18 + y * 0.64] as P),
    })),
  ];
}

function gameOver(): NeonStroke[] {
  return text(["GAME", "OVER"], [
    ["#e6f4ff", "#ff2d55", "#ff9f1a", "#ffd60a"],
    ["#e6f4ff", "#2f9bff", "#ff2d55", "#ffd60a"],
  ]);
}

export function neonStrokes(product: Product): NeonStroke[] {
  const t = product.tags.join(" ");
  const id = product.id;
  if (t.includes("butterfly")) return butterfly();
  if (id.includes("gameover") || t.includes("arcade")) return gameOver();
  if (t.includes("bolt")) return bolt();
  if (t.includes("wave")) return soundWave();
  if (t.includes("cherry")) return cherry();
  if (t.includes("smiley")) return smiley();
  if (t.includes("kawaii") || t.includes("japanese")) return kawaii();
  if (t.includes("gamertag") || t.includes("custom")) return gamerTag();
  return [{ points: [[0, 0.5], [0.2, 0.8], [0.4, 0.3], [0.6, 0.8], [0.8, 0.3], [1, 0.6]], smooth: true }];
}

/**
 * Fit unit-box strokes into a sign of real size w × h (metres), keeping the
 * design's proportions and leaving a margin for the acrylic around it.
 * Returns 3D curves in the sign's plane plus the drawn bounds.
 */
export function fitStrokes(
  strokes: NeonStroke[],
  w: number,
  h: number,
  margin = 0.1,
): { curves: { curve: Curve<Vector3>; colour?: string }[]; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s.points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const sw = Math.max(1e-6, maxX - minX);
  const sh = Math.max(1e-6, maxY - minY);
  const availW = w * (1 - margin * 2);
  const availH = h * (1 - margin * 2);
  const k = Math.min(availW / sw, availH / sh);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;

  const curves = strokes.map((s) => {
    const pts = s.points.map(([x, y]) => new Vector3((x - cx) * k, (y - cy) * k, 0));
    return { curve: s.smooth ? smoothCurve(pts, s.closed) : bentRun(pts, Math.min(w, h) * 0.035), colour: s.colour };
  });
  return { curves, width: sw * k, height: sh * k };
}

function smoothCurve(pts: Vector3[], closed = false): Curve<Vector3> {
  const c = new CatmullRomCurve3(pts, closed);
  c.curveType = "centripetal";
  return c;
}

/**
 * Straight runs with rounded bends — how tube actually takes a corner. A
 * spline through the corners would overshoot them into blobs.
 */
function bentRun(pts: Vector3[], bend: number): Curve<Vector3> {
  const path = new CurvePath<Vector3>();
  if (pts.length < 2) return path;
  let start = pts[0].clone();
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const next = pts[i + 1];
    if (!next) {
      if (start.distanceTo(p) > 1e-6) path.add(new LineCurve3(start, p.clone()));
      break;
    }
    const inDir = p.clone().sub(pts[i - 1]);
    const outDir = next.clone().sub(p);
    const r = Math.min(bend, inDir.length() * 0.45, outDir.length() * 0.45);
    const a = p.clone().sub(inDir.normalize().multiplyScalar(r));
    const b = p.clone().add(outDir.normalize().multiplyScalar(r));
    if (start.distanceTo(a) > 1e-6) path.add(new LineCurve3(start, a));
    path.add(new QuadraticBezierCurve3(a, p.clone(), b));
    start = b;
  }
  return path;
}
