/**
 * Building a room from six independent photos.
 *
 * Nothing is inferred here — the dimensions are the ones the user measured and
 * each surface carries the photo that actually saw it. That makes this path
 * both simpler and more accurate than the single-photo reconstruction: no
 * focal length, no camera height, no vanishing point, and no error compounding
 * across surfaces the original frame only glimpsed at a grazing angle.
 */

import { buildSurfaces, surfaceCorners, surfaceExtent } from "./surfaces";
import type {
  RoomGeometry,
  RoomPlan,
  SurfaceId,
  SurfaceTexture,
  Vec3,
} from "./types";

/** Field of view used for the straight-on "hero" view of a surface. */
const HERO_FOV_Y = 42;

export const DEFAULT_ROOM_DIMENSIONS = { width: 3.5, height: 2.7, depth: 4.0 };

/** Plausible rooms only — a typo shouldn't produce a 90-metre hall. */
export const DIMENSION_LIMITS = {
  width: [1.5, 15] as const,
  height: [1.9, 5] as const,
  depth: [1.5, 20] as const,
};

export function clampDimensions(d: RoomPlan["dimensions"]): RoomPlan["dimensions"] {
  const c = (v: number, [lo, hi]: readonly [number, number]) =>
    !Number.isFinite(v) ? lo : Math.min(hi, Math.max(lo, v));
  return {
    width: c(d.width, DIMENSION_LIMITS.width),
    height: c(d.height, DIMENSION_LIMITS.height),
    depth: c(d.depth, DIMENSION_LIMITS.depth),
  };
}

/** Centre point of a surface, in room-local metres. */
export function surfaceCentre(id: SurfaceId, dims: RoomPlan["dimensions"]): Vec3 {
  const c = surfaceCorners(id, dims);
  return [
    (c[0][0] + c[2][0]) / 2,
    (c[0][1] + c[2][1]) / 2,
    (c[0][2] + c[2][2]) / 2,
  ];
}

/**
 * A camera looking straight at one surface, framed so the surface fills the
 * view. This is what "Photo" mode and the before/after comparison use in full
 * mode — there is no single original viewpoint to return to, but there is a
 * canonical head-on view of each wall, which is exactly the shot the user took.
 */
export function heroCamera(
  id: SurfaceId,
  dims: RoomPlan["dimensions"],
): { position: Vec3; target: Vec3; fovYDeg: number; aspect: number } {
  const [across, down] = surfaceExtent(id, dims);
  const centre = surfaceCentre(id, dims);

  const fovY = (HERO_FOV_Y * Math.PI) / 180;
  const forHeight = down / 2 / Math.tan(fovY / 2);
  const forWidth = across / 2 / Math.tan(fovY / 2) / (across / down);
  const distance = Math.max(forHeight, forWidth);

  const n = {
    back: [0, 0, 1],
    front: [0, 0, -1],
    left: [1, 0, 0],
    right: [-1, 0, 0],
    floor: [0, 1, 0],
    ceiling: [0, -1, 0],
  }[id] as Vec3;

  return {
    position: [
      centre[0] + n[0] * distance,
      centre[1] + n[1] * distance,
      centre[2] + n[2] * distance,
    ],
    target: centre,
    fovYDeg: HERO_FOV_Y,
    aspect: across / down,
  };
}

/** Which surface should the head-on view show? The first one with a photo. */
export function heroSurface(plan: RoomPlan): SurfaceId {
  const preference: SurfaceId[] = ["back", "left", "right", "front", "floor", "ceiling"];
  return preference.find((id) => plan.surfaces[id]) ?? "back";
}

export function buildRoomFromPlan(
  plan: RoomPlan,
  palette: RoomGeometry["palette"],
): RoomGeometry {
  const dimensions = clampDimensions(plan.dimensions);

  const textureFor = (id: SurfaceId): SurfaceTexture => {
    const photo = plan.surfaces[id];
    return photo
      ? { kind: "rectified", imageId: photo.imageId, quad: photo.quad }
      : { kind: "none" };
  };

  const hero = heroSurface(plan);
  const cam = heroCamera(hero, dimensions);

  return {
    dimensions: {
      ...dimensions,
      // No camera solve in this mode; the "back wall distance" is simply how
      // far the room runs, kept so the shape stays compatible with quick mode.
      backWallDistance: dimensions.depth,
    },
    surfaces: buildSurfaces(dimensions, textureFor),
    camera: {
      position: cam.position,
      target: cam.target,
      fovDeg: cam.fovYDeg * cam.aspect,
      fovYDeg: cam.fovYDeg,
      // A head-on shot has no perspective offset to reproduce.
      principal: [0.5, 0.5],
    },
    imageAspect: cam.aspect,
    hero,
    palette,
  };
}

/** How complete a capture is, for progress UI and gentle nudging. */
export function planCoverage(plan: RoomPlan): {
  captured: SurfaceId[];
  missing: SurfaceId[];
  complete: boolean;
} {
  const all: SurfaceId[] = ["back", "left", "right", "front", "floor", "ceiling"];
  const captured = all.filter((id) => Boolean(plan.surfaces[id]));
  const missing = all.filter((id) => !plan.surfaces[id]);
  return { captured, missing, complete: missing.length === 0 };
}
