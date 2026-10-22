/**
 * Turning a rectangle drawn on a wall photo into a real object in the room.
 *
 * This is the bridge that makes tracing worth doing. The wall's homography
 * already maps its photo onto its plane, so inverting it turns pixels the user
 * dragged over into surface-local coordinates — and because the surface has
 * known metric extents, those coordinates are metres. A box drawn around a
 * wardrobe therefore yields the wardrobe's actual width, actual height, and
 * actual position along that wall, with no measuring.
 */

import { imageToSurface } from "./homography";
import { surfaceExtent } from "./surfaces";
import type { Quad, SurfaceId, Vec2, Vec3 } from "./types";

export interface TracedBox {
  /** Real width along the wall, metres. */
  width: number;
  /** Real height, metres. */
  height: number;
  /** Distance from the wall's left edge to the box's centre, metres. */
  centreAcross: number;
  /** Height of the box's bottom edge above the floor, metres. */
  bottom: number;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Measure a traced quad against the surface it was drawn on.
 *
 * The quad is taken as an axis-aligned drag in image space; its corners are
 * pushed back through the surface homography individually and then bounded, so
 * a box drawn over a perspective-skewed wall still measures the right size.
 */
export function measureTrace(
  surfaceQuad: Quad,
  traced: Quad,
  surface: SurfaceId,
  dims: { width: number; height: number; depth: number },
): TracedBox {
  const [across, down] = surfaceExtent(surface, dims);

  const pts: Vec2[] = [traced.tl, traced.tr, traced.br, traced.bl].map((p) =>
    imageToSurface(surfaceQuad, p),
  );

  const sMin = clamp01(Math.min(...pts.map((p) => p[0])));
  const sMax = clamp01(Math.max(...pts.map((p) => p[0])));
  const tMin = clamp01(Math.min(...pts.map((p) => p[1])));
  const tMax = clamp01(Math.max(...pts.map((p) => p[1])));

  return {
    width: Math.max(0.05, (sMax - sMin) * across),
    height: Math.max(0.05, (tMax - tMin) * down),
    centreAcross: ((sMin + sMax) / 2) * across,
    // t runs top-down, so the bottom edge is measured up from the far side.
    bottom: Math.max(0, (1 - tMax) * down),
  };
}

/**
 * Where an object standing against a wall sits in room coordinates.
 *
 * `across` is measured from the wall's left edge as you face it, which is the
 * same direction the rectifier's `s` axis runs — so a measurement taken from
 * the photo drops straight in without a per-wall sign flip at the call site.
 */
export function againstWall(
  surface: SurfaceId,
  across: number,
  depthMetres: number,
  dims: { width: number; height: number; depth: number },
): { position: Vec3; yaw: number } {
  const hw = dims.width / 2;
  const hd = dims.depth / 2;
  const half = depthMetres / 2;

  switch (surface) {
    case "back":
      return { position: [-hw + across, 0, -hd + half], yaw: 0 };
    case "front":
      return { position: [hw - across, 0, hd - half], yaw: Math.PI };
    case "left":
      return { position: [-hw + half, 0, hd - across], yaw: Math.PI / 2 };
    case "right":
      return { position: [hw - half, 0, -hd + across], yaw: -Math.PI / 2 };
    default:
      return { position: [-hw + across, 0, -hd + half], yaw: 0 };
  }
}

/** Which surfaces can furniture be traced against? Walls only. */
export const TRACEABLE_SURFACES: SurfaceId[] = ["back", "left", "right", "front"];
