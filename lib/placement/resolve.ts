/**
 * Placement resolution — the rule that turns "the cursor is roughly there"
 * into "the object sits exactly here".
 *
 * One entry point, `resolvePlacement`, runs the whole chain every frame while
 * dragging: pick the legal target for this mount type, clamp the footprint to
 * stay on that surface, snap to the grid, snap to neighbouring items (emitting
 * guides), then push out of anything it collides with. The result is either a
 * valid placement or a specific reason it is not, which the ghost renders as
 * colour and the toolbar renders as a hint.
 */

import type { Product } from "@/lib/catalog/types";
import { productById } from "@/lib/catalog/source";
import type { RoomGeometry, SurfaceId, Vec3 } from "@/lib/room/types";
import {
  SURFACE_NORMALS,
  WALL_SURFACES,
  boxesOverlap,
  isFloorCovering,
  itemSize,
  localBox,
  overlapDepths,
  stackSurface,
  worldBox,
} from "./transform";
import type {
  AlignmentGuide,
  PlacedItem,
  PlacementIssue,
  PlacementResult,
  Ray,
  RayHit,
} from "./types";

export const DEFAULT_GRID = 0.05; // 5cm
const ALIGN_THRESHOLD = 0.045; // 4.5cm — close enough to read as "lined up"
const MAX_RESOLVE_STEPS = 4;
/** How far above its base an item will still settle onto a surface. */
const CLIMB_TOLERANCE = 0.05;

export interface ResolveContext {
  room: RoomGeometry;
  /** Every item already in the room. The dragged item must not be in here. */
  items: PlacedItem[];
  hit: RayHit | null;
  ray: Ray | null;
  gridSnap: boolean;
  grid?: number;
  /** Carried over when moving an existing item. */
  yaw?: number;
  spin?: number;
  scale?: number;
  /** Reuse the id when moving rather than placing fresh. */
  id?: string;
  /** Real dimensions for this item, overriding the catalogue entry. */
  size?: { w: number; h: number; d: number };
  /** Carried through when moving a traced piece of furniture. */
  trace?: PlacedItem["trace"];
}

/* ------------------------------------------------------------------ */
/* Wall coordinate helpers                                             */
/* ------------------------------------------------------------------ */

/** World point → 2D coordinates in a wall's own plane. */
function toWall(surface: SurfaceId, p: Vec3): [number, number] {
  switch (surface) {
    case "back":
      return [p[0], p[1]];
    case "front":
      return [-p[0], p[1]];
    case "left":
      return [-p[2], p[1]];
    case "right":
      return [p[2], p[1]];
    default:
      return [p[0], p[1]];
  }
}

/** 2D wall coordinates → world point on that wall's plane. */
function fromWall(surface: SurfaceId, u: number, v: number, room: RoomGeometry): Vec3 {
  const { width, depth } = room.dimensions;
  switch (surface) {
    case "back":
      return [u, v, -depth / 2];
    case "front":
      return [-u, v, depth / 2];
    case "left":
      return [-width / 2, v, -u];
    case "right":
      return [width / 2, v, u];
    default:
      return [u, v, -depth / 2];
  }
}

function wallExtent(surface: SurfaceId, room: RoomGeometry) {
  const { width, height, depth } = room.dimensions;
  const half = surface === "left" || surface === "right" ? depth / 2 : width / 2;
  return { uMin: -half, uMax: half, vMin: 0, vMax: height };
}

/** Footprint of a rotated rectangle, as half-extents on each axis. */
function rotatedHalfExtents(a: number, b: number, angle: number): [number, number] {
  const c = Math.abs(Math.cos(angle));
  const s = Math.abs(Math.sin(angle));
  return [(a * c + b * s) / 2, (a * s + b * c) / 2];
}

/* ------------------------------------------------------------------ */
/* Ray intersections                                                   */
/* ------------------------------------------------------------------ */

function rayPlaneY(ray: Ray, y: number): Vec3 | null {
  if (Math.abs(ray.direction[1]) < 1e-6) return null;
  const t = (y - ray.origin[1]) / ray.direction[1];
  if (t <= 0) return null;
  return [
    ray.origin[0] + ray.direction[0] * t,
    y,
    ray.origin[2] + ray.direction[2] * t,
  ];
}

