/**
 * The six planes of the room box.
 *
 * Corners are ordered TOP-LEFT, TOP-RIGHT, BOTTOM-RIGHT, BOTTOM-LEFT as seen
 * by someone standing inside the room *facing that surface*. Getting this
 * convention right in one place is what lets a rectified photo land the right
 * way up on every surface without per-surface special cases — and it is why
 * "left" and "right" walls have their Z order mirrored relative to each other:
 * turning to face them turns your sense of left with you.
 *
 * For floor and ceiling, "facing it" means standing at the front of the room
 * looking toward the back wall, then tilting down (or up). So the top of the
 * image is the far edge, at the back wall.
 */

import type { RoomSurface, SurfaceId, SurfaceTexture, Vec3 } from "./types";

export interface BoxDimensions {
  width: number;
  height: number;
  depth: number;
}

/** Inward normal of each surface. */
export const INWARD_NORMALS: Record<SurfaceId, Vec3> = {
  floor: [0, 1, 0],
  ceiling: [0, -1, 0],
  back: [0, 0, 1],
  front: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
};

export const SURFACE_ORDER: SurfaceId[] = [
  "back",
  "left",
  "right",
  "front",
  "floor",
  "ceiling",
];

export const SURFACE_LABELS: Record<SurfaceId, string> = {
  back: "Back wall",
  front: "Wall behind you",
  left: "Left wall",
  right: "Right wall",
  floor: "Floor",
  ceiling: "Ceiling",
};

/** How to describe each shot to the user when they're capturing it. */
export const SURFACE_HINTS: Record<SurfaceId, string> = {
  back: "Stand at the door and shoot the wall opposite you, square-on",
  front: "Turn around and shoot the wall you were just standing against",
  left: "Face the left wall and shoot it straight on",
  right: "Face the right wall and shoot it straight on",
  floor: "Point the camera down, holding it level",
  ceiling: "Point the camera straight up",
};

export function surfaceCorners(
  id: SurfaceId,
  { width, height, depth }: BoxDimensions,
): [Vec3, Vec3, Vec3, Vec3] {
  const hw = width / 2;
  const hd = depth / 2;
  const h = height;

  switch (id) {
    // Facing -Z: your right is +X.
    case "back":
      return [
        [-hw, h, -hd],
        [hw, h, -hd],
        [hw, 0, -hd],
        [-hw, 0, -hd],
      ];

    // Facing +Z: your right is -X.
    case "front":
      return [
        [hw, h, hd],
        [-hw, h, hd],
        [-hw, 0, hd],
        [hw, 0, hd],
      ];

    // Facing -X: your right is -Z.
    case "left":
      return [
        [-hw, h, hd],
        [-hw, h, -hd],
        [-hw, 0, -hd],
        [-hw, 0, hd],
      ];

    // Facing +X: your right is +Z.
    case "right":
      return [
        [hw, h, -hd],
        [hw, h, hd],
        [hw, 0, hd],
        [hw, 0, -hd],
      ];

    // Looking down, far edge (back wall) at the top of frame.
    case "floor":
      return [
        [-hw, 0, -hd],
        [hw, 0, -hd],
        [hw, 0, hd],
        [-hw, 0, hd],
      ];

    // Looking up, same orientation as the floor.
    case "ceiling":
    default:
      return [
        [-hw, h, -hd],
        [hw, h, -hd],
        [hw, h, hd],
        [-hw, h, hd],
      ];
  }
}

export function buildSurfaces(
  dims: BoxDimensions,
  textureFor: (id: SurfaceId) => SurfaceTexture,
): RoomSurface[] {
  return SURFACE_ORDER.map((id) => ({
    id,
    corners: surfaceCorners(id, dims),
    normal: INWARD_NORMALS[id],
    texture: textureFor(id),
  }));
}

/** Real-world extent of a surface in metres, as (across, down). */
export function surfaceExtent(
  id: SurfaceId,
  { width, height, depth }: BoxDimensions,
): [number, number] {
  switch (id) {
    case "back":
    case "front":
      return [width, height];
    case "left":
    case "right":
      return [depth, height];
    case "floor":
    case "ceiling":
    default:
      return [width, depth];
  }
}
