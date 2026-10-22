/**
 * Converting a placed item into world transforms and bounds.
 *
 * Every procedural model is authored in a local frame keyed to how it mounts:
 *
 *   wall     → contact plane at z=0, body extends to +z, centred in x/y
 *   floor    → base at y=0, body extends to +y, centred in x/z
 *   tabletop → base at y=0, body extends to +y, centred in x/z
 *   ceiling  → top at y=0, body hangs to -y, centred in x/z
 *   edge     → runs along +x from the origin, cross-section centred in y/z
 *
 * Authoring to the mount face rather than to a centroid means the same
 * `position` value is both the transform origin and the contact point, so
 * snapping, stacking and gravity are all plain arithmetic.
 */

import { Box3, Euler, Quaternion, Vector3 } from "three";
import type { Product } from "@/lib/catalog/types";
import type { SurfaceId, Vec3 } from "@/lib/room/types";
import type { Aabb, PlacedItem } from "./types";

/** Inward normal of each room surface. */
export const SURFACE_NORMALS: Record<SurfaceId, Vec3> = {
  floor: [0, 1, 0],
  ceiling: [0, -1, 0],
  back: [0, 0, 1],
  front: [0, 0, -1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
};

export const WALL_SURFACES: SurfaceId[] = ["back", "front", "left", "right"];

export function isWallSurface(id: SurfaceId | null): boolean {
  return id !== null && WALL_SURFACES.includes(id);
}

/** Yaw that maps local +Z onto a wall's inward normal. */
export function wallYaw(normal: Vec3): number {
  return Math.atan2(normal[0], normal[2]);
}

/**
 * Dimensions in metres, after the scale multiplier.
 *
 * `override` lets a single placed item carry its own real size — a wardrobe
 * traced from a photo is whatever size the user's wardrobe actually is, not
 * whatever the generic catalogue entry says.
 */
export function itemSize(
  product: Product,
  scale: number,
  override?: { w: number; h: number; d: number },
): Vec3 {
  const d = override ?? product.dims;
  return [(d.w / 100) * scale, (d.h / 100) * scale, (d.d / 100) * scale];
}

/** Euler rotation for an item, in the order its mount type expects. */
export function itemEuler(item: PlacedItem, product: Product): Euler {
  if (product.mount === "wall" && item.surface) {
    // YXZ order: Ry(wall) * Rz(spin) — the spin happens in the wall plane, so a
    // poster rotates like a poster instead of tumbling off the wall.
    return new Euler(0, wallYaw(SURFACE_NORMALS[item.surface]), item.spin, "YXZ");
  }
  return new Euler(0, item.yaw, 0, "YXZ");
}

/** Local-space bounding box, before rotation and translation. */
export function localBox(
  product: Product,
  scale: number,
  override?: { w: number; h: number; d: number },
): Aabb {
  const [w, h, d] = itemSize(product, scale, override);
  switch (product.mount) {
    case "wall":
      return { min: [-w / 2, -h / 2, 0], max: [w / 2, h / 2, d] };
    case "ceiling":
      return { min: [-w / 2, -h, -d / 2], max: [w / 2, 0, d / 2] };
    case "edge":
      // Length runs along x and is set by the path, not the product width.
      return { min: [0, -h / 2, -d / 2], max: [w, h / 2, d / 2] };
    case "floor":
    case "tabletop":
    default:
      return { min: [-w / 2, 0, -d / 2], max: [w / 2, h, d / 2] };
  }
}

const _v = new Vector3();
const _q = new Quaternion();

/** World-space AABB. Conservative: the rotated box's own axis-aligned hull. */
export function worldBox(item: PlacedItem, product: Product): Aabb {
  if (product.mount === "edge" && item.path) {
    const [a, b] = item.path;
    const [, h, d] = itemSize(product, item.scale, item.size);
    const pad = Math.max(h, d) / 2;
    return {
      min: [
        Math.min(a[0], b[0]) - pad,
        Math.min(a[1], b[1]) - pad,
        Math.min(a[2], b[2]) - pad,
      ],
      max: [
        Math.max(a[0], b[0]) + pad,
        Math.max(a[1], b[1]) + pad,
        Math.max(a[2], b[2]) + pad,
      ],
    };
  }

  const lb = localBox(product, item.scale, item.size);
  _q.setFromEuler(itemEuler(item, product));

  const box = new Box3();
  box.makeEmpty();
  for (let i = 0; i < 8; i++) {
    _v.set(
      i & 1 ? lb.max[0] : lb.min[0],
      i & 2 ? lb.max[1] : lb.min[1],
      i & 4 ? lb.max[2] : lb.min[2],
    );
    _v.applyQuaternion(_q);
    _v.x += item.position[0];
    _v.y += item.position[1];
    _v.z += item.position[2];
    box.expandByPoint(_v);
  }

  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

/**
 * AABB overlap with a small tolerance so touching faces don't read as a clash.
 *
 * `ignoreAxis` drops one axis from the test. That matters for flat things
 * sharing a plane: a 2mm poster and a 25mm neon sign on the same wall barely
 * overlap along the wall normal, so a tolerance big enough to stop objects
 * fighting over a shared surface is also big enough to let two pictures hang
 * in exactly the same place. On a wall, "do these collide" is a question about
 * the wall plane only.
 */
export function boxesOverlap(
  a: Aabb,
  b: Aabb,
  tol = 0.004,
  ignoreAxis: 0 | 1 | 2 | null = null,
): boolean {
  for (let axis = 0; axis < 3; axis++) {
    if (axis === ignoreAxis) continue;
    if (a.min[axis] >= b.max[axis] - tol || a.max[axis] <= b.min[axis] + tol) {
      return false;
    }
  }
  return true;
}

/**
 * Rugs, mats and other floor coverings are surfaces to put things on, not
 * obstacles to route around. Without this a plant dropped on a rug gets shoved
 * off it, which is the opposite of what anyone decorating a room wants.
 */
export function isFloorCovering(product: Product): boolean {
  return (
    (product.mount === "floor" || product.mount === "tabletop") && product.dims.h <= 4
  );
}

/** How deeply two boxes overlap on each axis. Negative means separated. */
export function overlapDepths(a: Aabb, b: Aabb): Vec3 {
  return [
    Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]),
    Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]),
    Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]),
  ];
}

