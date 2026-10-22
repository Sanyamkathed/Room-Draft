/**
 * Metric room reconstruction from one photo + a calibrated back wall.
 *
 * Pinhole model, camera assumed level (no roll, no pitch), principal point at
 * the vanishing point. Camera at the origin looking down -Z:
 *
 *     u = cx + f·Xc/d        Xc = (u - cx)·d/f
 *     v = cy - f·Yc/d        Yc = -(v - cy)·d/f        d = forward distance
 *
 * The one physical assumption that fixes absolute scale is the camera's height
 * above the floor. Everything else — room width, height, depth, and therefore
 * the true size of every product placed in it — falls out of the geometry.
 * That assumption is exposed to the user as a slider, so scale is correctable
 * rather than guessed and hidden.
 */

import { clamp } from "./perspective";
import { buildSurfaces } from "./surfaces";
import type {
  Quad,
  RoomCalibration,
  RoomGeometry,
  RoomSurface,
  SurfaceId,
  Vec2,
  Vec3,
} from "./types";

export const DEFAULT_FOV_DEG = 66;
export const DEFAULT_CAMERA_HEIGHT = 1.45;
export const DEFAULT_FRONT_EXTENSION = 0.9;

/** Plausible rooms only — keeps a bad drag from producing a 400-metre hallway. */
const LIMITS = {
  width: [1.6, 12] as const,
  height: [2.0, 4.6] as const,
  depth: [1.6, 14] as const,
};

export function defaultCalibration(
  vanishingPoint: Vec2,
  backWall: Quad,
): RoomCalibration {
  return {
    backWall,
    vanishingPoint,
    fovDeg: DEFAULT_FOV_DEG,
    cameraHeight: DEFAULT_CAMERA_HEIGHT,
    frontExtension: DEFAULT_FRONT_EXTENSION,
  };
}