/**
 * Nearest wall the ray enters, used when a wall item is dragged over the floor
 * or over another object. Without this the ghost would simply vanish whenever
 * the cursor left the wall, which feels broken; with it, a poster dragged
 * across the room slides along whichever wall is behind the cursor.
 */
function rayNearestWall(
  ray: Ray,
  room: RoomGeometry,
): { surface: SurfaceId; point: Vec3 } | null {
  const { width, height, depth } = room.dimensions;
  let best: { surface: SurfaceId; point: Vec3; t: number } | null = null;

  const planes: { surface: SurfaceId; axis: 0 | 2; value: number }[] = [
    { surface: "back", axis: 2, value: -depth / 2 },
    { surface: "front", axis: 2, value: depth / 2 },
    { surface: "left", axis: 0, value: -width / 2 },
    { surface: "right", axis: 0, value: width / 2 },
  ];

  for (const pl of planes) {
    const d = ray.direction[pl.axis];
    if (Math.abs(d) < 1e-6) continue;
    const t = (pl.value - ray.origin[pl.axis]) / d;
    if (t <= 0.01) continue;

    const p: Vec3 = [
      ray.origin[0] + ray.direction[0] * t,
      ray.origin[1] + ray.direction[1] * t,
      ray.origin[2] + ray.direction[2] * t,
    ];
    if (p[1] < -0.2 || p[1] > height + 0.2) continue;

    const other = pl.axis === 0 ? p[2] : p[0];
    const limit = pl.axis === 0 ? depth / 2 : width / 2;
    if (Math.abs(other) > limit + 0.2) continue;

    if (!best || t < best.t) best = { surface: pl.surface, point: p, t };
  }

  return best ? { surface: best.surface, point: best.point } : null;
}

/* ------------------------------------------------------------------ */
/* Edges (LED strips, string lights)                                   */
/* ------------------------------------------------------------------ */

interface EdgeSegment {
  a: Vec3;
  b: Vec3;
}

function roomEdges(room: RoomGeometry): EdgeSegment[] {
  const { width: w, height: h, depth: d } = room.dimensions;
  const x0 = -w / 2,
    x1 = w / 2,
    z0 = -d / 2,
    z1 = d / 2;

  const horizontal = (y: number): EdgeSegment[] => [
    { a: [x0, y, z0], b: [x1, y, z0] },
    { a: [x0, y, z1], b: [x1, y, z1] },
    { a: [x0, y, z0], b: [x0, y, z1] },
    { a: [x1, y, z0], b: [x1, y, z1] },
  ];

  return [
    ...horizontal(0),
    ...horizontal(h),
    // Vertical corners — an LED strip running up a corner is a real look.
    { a: [x0, 0, z0], b: [x0, h, z0] },
    { a: [x1, 0, z0], b: [x1, h, z0] },
    { a: [x0, 0, z1], b: [x0, h, z1] },
    { a: [x1, 0, z1], b: [x1, h, z1] },
  ];
}

/** Top-face edges of stackable items — this is what "along a desk edge" means. */
function itemEdges(items: PlacedItem[]): EdgeSegment[] {
  const out: EdgeSegment[] = [];
  for (const it of items) {
    const product = productById(it.productId);
    if (!product) continue;
    const top = stackSurface(it, product);
    if (!top) continue;
    const [x0, z0] = top.min;
    const [x1, z1] = top.max;
    out.push(
      { a: [x0, top.y, z0], b: [x1, top.y, z0] },
      { a: [x0, top.y, z1], b: [x1, top.y, z1] },
      { a: [x0, top.y, z0], b: [x0, top.y, z1] },
      { a: [x1, top.y, z0], b: [x1, top.y, z1] },
    );
  }
  return out;
}