export function boxCentre(b: Aabb): Vec3 {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

/**
 * The top face of an item, if things can be stacked on it.
 *
 * Returns the plane height plus the usable footprint, inset slightly so an
 * object placed at the very rim does not overhang into thin air.
 */
export function stackSurface(
  item: PlacedItem,
  product: Product,
): { y: number; min: [number, number]; max: [number, number] } | null {
  if (!product.stackable) return null;
  const b = worldBox(item, product);
  const inset = 0.015;
  if (b.max[0] - b.min[0] < inset * 3 || b.max[2] - b.min[2] < inset * 3) return null;
  return {
    y: b.max[1],
    min: [b.min[0] + inset, b.min[2] + inset],
    max: [b.max[0] - inset, b.max[2] - inset],
  };
}

/** Classify a surface normal into the kind of place you can put something. */
export function classifyNormal(n: Vec3): "up" | "down" | "wall" {
  if (n[1] > 0.7) return "up";
  if (n[1] < -0.7) return "down";
  return "wall";
}

/** Nearest room surface id for a given normal, used when snapping to walls. */
export function surfaceForNormal(n: Vec3): SurfaceId | null {
  let best: SurfaceId | null = null;
  let bestDot = 0.5;
  for (const [id, sn] of Object.entries(SURFACE_NORMALS) as [SurfaceId, Vec3][]) {
    const dot = n[0] * sn[0] + n[1] * sn[1] + n[2] * sn[2];
    if (dot > bestDot) {
      bestDot = dot;
      best = id;
    }
  }
  return best;
}
