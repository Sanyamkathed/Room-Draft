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
