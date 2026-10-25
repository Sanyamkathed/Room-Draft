/**
 * Turning recommendations into real placements.
 *
 * Every suggestion is resolved through the same pipeline the drag layer uses,
 * so "Apply" can never produce a poster hanging through a wall — the room has
 * already accepted each placement before the user sees it. Scoring and intent
 * parsing live in ./scoring, which stays free of the 3D layer.
 */

import { productById } from "@/lib/catalog/source";
import type { AestheticId, Product } from "@/lib/catalog/types";
import { resolvePlacement } from "@/lib/placement/resolve";
import { isFloorCovering, stackSurface } from "@/lib/placement/transform";
import type { PlacedItem } from "@/lib/placement/types";
import type { RoomGeometry, SurfaceId, Vec3 } from "@/lib/room/types";
import { parseIntent, recommend } from "./scoring";

export * from "./scoring";

/* ------------------------------------------------------------------ */
/* Layout generation                                                   */
/* ------------------------------------------------------------------ */

export interface Suggestion {
  id: string;
  title: string;
  rationale: string;
  aesthetics: AestheticId[];
  placements: { product: Product; item: PlacedItem }[];
  totalPrice: number;
}

interface Candidate {
  point: Vec3;
  normal: Vec3;
  surfaceId?: SurfaceId;
  /** Set when the candidate is the top of another object, so stacking fires. */
  itemId?: string;
}

/**
 * How willingly each kind of surface accepts a small object put down on it.
 *
 * Ranking by area picks the biggest flat thing in the room, which is a bed —
 * so a desk lamp ends up on the duvet. What actually decides this is what the
 * furniture is FOR: a desk and a nightstand exist to have things on them, a
 * bed does not.
 */
const SURFACE_PRIORITY: Record<string, number> = {
  desk: 10,
  nightstand: 9,
  sideTable: 8,
  dresser: 8,
  tvUnit: 7,
  shelf: 6,
  bookshelfTall: 6,
  organizer: 4,
  books: 3,
  rug: 2,
  bed: 1,
  sofa: 0,
};

/**
 * Surfaces you would actually put a small object down on, best first, with the
 * floor only as a fallback. Without this a desk lamp lands on the carpet next
 * to the desk — technically a valid placement and obviously the wrong one.
 */
function tabletopHosts(existing: PlacedItem[]): Candidate[] {
  const hosts: { candidate: Candidate; priority: number; area: number }[] = [];

  for (const item of existing) {
    const host = productById(item.productId);
    if (!host) continue;
    const top = stackSurface(item, host);
    if (!top) continue;
    // Waist-to-chest height is where people put things down; the top of a 2m
    // wardrobe is a surface but not a sensible default.
    if (top.y < 0.25 || top.y > 1.3) continue;

    hosts.push({
      candidate: {
        point: [(top.min[0] + top.max[0]) / 2, top.y, (top.min[1] + top.max[1]) / 2],
        normal: [0, 1, 0],
        itemId: item.id,
      },
      priority: SURFACE_PRIORITY[host.model] ?? 5,
      area: (top.max[0] - top.min[0]) * (top.max[1] - top.min[1]),
    });
  }

  return hosts
    .sort((a, b) => b.priority - a.priority || b.area - a.area)
    .map((h) => h.candidate);
}

/** Candidate drop points for a mount type, ordered by how good they look. */
function candidatePoints(
  product: Product,
  room: RoomGeometry,
  index: number,
  existing: PlacedItem[] = [],
): Candidate[] {
  const { width: w, height: h, depth: d } = room.dimensions;

  switch (product.mount) {
    case "wall": {
      // Spread across the back wall at eye level, then the side walls.
      const spread = [-0.28, 0.28, 0, -0.56, 0.56];
      const t = spread[index % spread.length];
      const eye = h * 0.58;
      return [
        {
          point: [w * t, eye, -d / 2 + 0.01],
          normal: [0, 0, 1],
          surfaceId: "back" as SurfaceId,
        },
        {
          point: [-w / 2 + 0.01, eye, d * t],
          normal: [1, 0, 0],
          surfaceId: "left" as SurfaceId,
        },
        {
          point: [w / 2 - 0.01, eye, d * t],
          normal: [-1, 0, 0],
          surfaceId: "right" as SurfaceId,
        },
      ];
    }

    case "ceiling":
      return [{ point: [w * 0.2, h, d * 0.1], normal: [0, -1, 0], surfaceId: "ceiling" }];

    case "edge":
      // Wall/ceiling junction along the back wall reads best for strip light.
      return [{ point: [0, h - 0.02, -d / 2 + 0.02], normal: [0, -1, 0] }];

    case "floor": {
      // Hug the corners and wall lines — floor items in open space look wrong.
      const spots: Vec3[] = [
        [-w * 0.36, 0, -d * 0.34],
        [w * 0.36, 0, -d * 0.34],
        [-w * 0.38, 0, d * 0.1],
        [w * 0.38, 0, d * 0.1],
      ];
      // A rug belongs in the open middle of the room, under things.
      if (isFloorCovering(product)) spots.unshift([0, 0, 0], [0, 0, d * 0.15]);
      // A full room still has gaps; try a grid over the floor before giving up.
      const grid: Vec3[] = [];
      for (let gz = -0.4; gz <= 0.41; gz += 0.2) {
        for (let gx = -0.4; gx <= 0.41; gx += 0.2) grid.push([w * gx, 0, d * gz]);
      }
      return spots
        .slice(index % spots.length)
        .concat(spots, grid)
        .map((p) => ({ point: p, normal: [0, 1, 0] as Vec3, surfaceId: "floor" as SurfaceId }));
    }

    case "tabletop":
    default: {
      const spots: Vec3[] = [
        [-w * 0.2, 0, -d * 0.3],
        [w * 0.2, 0, -d * 0.3],
        [0, 0, -d * 0.36],
        [-w * 0.32, 0, -d * 0.16],
        [w * 0.32, 0, -d * 0.16],
      ];
      return [
        ...tabletopHosts(existing),
        ...spots
          .slice(index % spots.length)
          .concat(spots)
          .map((p) => ({
            point: p,
            normal: [0, 1, 0] as Vec3,
            surfaceId: "floor" as SurfaceId,
          })),
      ];
    }
  }
}