function closestPointOnSegment(p: Vec3, s: EdgeSegment): { point: Vec3; t: number } {
  const dx = s.b[0] - s.a[0],
    dy = s.b[1] - s.a[1],
    dz = s.b[2] - s.a[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return { point: s.a, t: 0 };
  let t =
    ((p[0] - s.a[0]) * dx + (p[1] - s.a[1]) * dy + (p[2] - s.a[2]) * dz) / len2;
  t = Math.max(0, Math.min(1, t));
  return { point: [s.a[0] + dx * t, s.a[1] + dy * t, s.a[2] + dz * t], t };
}

function resolveEdgePlacement(
  product: Product,
  point: Vec3,
  room: RoomGeometry,
  items: PlacedItem[],
  scale: number,
  override?: { w: number; h: number; d: number },
): { path: [Vec3, Vec3]; position: Vec3 } | null {
  const edges = [...roomEdges(room), ...itemEdges(items)];
  let best: { seg: EdgeSegment; point: Vec3; dist: number } | null = null;

  for (const seg of edges) {
    const c = closestPointOnSegment(point, seg);
    const dist = Math.hypot(
      c.point[0] - point[0],
      c.point[1] - point[1],
      c.point[2] - point[2],
    );
    if (!best || dist < best.dist) best = { seg, point: c.point, dist };
  }
  if (!best) return null;

  const segLen = Math.hypot(
    best.seg.b[0] - best.seg.a[0],
    best.seg.b[1] - best.seg.a[1],
    best.seg.b[2] - best.seg.a[2],
  );
  // Strips come on a reel — a 5m run on a 3m wall is cut to fit, not overhung.
  const runLength = Math.min(((override?.w ?? product.dims.w) / 100) * scale, segLen);

  const dir: Vec3 = [
    (best.seg.b[0] - best.seg.a[0]) / segLen,
    (best.seg.b[1] - best.seg.a[1]) / segLen,
    (best.seg.b[2] - best.seg.a[2]) / segLen,
  ];

  const centreT =
    (best.point[0] - best.seg.a[0]) * dir[0] +
    (best.point[1] - best.seg.a[1]) * dir[1] +
    (best.point[2] - best.seg.a[2]) * dir[2];

  const start = Math.max(0, Math.min(segLen - runLength, centreT - runLength / 2));
  const from: Vec3 = [
    best.seg.a[0] + dir[0] * start,
    best.seg.a[1] + dir[1] * start,
    best.seg.a[2] + dir[2] * start,
  ];
  const to: Vec3 = [
    from[0] + dir[0] * runLength,
    from[1] + dir[1] * runLength,
    from[2] + dir[2] * runLength,
  ];

  return { path: [from, to], position: from };
}

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

function snapToGrid(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}

/**
 * Pull a coordinate onto a neighbour's edge or centre when it is already close.
 *
 * Alignment snapping is what separates "I dropped three posters near each
 * other" from "I hung a row of posters". Candidates are the neighbour's two
 * edges and its centre, so items line up flush *or* centred, whichever the
 * user was already aiming at.
 */
function alignAxis(
  value: number,
  halfExtent: number,
  neighbours: { centre: number; half: number }[],
): { value: number; guide: number } | null {
  let best: { value: number; guide: number; delta: number } | null = null;

  for (const n of neighbours) {
    const candidates: [number, number][] = [
      [n.centre, n.centre], // centre-to-centre
      [n.centre - n.half + halfExtent, n.centre - n.half], // flush left/bottom
      [n.centre + n.half - halfExtent, n.centre + n.half], // flush right/top
      [n.centre - n.half - halfExtent, n.centre - n.half], // butted outside
      [n.centre + n.half + halfExtent, n.centre + n.half],
    ];
    for (const [snapped, guide] of candidates) {
      const delta = Math.abs(snapped - value);
      if (delta < ALIGN_THRESHOLD && (!best || delta < best.delta)) {
        best = { value: snapped, guide, delta };
      }
    }
  }

  return best ? { value: best.value, guide: best.guide } : null;
}

/* ------------------------------------------------------------------ */
/* Collision                                                           */
/* ------------------------------------------------------------------ */

function collidingItems(
  candidate: PlacedItem,
  product: Product,
  items: PlacedItem[],
): { item: PlacedItem; product: Product }[] {
  const box = worldBox(candidate, product);
  const out: { item: PlacedItem; product: Product }[] = [];

  for (const other of items) {
    if (other.id === candidate.id) continue;
    const op = productById(other.productId);
    if (!op) continue;
    // The thing you are standing on is support, not an obstacle.
    if (candidate.supportId === other.id) continue;
    if (other.supportId === candidate.id) continue;
    // Rugs and mats are surfaces, not walls — you stand things on them.
    if (isFloorCovering(op) && !isFloorCovering(product)) continue;

    let ignoreAxis: 0 | 1 | 2 | null = null;
    if (product.mount === "wall" && op.mount === "wall") {
      // Different walls never fight: a poster on the back wall and one on the
      // left wall can share a corner without either being blocked.
      if (candidate.surface !== other.surface) continue;
      // On the SAME wall, collision is a question about the wall plane, so the
      // near-zero depth along the wall normal must not decide it.
      ignoreAxis = candidate.surface === "left" || candidate.surface === "right" ? 0 : 2;
    }

    if (boxesOverlap(box, worldBox(other, op), 0.004, ignoreAxis)) {
      out.push({ item: other, product: op });
    }
  }

  return out;
}

/**
 * Nudge a candidate out of whatever it overlaps, along the surface only.
 *
 * `limits` bound each axis to the space the item is allowed to occupy. Without
 * them a crowded room resolves collisions by pushing objects straight through
 * the wall — the separation maths is perfectly happy to keep sliding, and a
 * chair ends up standing outside the building.
 */
function pushApart(
  candidate: PlacedItem,
  product: Product,
  items: PlacedItem[],
  axes: (0 | 1 | 2)[],
  limits?: Partial<Record<0 | 1 | 2, [number, number]>>,
): { item: PlacedItem; resolved: boolean } {
  let current = candidate;

  for (let step = 0; step < MAX_RESOLVE_STEPS; step++) {
    const hits = collidingItems(current, product, items);
    if (hits.length === 0) return { item: current, resolved: true };

    const box = worldBox(current, product);
    const other = worldBox(hits[0].item, hits[0].product);
    const depths = overlapDepths(box, other);

    // Separate along whichever allowed axis needs the least movement.
    let axis = axes[0];
    let least = Infinity;
    for (const a of axes) {
      if (depths[a] < least) {
        least = depths[a];
        axis = a;
      }
    }
    if (!Number.isFinite(least) || least <= 0) return { item: current, resolved: false };

    const boxC = (box.min[axis] + box.max[axis]) / 2;
    const otherC = (other.min[axis] + other.max[axis]) / 2;
    const dir = boxC >= otherC ? 1 : -1;

    const position: Vec3 = [...current.position];
    position[axis] += dir * (least + 0.003);

    const limit = limits?.[axis];
    if (limit) {
      const clamped = Math.max(limit[0], Math.min(limit[1], position[axis]));
      // Clamping means we pushed into a wall; there is nowhere left to go on
      // this axis, so report it blocked rather than leaving it half-buried.
      if (Math.abs(clamped - position[axis]) > 1e-6) {
        return { item: { ...current, position: [...current.position] }, resolved: false };
      }
      position[axis] = clamped;
    }

    current = { ...current, position };
  }

  return { item: current, resolved: collidingItems(current, product, items).length === 0 };
}

/* ------------------------------------------------------------------ */
/* Main resolver                                                       */
/* ------------------------------------------------------------------ */

export function resolvePlacement(
  product: Product,
  ctx: ResolveContext,
): PlacementResult | null {
  const grid = ctx.grid ?? DEFAULT_GRID;
  const scale = ctx.scale ?? 1;
  const yaw = ctx.yaw ?? 0;
  const spin = ctx.spin ?? 0;
  const guides: AlignmentGuide[] = [];

  const base: PlacedItem = {
    id: ctx.id ?? `item_${Math.random().toString(36).slice(2, 10)}`,
    productId: product.id,
    position: [0, 0, 0],
    yaw,
    spin,
    scale,
    surface: null,
    supportId: null,
    size: ctx.size,
    trace: ctx.trace,
    createdAt: Date.now(),
  };

  const fail = (issue: PlacementIssue, item = base): PlacementResult => ({
    item,
    valid: false,
    issue,
    guides,
    stacked: false,
  });

  /* -------------------- EDGE -------------------- */
  if (product.mount === "edge") {
    const point = ctx.hit?.point ?? (ctx.ray ? rayPlaneY(ctx.ray, 0) : null);
    if (!point) return fail("no-surface");
    const edge = resolveEdgePlacement(product, point, ctx.room, ctx.items, scale, ctx.size);
    if (!edge) return fail("no-surface");
    return {
      item: { ...base, position: edge.position, path: edge.path, surface: null },
      valid: true,
      issue: null,
      guides,
      stacked: false,
    };
  }

  /* -------------------- WALL -------------------- */
  if (product.mount === "wall") {
    let surface: SurfaceId | null = null;
    let point: Vec3 | null = null;

    if (ctx.hit?.surfaceId && WALL_SURFACES.includes(ctx.hit.surfaceId)) {
      surface = ctx.hit.surfaceId;
      point = ctx.hit.point;
    } else if (ctx.ray) {
      const w = rayNearestWall(ctx.ray, ctx.room);
      if (w) {
        surface = w.surface;
        point = w.point;
      }
    }
    if (!surface || !point) return fail("needs-wall");

    const [w, h] = itemSize(product, scale, ctx.size);
    const [hu, hv] = rotatedHalfExtents(w, h, spin);
    const ext = wallExtent(surface, ctx.room);

    let [u, v] = toWall(surface, point);

    const tooWide = hu * 2 > ext.uMax - ext.uMin;
    const tooTall = hv * 2 > ext.vMax - ext.vMin;

    if (ctx.gridSnap) {
      u = snapToGrid(u, grid);
      v = snapToGrid(v, grid);
    }

    // Align against other items already on this same wall.
    const neighboursU: { centre: number; half: number }[] = [];
    const neighboursV: { centre: number; half: number }[] = [];
    for (const other of ctx.items) {
      if (other.id === base.id || other.surface !== surface) continue;
      const op = productById(other.productId);
      if (!op || op.mount !== "wall") continue;
      const [ow, oh] = itemSize(op, other.scale, other.size);
      const [ohu, ohv] = rotatedHalfExtents(ow, oh, other.spin);
      const [ou, ov] = toWall(surface, other.position);
      neighboursU.push({ centre: ou, half: ohu });
      neighboursV.push({ centre: ov, half: ohv });
    }

    const au = alignAxis(u, hu, neighboursU);
    const av = alignAxis(v, hv, neighboursV);
    if (au) u = au.value;
    if (av) v = av.value;

    // Keep the whole item on the wall.
    u = tooWide
      ? (ext.uMin + ext.uMax) / 2
      : Math.max(ext.uMin + hu, Math.min(ext.uMax - hu, u));
    v = tooTall
      ? (ext.vMin + ext.vMax) / 2
      : Math.max(ext.vMin + hv, Math.min(ext.vMax - hv, v));

    if (au) {
      const g = fromWall(surface, au.guide, ext.vMin, ctx.room);
      const g2 = fromWall(surface, au.guide, ext.vMax, ctx.room);
      guides.push({ axis: "y", value: au.guide, from: g, to: g2 });
    }
    if (av) {
      const g = fromWall(surface, ext.uMin, av.guide, ctx.room);
      const g2 = fromWall(surface, ext.uMax, av.guide, ctx.room);
      guides.push({ axis: "x", value: av.guide, from: g, to: g2 });
    }

    const candidate: PlacedItem = {
      ...base,
      surface,
      position: fromWall(surface, u, v, ctx.room),
    };

    if (tooWide || tooTall) {
      return { item: candidate, valid: false, issue: "no-room-on-surface", guides, stacked: false };
    }

    // Wall items separate within the wall plane, never off it — and never past
    // the edges of the wall they are hanging on.
    const sideWall = surface === "left" || surface === "right";
    const planeAxes: (0 | 1 | 2)[] = sideWall ? [2, 1] : [0, 1];
    const acrossAxis: 0 | 2 = sideWall ? 2 : 0;
    const pushed = pushApart(candidate, product, ctx.items, planeAxes, {
      [acrossAxis]: [ext.uMin + hu, ext.uMax - hu],
      1: [ext.vMin + hv, ext.vMax - hv],
    } as Partial<Record<0 | 1 | 2, [number, number]>>);
    if (!pushed.resolved) {
      return { item: candidate, valid: false, issue: "collides", guides, stacked: false };
    }

    return { item: pushed.item, valid: true, issue: null, guides, stacked: false };
  }

  /* -------------------- CEILING -------------------- */
  if (product.mount === "ceiling") {
    const y = ctx.room.dimensions.height;
    let point: Vec3 | null = null;

    if (ctx.hit?.surfaceId === "ceiling") point = ctx.hit.point;
    else if (ctx.ray) point = rayPlaneY(ctx.ray, y);
    if (!point) return fail("needs-ceiling");

    const [w, , d] = itemSize(product, scale, ctx.size);
    const [hx, hz] = rotatedHalfExtents(w, d, yaw);
    const { width, depth } = ctx.room.dimensions;

    let x = ctx.gridSnap ? snapToGrid(point[0], grid) : point[0];
    let z = ctx.gridSnap ? snapToGrid(point[2], grid) : point[2];
    x = Math.max(-width / 2 + hx, Math.min(width / 2 - hx, x));
    z = Math.max(-depth / 2 + hz, Math.min(depth / 2 - hz, z));

    const candidate: PlacedItem = { ...base, surface: "ceiling", position: [x, y, z] };
    const pushed = pushApart(candidate, product, ctx.items, [0, 2], {
      0: [-width / 2 + hx, width / 2 - hx],
      2: [-depth / 2 + hz, depth / 2 - hz],
    });
    return {
      item: pushed.item,
      valid: pushed.resolved,
      issue: pushed.resolved ? null : "collides",
      guides,
      stacked: false,
    };
  }

  /* -------------------- FLOOR + TABLETOP -------------------- */
  const wantsAnyHorizontal = product.mount === "tabletop";

  let supportId: string | null = null;
  let surfaceY = 0;
  let bounds: { min: [number, number]; max: [number, number] } | null = null;
  let point: Vec3 | null = null;

  // Stacking: dropping onto another object's top face.
  if (wantsAnyHorizontal && ctx.hit?.itemId) {
    const host = ctx.items.find((i) => i.id === ctx.hit!.itemId);
    const hostProduct = host ? productById(host.productId) : undefined;
    const top = host && hostProduct ? stackSurface(host, hostProduct) : null;
    if (host && top && ctx.hit.normal[1] > 0.5) {
      supportId = host.id;
      surfaceY = top.y;
      bounds = { min: top.min, max: top.max };
      point = ctx.hit.point;
    }
  }

  if (!point) {
    if (ctx.hit && ctx.hit.normal[1] > 0.5 && !ctx.hit.itemId) {
      point = ctx.hit.point;
      surfaceY = ctx.hit.point[1];
    } else if (ctx.ray) {
      point = rayPlaneY(ctx.ray, 0);
      surfaceY = 0;
    }
  }
  if (!point) return fail(product.mount === "floor" ? "needs-floor" : "no-surface");

  const { width, depth } = ctx.room.dimensions;
  if (!bounds) {
    bounds = { min: [-width / 2, -depth / 2], max: [width / 2, depth / 2] };
  }

  const [iw, , id] = itemSize(product, scale, ctx.size);
  const [hx, hz] = rotatedHalfExtents(iw, id, yaw);

  let x = ctx.gridSnap ? snapToGrid(point[0], grid) : point[0];
  let z = ctx.gridSnap ? snapToGrid(point[2], grid) : point[2];

  // Align to neighbours sharing this support (or the floor).
  const nx: { centre: number; half: number }[] = [];
  const nz: { centre: number; half: number }[] = [];
  for (const other of ctx.items) {
    if (other.id === base.id) continue;
    if (other.supportId !== supportId) continue;
    const op = productById(other.productId);
    if (!op || op.mount === "wall" || op.mount === "edge") continue;
    const [ow, , od] = itemSize(op, other.scale, other.size);
    const [ohx, ohz] = rotatedHalfExtents(ow, od, other.yaw);
    nx.push({ centre: other.position[0], half: ohx });
    nz.push({ centre: other.position[2], half: ohz });
  }

  const ax = alignAxis(x, hx, nx);
  const az = alignAxis(z, hz, nz);
  if (ax) x = ax.value;
  if (az) z = az.value;

  const fitsX = hx * 2 <= bounds.max[0] - bounds.min[0];
  const fitsZ = hz * 2 <= bounds.max[1] - bounds.min[1];
  x = fitsX
    ? Math.max(bounds.min[0] + hx, Math.min(bounds.max[0] - hx, x))
    : (bounds.min[0] + bounds.max[0]) / 2;
  z = fitsZ
    ? Math.max(bounds.min[1] + hz, Math.min(bounds.max[1] - hz, z))
    : (bounds.min[1] + bounds.max[1]) / 2;

  const hRoom = ctx.room.dimensions.height;
  if (ax) {
    guides.push({
      axis: "x",
      value: ax.guide,
      from: [ax.guide, surfaceY + 0.002, bounds.min[1]],
      to: [ax.guide, surfaceY + 0.002, bounds.max[1]],
    });
  }
  if (az) {
    guides.push({
      axis: "z",
      value: az.guide,
      from: [bounds.min[0], surfaceY + 0.002, az.guide],
      to: [bounds.max[0], surfaceY + 0.002, az.guide],
    });
  }

  const candidate: PlacedItem = {
    ...base,
    surface: supportId ? null : "floor",
    supportId,
    position: [x, surfaceY, z],
  };

  if (!fitsX || !fitsZ) {
    return {
      item: candidate,
      valid: false,
      issue: "no-room-on-surface",
      guides,
      stacked: supportId !== null,
    };
  }

  // Objects slide across their surface to get out of each other's way, but a
  // vase never resolves a conflict by hovering — Y is not an escape axis, and
  // neither axis may leave the surface they are standing on.
  const pushed = pushApart(candidate, product, ctx.items, [0, 2], {
    0: [bounds.min[0] + hx, bounds.max[0] - hx],
    2: [bounds.min[1] + hz, bounds.max[1] - hz],
  });
  const [, itemH] = itemSize(product, scale, ctx.size);
  const tooTall = surfaceY + itemH > hRoom + 0.05;

  return {
    item: pushed.item,
    valid: pushed.resolved && !tooTall,
    issue: tooTall ? "outside-room" : pushed.resolved ? null : "collides",
    guides,
    stacked: supportId !== null,
  };
}

/* ------------------------------------------------------------------ */
/* Gravity                                                             */
/* ------------------------------------------------------------------ */

/**
 * Re-settle items after the thing beneath them moved or was deleted.
 *
 * Anything whose support disappeared falls to the next surface below it — the
 * floor, or the top of whatever it now lands on. Without this, deleting a
 * shelf would leave its figures hanging in mid-air, which reads as a bug even
 * though nothing technically broke.
 */
export function settleItems(items: PlacedItem[]): PlacedItem[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const result = items.map((i) => ({ ...i }));

  // Lowest first: a support must be settled before anything resting on it.
  const order = [...result].sort((a, b) => a.position[1] - b.position[1]);

  for (const item of order) {
    const product = productById(item.productId);
    if (!product) continue;
    if (product.mount === "wall" || product.mount === "ceiling" || product.mount === "edge") {
      continue;
    }

    const supportStillThere = item.supportId ? byId.has(item.supportId) : true;
    if (supportStillThere && item.supportId) {
      const host = result.find((r) => r.id === item.supportId);
      const hp = host ? productById(host.productId) : undefined;
      const top = host && hp ? stackSurface(host, hp) : null;
      if (top) {
        item.position = [item.position[0], top.y, item.position[2]];
        continue;
      }
    }

    // Find the highest surface this item overlaps that it can rest on.
    let restY = 0;
    let newSupport: string | null = null;

    for (const other of result) {
      if (other.id === item.id) continue;
      const op = productById(other.productId);
      if (!op) continue;
      const top = stackSurface(other, op);
      // Surfaces below the item catch it as it falls. A surface slightly ABOVE
      // its base counts too, within the thickness of a floor covering: a plant
      // dropped on the floor inside a rug's footprint is standing on the rug,
      // not clipping through it. The tolerance stays under the shortest real
      // furniture so nothing gets sucked up onto a table it was never near.
      if (!top || top.y > item.position[1] + CLIMB_TOLERANCE) continue;

      const [w, , d] = itemSize(product, item.scale, item.size);
      const [hx, hz] = rotatedHalfExtents(w, d, item.yaw);
      const overlapsX =
        item.position[0] + hx > top.min[0] && item.position[0] - hx < top.max[0];
      const overlapsZ =
        item.position[2] + hz > top.min[1] && item.position[2] - hz < top.max[1];

      if (overlapsX && overlapsZ && top.y >= restY) {
        restY = top.y;
        newSupport = other.id;
      }
    }

    item.position = [item.position[0], restY, item.position[2]];
    item.supportId = newSupport;
  }

  return result;
}

export const ISSUE_MESSAGES: Record<PlacementIssue, string> = {
  "no-surface": "Aim at a surface in the room",
  "needs-wall": "This hangs on a wall",
  "needs-floor": "This goes on the floor",
  "needs-ceiling": "This hangs from the ceiling",
  collides: "Something's already there",
  "outside-room": "That won't fit in this room",
  "no-room-on-surface": "Not enough space on this surface",
};