/** Intrinsics derived from the calibration, in pixel units. */
export interface Intrinsics {
  f: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export function intrinsics(cal: RoomCalibration, imgW: number, imgH: number): Intrinsics {
  const hfov = (cal.fovDeg * Math.PI) / 180;
  return {
    f: imgW / 2 / Math.tan(hfov / 2),
    cx: cal.vanishingPoint[0] * imgW,
    cy: cal.vanishingPoint[1] * imgH,
    width: imgW,
    height: imgH,
  };
}

/* ------------------------------------------------------------------ */

export function reconstructRoom(
  cal: RoomCalibration,
  imgW: number,
  imgH: number,
  palette: RoomGeometry["palette"],
): RoomGeometry {
  const K = intrinsics(cal, imgW, imgH);
  const { f, cx, cy } = K;

  // Back wall in pixels. Rectified, so the edges are axis-aligned.
  const uLeft = Math.min(cal.backWall.tl[0], cal.backWall.bl[0]) * imgW;
  const uRight = Math.max(cal.backWall.tr[0], cal.backWall.br[0]) * imgW;
  const vTop = Math.min(cal.backWall.tl[1], cal.backWall.tr[1]) * imgH;
  const vBottom = Math.max(cal.backWall.bl[1], cal.backWall.br[1]) * imgH;

  // The back wall's base sits on the floor, so its image row below the horizon
  // gives the distance to it directly. A base at or above the horizon would be
  // a wall at infinity — clamp to keep the solve finite.
  const baseBelowHorizon = Math.max(vBottom - cy, imgH * 0.02);
  const backWallDistance = clampTo((cal.cameraHeight * f) / baseBelowHorizon, 0.8, 16);

  const xLeft = ((uLeft - cx) * backWallDistance) / f;
  const xRight = ((uRight - cx) * backWallDistance) / f;
  const width = clampTo(xRight - xLeft, LIMITS.width[0], LIMITS.width[1]);

  // Wall height above the camera, from the back wall's top edge.
  const aboveCamera = ((cy - vTop) * backWallDistance) / f;
  const height = clampTo(
    cal.cameraHeight + Math.max(aboveCamera, 0.15),
    LIMITS.height[0],
    LIMITS.height[1],
  );

  const depth = clampTo(
    backWallDistance + cal.frontExtension,
    LIMITS.depth[0],
    LIMITS.depth[1],
  );

  // Room-local frame: centred in X and Z, floor at Y=0, back wall at -depth/2.
  const xCentre = (xLeft + xRight) / 2;
  const camX = -xCentre;
  const camZ = -depth / 2 + backWallDistance;

  // The photo was taken from inside, looking at the back wall, so it can cover
  // every surface except the one behind the photographer.
  const surfaces = buildSurfaces({ width, height, depth }, (id) =>
    id === "front" ? { kind: "none" } : { kind: "projected" },
  );

  const imageAspect = imgW / imgH;
  const hfov = (cal.fovDeg * Math.PI) / 180;
  const fovYDeg = (2 * Math.atan(Math.tan(hfov / 2) / imageAspect) * 180) / Math.PI;

  return {
    dimensions: { width, height, depth, backWallDistance },
    surfaces,
    camera: {
      position: [camX, cal.cameraHeight, camZ],
      target: [camX, cal.cameraHeight, camZ - 1],
      fovDeg: cal.fovDeg,
      fovYDeg,
      principal: cal.vanishingPoint,
    },
    imageAspect,
    palette,
  };
}

function clampTo(v: number, lo: number, hi: number) {
  if (!Number.isFinite(v)) return lo;
  return clamp(v, lo, hi);
}

/* ------------------------------------------------------------------ */
/* Projection — room-local metres → normalised image UV                */
/* ------------------------------------------------------------------ */

/**
 * Project a room-local point back into the source photo.
 *
 * Returns normalised UV with the V axis flipped for WebGL (origin bottom-left),
 * plus `inside`, which is false when the point falls outside the photo. Callers
 * use `inside` to fade unphotographed geometry to a flat palette colour instead
 * of smearing edge pixels across it.
 */
export function projectToImage(
  p: Vec3,
  room: RoomGeometry,
  cal: RoomCalibration,
  imgW: number,
  imgH: number,
): { u: number; v: number; inside: boolean; depth: number } {
  const K = intrinsics(cal, imgW, imgH);
  const cam = room.camera.position;

  // Room-local → camera-local. The camera is axis-aligned (level, no yaw), so
  // this is a translation; forward distance is along -Z.
  const xc = p[0] - cam[0];
  const yc = p[1] - cam[1];
  const d = cam[2] - p[2];

  if (d <= 0.02) {
    return { u: 0.5, v: 0.5, inside: false, depth: d };
  }

  const u = K.cx + (K.f * xc) / d;
  const v = K.cy - (K.f * yc) / d;

  const nu = u / imgW;
  const nv = v / imgH;
  const inside = nu >= 0 && nu <= 1 && nv >= 0 && nv <= 1;

  return { u: nu, v: 1 - nv, inside, depth: d };
}

/** Convenience: the surface a given id refers to. */
export function getSurface(room: RoomGeometry, id: SurfaceId): RoomSurface | undefined {
  return room.surfaces.find((s) => s.id === id);
}

/** Axis-aligned bounds of the room interior, for containment tests. */
export function roomBounds(room: RoomGeometry) {
  const { width, height, depth } = room.dimensions;
  return {
    min: [-width / 2, 0, -depth / 2] as Vec3,
    max: [width / 2, height, depth / 2] as Vec3,
  };
}

/**
 * Where a surface's rectangle lands inside the quick-mode source photo.
 *
 * The single-photo path has no per-surface quad — only a camera — but the
 * camera is exactly what is needed to derive one: project the surface's four
 * 3D corners back into the frame. That lets furniture tracing, which measures
 * against a surface quad, work identically in both capture modes. Without it
 * the one-photo user could never mark their real desk, and so could never put
 * anything on it.
 *
 * Returns null when the surface isn't usefully visible — behind the camera, or
 * so far outside the frame that a trace would be guesswork.
 */
export function surfaceQuadInPhoto(
  room: RoomGeometry,
  cal: RoomCalibration,
  surfaceId: SurfaceId,
  imgW: number,
  imgH: number,
): Quad | null {
  const surface = room.surfaces.find((s) => s.id === surfaceId);
  if (!surface) return null;

  const projected = surface.corners.map((c) =>
    projectToImage(c, room, cal, imgW, imgH),
  );
  if (projected.some((p) => !Number.isFinite(p.u) || p.depth <= 0.05)) return null;

  // Image-space coordinates, with V flipped back from WebGL orientation.
  const pts = projected.map((p) => [p.u, 1 - p.v] as Vec2);

  const inside = pts.filter(
    (p) => p[0] > -0.25 && p[0] < 1.25 && p[1] > -0.25 && p[1] < 1.25,
  ).length;
  if (inside < 3) return null;

  return { tl: pts[0], tr: pts[1], br: pts[2], bl: pts[3] };
}