/**
 * Turn a shortlist of products into placements the room actually accepts.
 *
 * Each candidate goes through `resolvePlacement` against a running list that
 * includes everything placed so far in this suggestion — so the assistant's
 * own items snap to and avoid each other exactly like hand-placed ones.
 */
export function planPlacements(
  products: Product[],
  room: RoomGeometry,
  existing: PlacedItem[],
): { product: Product; item: PlacedItem }[] {
  const placed: PlacedItem[] = [...existing];
  const out: { product: Product; item: PlacedItem }[] = [];

  products.forEach((product, i) => {
    for (const candidate of candidatePoints(product, room, i, placed)) {
      const result = resolvePlacement(product, {
        room,
        items: placed,
        hit: {
          point: candidate.point,
          normal: candidate.normal,
          surfaceId: candidate.surfaceId,
          itemId: candidate.itemId,
        },
        ray: null,
        gridSnap: false,
      });

      if (result?.valid) {
        placed.push(result.item);
        out.push({ product, item: result.item });
        return;
      }
    }
    // Nothing fit anywhere — silently skipping beats offering a broken item.
  });

  return out;
}

const TITLES: Partial<Record<AestheticId, string>> = {
  "dark-academia": "Brass, books and low light",
  minimalist: "Strip it back",
  cyberpunk: "Neon on concrete",
  anime: "Figures and a poster wall",
  gaming: "Battlestation energy",
  cozy: "Turn the warmth up",
  scandinavian: "Pale, calm and green",
  y2k: "Chrome and bubblegum",
  indie: "Layered and lived-in",
  retro: "Seventies glow",
  streetwear: "Concrete and one hit of colour",
  neon: "Let the signs do the lighting",
  moody: "One pool of light",
  "clean-desk": "Everything docked",
  creator: "Camera-ready",
};

export function buildSuggestion(
  query: string,
  room: RoomGeometry,
  existing: PlacedItem[],
  opts: { saved?: string[]; maxPrice?: number; fallbackAesthetic?: AestheticId | null } = {},
): Suggestion | null {
  const intent = parseIntent(query);

  const aesthetics =
    intent.aesthetics.length > 0
      ? intent.aesthetics
      : opts.fallbackAesthetic
        ? [opts.fallbackAesthetic]
        : [];

  if (aesthetics.length === 0 && intent.emphases.length === 0) return null;

  const shortlist = recommend(
    {
      aesthetics,
      emphases: intent.emphases,
      existing,
      saved: opts.saved,
      maxPrice: opts.maxPrice,
    },
    6,
  );
  if (shortlist.length === 0) return null;

  const placements = planPlacements(shortlist, room, existing);
  if (placements.length === 0) return null;

  const primary = aesthetics[0];
  const heard = intent.matched.slice(0, 3);

  return {
    id: `sug_${Math.random().toString(36).slice(2, 9)}`,
    title: (primary && TITLES[primary]) ?? "A few things that would work",
    rationale: heard.length
      ? `Picked up on ${heard.join(", ")} — here's ${placements.length} ${
          placements.length === 1 ? "piece" : "pieces"
        } that fit your room's actual dimensions.`
      : `${placements.length} ${placements.length === 1 ? "piece" : "pieces"} sized and placed for your room.`,
    aesthetics,
    placements,
    totalPrice: placements.reduce((s, p) => s + p.product.price, 0),
  };
}

/** Prompts offered when the user hasn't typed anything yet. */
export const STARTER_PROMPTS = [
  "Make my room more cozy",
  "Give my desk a cyberpunk aesthetic",
  "Design it like an anime creator setup",
  "My walls feel empty",
  "Add warm lighting and plants",
  "Clean, minimal study space",
];
