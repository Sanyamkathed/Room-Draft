import { CatmullRomCurve3, Shape, Vector3 } from "three";
import type { Product } from "@/lib/catalog/types";

/** centimetres → metres. Every model authors in cm and converts once. */
export const M = (cm: number) => cm / 100;

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededRandom(seed: string) {
  let a = hash(seed);
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* Neon tube paths                                                     */
/* ------------------------------------------------------------------ */

type NeonShape = "butterfly" | "bolt" | "wave" | "script" | "frame";

function neonShapeFor(product: Product): NeonShape {
  const t = product.tags.join(" ");
  if (t.includes("butterfly")) return "butterfly";
  if (t.includes("bolt")) return "bolt";
  if (t.includes("wave")) return "wave";
  if (t.includes("gamertag") || t.includes("custom")) return "frame";
  return "script";
}

/**
 * A continuous path for a neon tube, sized to the product's real footprint.
 *
 * Neon is one unbroken bent tube, so every shape here is a single polyline
 * through the product's bounding box — which is also why the sign reads as
 * glass tubing under bloom rather than as a glowing decal.
 */
export function neonPath(product: Product): Vector3[] {
  const w = M(product.dims.w);
  const h = M(product.dims.h);
  const hw = w / 2;
  const hh = h / 2;
  const shape = neonShapeFor(product);
  const pts: Vector3[] = [];

  switch (shape) {
    case "butterfly": {
      // Two mirrored lobes meeting at the body.
      const lobe = (side: number) => {
        for (let i = 0; i <= 22; i++) {
          const t = (i / 22) * Math.PI * 2;
          const r = 1 + 0.42 * Math.cos(2 * t);
          pts.push(
            new Vector3(
              side * (Math.abs(Math.sin(t)) * r * hw * 0.9),
              Math.cos(t) * r * hh * 0.52,
              0,
            ),
          );
        }
      };
      lobe(-1);
      lobe(1);
      break;
    }

    case "bolt": {
      const p: [number, number][] = [
        [0.15, 1],
        [-0.55, 0.05],
        [-0.02, 0.05],
        [-0.2, -1],
        [0.58, -0.1],
        [0.08, -0.1],
        [0.15, 1],
      ];
      for (const [x, y] of p) pts.push(new Vector3(x * hw, y * hh, 0));
      break;
    }

    case "wave": {
      const n = 56;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = (t * 2 - 1) * hw * 0.94;
        // Two summed sines give an audio-waveform feel without looking periodic.
        const y = (Math.sin(t * Math.PI * 5) * 0.62 + Math.sin(t * Math.PI * 11) * 0.3) * hh * 0.8;
        pts.push(new Vector3(x, y, 0));
      }
      break;
    }

    case "frame": {
      const inset = 0.86;
      pts.push(
        new Vector3(-hw * inset, -hh * inset, 0),
        new Vector3(hw * inset, -hh * inset, 0),
        new Vector3(hw * inset, hh * inset, 0),
        new Vector3(-hw * inset, hh * inset, 0),
        new Vector3(-hw * inset, -hh * inset, 0),
      );
      break;
    }

    case "script":
    default: {
      // A looping cursive-like run — reads as neon lettering at a glance.
      const rnd = seededRandom(product.id);
      const loops = 3 + Math.floor(rnd() * 2);
      const n = 26 * loops;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = (t * 2 - 1) * hw * 0.9;
        const phase = t * Math.PI * 2 * loops;
        const y = Math.sin(phase) * hh * 0.56 + Math.sin(phase * 0.5 + 1.2) * hh * 0.22;
        pts.push(new Vector3(x, y, Math.sin(phase * 0.5) * M(0.35)));
      }
      break;
    }
  }

  return pts;
}

export function neonCurve(product: Product): CatmullRomCurve3 {
  const curve = new CatmullRomCurve3(neonPath(product));
  curve.curveType = "centripetal";
  return curve;
}

/* ------------------------------------------------------------------ */
/* Leaf silhouette                                                     */
/* ------------------------------------------------------------------ */

/**
 * A leaf outline, built once and reused.
 *
 * Using a real silhouette rather than a billboard or a squashed sphere is what
 * keeps plants from reading as green blobs — the notched tip and asymmetric
 * curve are visible at the scale a 60cm monstera occupies in a room.
 */
export function leafShape(notched: boolean): Shape {
  const s = new Shape();
  s.moveTo(0, 0);
  s.bezierCurveTo(0.22, 0.18, 0.34, 0.58, 0.06, 1);
  if (notched) {
    // Monstera-style split running back toward the midrib.
    s.lineTo(0.0, 0.78);
    s.lineTo(0.02, 0.6);
    s.lineTo(0.0, 0.42);
  }
  s.bezierCurveTo(-0.34, 0.58, -0.22, 0.18, 0, 0);
  return s;
}

/** Catenary sag between two points, for string lights hung along a run. */
export function catenary(
  a: Vector3,
  b: Vector3,
  sag: number,
  segments = 24,
): Vector3[] {
  const pts: Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = a.clone().lerp(b, t);
    // 4·sag·t·(1-t) is a parabola through both ends with its low point at t=0.5.
    p.y -= 4 * sag * t * (1 - t);
    pts.push(p);
  }
  return pts;
}
