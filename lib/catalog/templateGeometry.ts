import type { CustomTemplate } from "./types";

/**
 * Proportions of matched models (components/studio/models/templates.tsx),
 * kept apart from the drawing so placement can ask where a sofa's seat is.
 * Metres, in the model's own frame: base at y=0, centred in x/z.
 */

/** Where a matched sofa's seat is, for things set down on it (see stackSurfaces). */
export function sofaSeat(w: number, h: number, d: number, t: CustomTemplate) {
  const g = sofaGeometry(w, h, d, t);
  return { y: g.seatTop, x: [-w / 2 + g.armW, w / 2 - g.armW] as [number, number], z: [-d / 2 + g.backD, d / 2] as [number, number] };
}

export function sofaGeometry(w: number, h: number, d: number, t: CustomTemplate) {
  const seats = t.seats ?? (t.kind === "armchair" ? 1 : w > 2.1 ? 3 : 2);
  const legH = Math.min(0.11, h * 0.12);
  const seatTop = Math.min(h * 0.55, 0.48);
  const cushionT = Math.min(0.16, seatTop * 0.36);
  const armW = Math.min(t.kind === "armchair" ? 0.17 : 0.2, w * (t.kind === "armchair" ? 0.2 : 0.09));
  const armH = Math.min(h * 0.74, seatTop + 0.22);
  const backD = Math.min(0.26, d * 0.24);
  return { seats, legH, seatTop, cushionT, armW, armH, backD };
}

