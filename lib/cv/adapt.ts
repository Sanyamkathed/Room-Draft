/**
 * Turning an analysis into things that exist in the room.
 *
 * The service reports what it saw; this decides what to do about it. Two
 * rules shape the whole file:
 *
 *   1. **Never place something the user has to undo.** A detection at 41%
 *      confidence that puts a phantom sofa through their desk is worse than
 *      no detection, because deleting it costs more than adding one would
 *      have. So the bar for auto-placing is high, and anything below it is
 *      dropped rather than placed tentatively.
 *   2. **Measured beats assumed, and the difference is visible.** The
 *      service says how it arrived at every number; that survives into what
 *      the user is told, instead of being flattened into a single number
 *      that looks equally authoritative either way.
 */

import { productById } from "@/lib/catalog/source";
import type { PlacedItem } from "@/lib/placement/types";
import { clampDimensions } from "@/lib/room/plan";
import type { RoomCalibration, RoomGeometry } from "@/lib/room/types";
import type { CvAnalysis, CvObject } from "./client";

/**
 * Minimum detector confidence to place something automatically.
 *
 * Deliberately well above the service's own 0.30 reporting threshold: what
 * is worth *telling* the user about and what is worth silently putting in
 * their room are different questions.
 */
const PLACE_THRESHOLD = 0.55;

/** Detections this far apart or closer are treated as the same object. */
const DUPLICATE_DISTANCE = 0.45;

let counter = 0;
function itemId(): string {
  counter += 1;
  return `cv-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * Which detections earn a place in the room.
 *
 * Only furniture: a detected vase or book is real, but it is *already in the
 * photo*, and adding a generic stand-in for it would double it up — the
 * texture shows one and the model adds another. Large furniture is different
 * because it has to exist as volume for anything to rest on, collide with,
 * or be hidden behind.
 */
export function itemsFromAnalysis(analysis: CvAnalysis): PlacedItem[] {
  const room = clampDimensions({
    width: analysis.dimensions.width,
    height: analysis.dimensions.height,
    depth: analysis.dimensions.depth,
  });

  const kept: { object: CvObject; item: PlacedItem }[] = [];

  for (const object of [...analysis.objects].sort((a, b) => b.confidence - a.confidence)) {
    if (!object.furniture) continue;
    if (object.confidence < PLACE_THRESHOLD) continue;
    if (!object.productId) continue;

    const product = productById(object.productId);
    if (!product) continue;

    // The detector happily boxes the same bed twice from two angles. Keeping
    // the more confident one is cheaper than resolving a collision later.
    const clash = kept.some(
      (k) =>
        k.object.productId === object.productId &&
        Math.hypot(
          k.item.position[0] - object.position[0],
          k.item.position[2] - object.position[2],
        ) < DUPLICATE_DISTANCE,
    );
    if (clash) continue;

    const half = { w: object.sizeCm.w / 200, d: object.sizeCm.d / 200 };
    kept.push({
      object,
      item: {
        id: itemId(),
        productId: object.productId,
        // Clamped again here rather than trusted: the service clamps to the
        // room it measured, and the app clamps that room to plausible
        // limits, so the two can disagree by a few centimetres.
        position: [
          clamp(object.position[0], -room.width / 2 + half.w, room.width / 2 - half.w),
          0,
          clamp(object.position[2], -room.depth / 2 + half.d, room.depth / 2 - half.d),
        ],
        yaw: object.yaw,
        spin: 0,
        scale: 1,
        surface: "floor",
        supportId: null,
        size: { w: object.sizeCm.w, h: object.sizeCm.h, d: object.sizeCm.d },
        createdAt: Date.now(),
      },
    });
  }

  return kept.map((k) => k.item);
}

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return (lo + hi) / 2;
  return Math.min(hi, Math.max(lo, v));
}

/** The calibration, with the service's own field of view carried across. */
export function calibrationFromAnalysis(analysis: CvAnalysis): RoomCalibration {
  return analysis.calibration;
}

export function paletteFromAnalysis(analysis: CvAnalysis): RoomGeometry["palette"] {
  return analysis.palette;
}

/**
 * One line telling the user what actually happened, in their terms.
 *
 * "Measured" is reserved for axes the service fitted two opposing surfaces
 * to. Everything else is described as an estimate, because it is one.
 */
export function summarise(analysis: CvAnalysis): string {
  const d = analysis.dimensions;
  const measured = Object.values(d.measuredFrom).filter((m) => m === "plane").length;
  const placed = analysis.objects.filter(
    (o) => o.furniture && o.confidence >= PLACE_THRESHOLD && o.productId,
  ).length;

  const size = `${d.width.toFixed(1)} × ${d.depth.toFixed(1)} m, ${d.height.toFixed(
    1,
  )} m high`;
  const how =
    measured === 3
      ? "measured"
      : measured > 0
        ? `${measured} of 3 dimensions measured`
        : "estimated";

  const furniture =
    placed > 0 ? ` · found ${placed} piece${placed === 1 ? "" : "s"} of furniture` : "";

  return `${size} (${how})${furniture}`;
}
