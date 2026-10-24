/**
 * Carrying what sits on top.
 *
 * Moving a desk moves the lamp on it; turning a table turns the vase with it.
 * Everything resting on an item (and everything resting on *those*) keeps its
 * position relative to the item, so a styled surface survives being moved as
 * a unit instead of being left floating where the table used to be.
 */

import { Matrix4, Vector3 } from "three";
import { productById } from "@/lib/catalog/source";
import type { PlacedItem } from "./types";
import { SURFACE_NORMALS, isWallSurface, wallYaw } from "./transform";

/** Ids of every item resting on `hostId`, directly or through other items. */
export function dependentsOf(items: PlacedItem[], hostId: string): Set<string> {
  const out = new Set<string>();
  let frontier = [hostId];
  while (frontier.length) {
    const next: string[] = [];
    for (const it of items) {
      if (it.supportId && frontier.includes(it.supportId) && !out.has(it.id) && it.id !== hostId) {
        out.add(it.id);
        next.push(it.id);
      }
    }
    frontier = next;
  }
  return out;
}

/** The turn an item applies to things on top of it, about world Y. */
function hostYaw(item: PlacedItem): number {
  const product = productById(item.productId);
  if (product?.mount === "wall" && item.surface && isWallSurface(item.surface)) {
    return wallYaw(SURFACE_NORMALS[item.surface]);
  }
  return item.yaw;
}

function frame(item: PlacedItem): Matrix4 {
  return new Matrix4()
    .makeRotationY(hostYaw(item))
    .setPosition(item.position[0], item.position[1], item.position[2]);
}

/**
 * Apply a host's move from `before` to `after` to everything resting on it.
 * Heights are left for settleItems() to finalise, so a host that changed
 * height (a shelf slid up the wall) still puts its load exactly on its top.
 */
export function carryDependents(
  items: PlacedItem[],
  before: PlacedItem,
  after: PlacedItem,
): PlacedItem[] {
  const deps = dependentsOf(items, before.id);
  if (deps.size === 0) return items;

  const delta = frame(after).multiply(frame(before).invert());
  const dYaw = hostYaw(after) - hostYaw(before);
  if (
    dYaw === 0 &&
    before.position[0] === after.position[0] &&
    before.position[1] === after.position[1] &&
    before.position[2] === after.position[2]
  ) {
    return items;
  }

  const v = new Vector3();
  return items.map((it) => {
    if (!deps.has(it.id)) return it;
    v.set(it.position[0], it.position[1], it.position[2]).applyMatrix4(delta);
    return { ...it, position: [v.x, v.y, v.z], yaw: it.yaw + dYaw };
  });
}
