/**
 * Furniture already in the room.
 *
 * These are not products — nobody is buying their own bed again. They exist so
 * the 3D room contains the volumes that are actually in it, which is what
 * turns "decor floating in an empty box" into "decor in my room": a lamp can
 * stand ON the desk, a poster can't be hung where the wardrobe is, and the
 * floor plan reads like the real place.
 *
 * They reuse the `Product` shape deliberately. Placement, collision, stacking,
 * gravity, the inspector and undo all already work against `Product` — giving
 * furniture its own parallel type would mean reimplementing every one of them.
 *
 * Heights are the SURFACE height, not the silhouette: a bed is 50cm because
 * that is where the mattress is and where a book would rest. Anything taller
 * (a headboard, a chair back) is drawn above the box rather than counted in
 * it, so stacking lands where a human would put things down.
 */

import type { Product } from "./types";

type FurnitureSeed = Omit<
  Product,
  "rating" | "reviews" | "price" | "brand" | "query" | "isFurniture"
>;

const SEEDS: FurnitureSeed[] = [
  /* ---------------- Beds ---------------- */
  {
    id: "fn-bed-single",
    name: "Single bed",
    category: "furniture",
    subcategory: "Beds",
    dims: { w: 92, h: 50, d: 190 },
    mount: "floor",
    model: "bed",
    palette: ["#d8d2c6", "#8a6a44"],
    stackable: true,
    aesthetics: [],
    tags: ["bed", "single", "sleep"],
  },
  {
    id: "fn-bed-double",
    name: "Double bed",
    category: "furniture",
    subcategory: "Beds",
    dims: { w: 140, h: 50, d: 195 },
    mount: "floor",
    model: "bed",
    palette: ["#d8d2c6", "#8a6a44"],
    stackable: true,
    aesthetics: [],
    tags: ["bed", "double", "sleep"],
  },
  {
    id: "fn-bed-queen",
    name: "Queen bed",
    category: "furniture",
    subcategory: "Beds",
    dims: { w: 160, h: 50, d: 200 },
    mount: "floor",
    model: "bed",
    palette: ["#ddd7cc", "#6b5540"],
    stackable: true,
    aesthetics: [],
    tags: ["bed", "queen", "sleep"],
  },

  /* ---------------- Desks & seating ---------------- */
  {
    id: "fn-desk",
    name: "Study desk",
    category: "furniture",
    subcategory: "Desks",
    dims: { w: 120, h: 75, d: 60 },
    mount: "floor",
    model: "desk",
    palette: ["#c9a06a", "#2a2a2e"],
    stackable: true,
    aesthetics: [],
    tags: ["desk", "study", "table", "work"],
  },
  {
    id: "fn-desk-l",
    name: "L-shaped desk",
    category: "furniture",
    subcategory: "Desks",
    dims: { w: 160, h: 75, d: 120 },
    mount: "floor",
    model: "desk",
    palette: ["#2e2e34", "#17171a"],
    stackable: true,
    aesthetics: [],
    tags: ["desk", "gaming", "corner", "large"],
  },
  {
    id: "fn-chair",
    name: "Desk chair",
    category: "furniture",
    subcategory: "Seating",
    dims: { w: 55, h: 48, d: 55 },
    mount: "floor",
    model: "chair",
    palette: ["#2a2a2e", "#4a4a52"],
    aesthetics: [],
    tags: ["chair", "seat", "desk"],
  },
  {
    id: "fn-sofa",
    name: "Two-seat sofa",
    category: "furniture",
    subcategory: "Seating",
    dims: { w: 150, h: 45, d: 85 },
    mount: "floor",
    model: "sofa",
    palette: ["#4a4a52", "#2e2e34"],
    aesthetics: [],
    tags: ["sofa", "couch", "seating"],
  },

  /* ---------------- Storage ---------------- */
  {
    id: "fn-wardrobe",
    name: "Wardrobe",
    category: "furniture",
    subcategory: "Storage",
    dims: { w: 120, h: 200, d: 58 },
    mount: "floor",
    model: "wardrobe",
    palette: ["#b9895a", "#7a5a38"],
    stackable: true,
    aesthetics: [],
    tags: ["wardrobe", "almirah", "closet", "storage"],
  },
  {
    id: "fn-bookshelf",
    name: "Bookshelf",
    category: "furniture",
    subcategory: "Storage",
    dims: { w: 80, h: 180, d: 30 },
    mount: "floor",
    model: "bookshelfTall",
    palette: ["#c9a06a", "#8a6a44"],
    stackable: true,
    aesthetics: [],
    tags: ["bookshelf", "shelving", "books", "storage"],
  },
  {
    id: "fn-nightstand",
    name: "Nightstand",
    category: "furniture",
    subcategory: "Storage",
    dims: { w: 45, h: 55, d: 40 },
    mount: "floor",
    model: "nightstand",
    palette: ["#c9a06a", "#8a6a44"],
    stackable: true,
    aesthetics: [],
    tags: ["nightstand", "bedside", "table"],
  },
  {
    id: "fn-dresser",
    name: "Chest of drawers",
    category: "furniture",
    subcategory: "Storage",
    dims: { w: 100, h: 80, d: 45 },
    mount: "floor",
    model: "dresser",
    palette: ["#d8d2c6", "#8a8a92"],
    stackable: true,
    aesthetics: [],
    tags: ["dresser", "drawers", "chest", "storage"],
  },
  {
    id: "fn-tv-unit",
    name: "TV unit",
    category: "furniture",
    subcategory: "Storage",
    dims: { w: 120, h: 45, d: 40 },
    mount: "floor",
    model: "tvUnit",
    palette: ["#2a2a2e", "#c9a06a"],
    stackable: true,
    aesthetics: [],
    tags: ["tv", "unit", "media", "console"],
  },

  /* ---------------- Openings ---------------- */
  {
    id: "fn-door",
    name: "Door",
    category: "furniture",
    subcategory: "Openings",
    dims: { w: 90, h: 205, d: 6 },
    mount: "wall",
    model: "doorway",
    palette: ["#6b4f33", "#3a2a1c"],
    aesthetics: [],
    tags: ["door", "opening", "entry"],
  },
  {
    id: "fn-window",
    name: "Window",
    category: "furniture",
    subcategory: "Openings",
    dims: { w: 120, h: 130, d: 6 },
    mount: "wall",
    model: "windowFrame",
    palette: ["#e8eef6", "#8a8a92"],
    aesthetics: [],
    tags: ["window", "opening", "light"],
  },
];

export const FURNITURE: Product[] = SEEDS.map((s) => ({
  ...s,
  brand: "Your room",
  price: 0,
  rating: 0,
  reviews: 0,
  query: s.name,
  isFurniture: true,
}));

export const FURNITURE_BY_ID = new Map(FURNITURE.map((f) => [f.id, f]));

/** Grouped for the furniture picker. */
export const FURNITURE_GROUPS: { label: string; ids: string[] }[] = [
  { label: "Beds", ids: ["fn-bed-single", "fn-bed-double", "fn-bed-queen"] },
  { label: "Desks & seating", ids: ["fn-desk", "fn-desk-l", "fn-chair", "fn-sofa"] },
  {
    label: "Storage",
    ids: ["fn-wardrobe", "fn-bookshelf", "fn-nightstand", "fn-dresser", "fn-tv-unit"],
  },
  { label: "Doors & windows", ids: ["fn-door", "fn-window"] },
];

export function isFurnitureId(id: string): boolean {
  return FURNITURE_BY_ID.has(id);
}
