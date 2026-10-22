import type { Quad, SurfaceId, Vec3 } from "@/lib/room/types";

/**
 * A product placed in a room.
 *
 * `position` is the object's CONTACT point, not its centre — the middle of
 * whichever face touches the thing it is mounted to:
 *
 *   wall     → centre of the face against the wall
 *   floor    → centre of the base
 *   tabletop → centre of the base
 *   ceiling  → centre of the top face
 *
 * Anchoring at the contact point is what makes "resting on" exact rather than
 * approximate: sitting a figure on a shelf is `position.y = shelfTop`, with no
 * half-height fudge that drifts as the object is scaled.
 */
export interface PlacedItem {
  id: string;
  productId: string;
  position: Vec3;
  /** Rotation about world Y, for floor / tabletop / ceiling items. Radians. */
  yaw: number;
  /** In-plane rotation about the wall normal, for wall items. Radians. */
  spin: number;
  /** Multiplier on the product's real-world dimensions. 1 = true size. */
  scale: number;
  /** Which room surface this is mounted to, if any. */
  surface: SurfaceId | null;
  /** Id of the placed item this one rests on, for stacking and gravity. */
  supportId: string | null;
  /** For edge-mounted runs (LED strips, string lights): the path to follow. */
  path?: [Vec3, Vec3];
  /**
   * Furniture traced from a photo: the region of a surface photo showing this
   * object's face. Used to texture it, so a traced wardrobe looks like the
   * user's wardrobe rather than a generic brown box.
   */
  trace?: { imageId: string; quad: Quad };
  /** Overrides the product's catalogue dimensions, in cm. Set when traced or resized. */
  size?: { w: number; h: number; d: number };
  /**
   * A real product photo, background removed, to render instead of the
   * procedural model. Only meaningful for flat wall decor, where a cutout is
   * not an approximation — the object genuinely is flat.
   */
  customImage?: string;
  createdAt: number;
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}

/** A surface an object can be dropped onto. */
export type TargetKind = "wall" | "floor" | "ceiling" | "itemTop" | "edge";

export interface PlacementTarget {
  kind: TargetKind;
  /** Room surface hit, when the target is part of the room shell. */
  surface: SurfaceId | null;
  /** Item hit, when stacking onto another object. */
  itemId: string | null;
  point: Vec3;
  normal: Vec3;
}

/** Raw hit handed to the resolver by the 3D layer. */
export interface RayHit {
  point: Vec3;
  normal: Vec3;
  surfaceId?: SurfaceId;
  itemId?: string;
}

/** A ray in room-local space, used for the analytic wall fallback. */
export interface Ray {
  origin: Vec3;
  direction: Vec3;
}

export type PlacementIssue =
  | "no-surface"
  | "needs-wall"
  | "needs-floor"
  | "needs-ceiling"
  | "collides"
  | "outside-room"
  | "no-room-on-surface";

/** One axis-aligned guide shown when a dragged item lines up with another. */
export interface AlignmentGuide {
  axis: "x" | "y" | "z";
  value: number;
  /** Room-local endpoints of the line to draw. */
  from: Vec3;
  to: Vec3;
}

export interface PlacementResult {
  item: PlacedItem;
  valid: boolean;
  issue: PlacementIssue | null;
  guides: AlignmentGuide[];
  /** True when the item found support from another object rather than the room. */
  stacked: boolean;
}
