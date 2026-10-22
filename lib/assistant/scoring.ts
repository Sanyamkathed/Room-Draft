/**
 * Intent parsing and catalog scoring.
 *
 * Deliberately free of any 3D dependency: Discover and Shop want
 * recommendations without paying for three.js, and pulling the placement
 * pipeline in through a shared module put ~100kB of renderer into pages that
 * never draw a polygon. Turning a shortlist into actual placements lives in
 * ./engine, which does need the 3D layer.
 */

import { PRODUCTS } from "@/lib/catalog/seed";
import { productById } from "@/lib/catalog/source";
import { AESTHETICS, type AestheticId, type Product } from "@/lib/catalog/types";
import type { PlacedItem } from "@/lib/placement/types";

export interface Intent {
  aesthetics: AestheticId[];
  /** 0..1 confidence that we understood the request at all. */
  confidence: number;
  /** Extra pulls parsed out of the phrasing, e.g. "more light", "plants". */
  emphases: Emphasis[];
  /** Words we matched, for showing the user what we heard. */
  matched: string[];
}

type Emphasis =
  | "light"
  | "plants"
  | "wall"
  | "desk"
  | "collectibles"
  | "warmth"
  | "colour"
  | "declutter";

const EMPHASIS_WORDS: Record<Emphasis, string[]> = {
  light: ["light", "bright", "glow", "lamp", "neon", "led", "lighting", "lit", "dark"],
  plants: ["plant", "plants", "green", "greenery", "nature", "botanical"],
  wall: ["wall", "walls", "poster", "posters", "art", "empty wall", "blank"],
  desk: ["desk", "workspace", "study", "setup", "table", "work"],
  collectibles: ["figure", "figures", "collectible", "shelf", "display", "funko"],
  warmth: ["cozy", "cosy", "warm", "comfort", "soft", "inviting", "snug"],
  colour: ["colour", "color", "colourful", "colorful", "vibrant", "pop"],
  declutter: ["clean", "minimal", "declutter", "tidy", "simple", "less", "empty"],
};

/* ------------------------------------------------------------------ */
/* Intent                                                              */
/* ------------------------------------------------------------------ */

export function parseIntent(text: string): Intent {
  const q = text.toLowerCase();
  const matched: string[] = [];
  const scores = new Map<AestheticId, number>();

  for (const a of AESTHETICS) {
    let score = 0;
    // The theme's own name is a stronger signal than any of its keywords.
    if (q.includes(a.label.toLowerCase())) {
      score += 3;
      matched.push(a.label);
    }
    for (const kw of a.keywords) {
      if (q.includes(kw)) {
        score += 1;
        matched.push(kw);
      }
    }
    if (score > 0) scores.set(a.id, score);
  }

  const emphases: Emphasis[] = [];
  for (const [key, words] of Object.entries(EMPHASIS_WORDS) as [Emphasis, string[]][]) {
    if (words.some((w) => q.includes(w))) emphases.push(key);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((sum, [, v]) => sum + v, 0);

  return {
    aesthetics: ranked.slice(0, 3).map(([id]) => id),
    confidence: Math.min(1, total / 4),
    emphases,
    matched: [...new Set(matched)],
  };
}

/* ------------------------------------------------------------------ */
/* Scoring                                                             */
/* ------------------------------------------------------------------ */

export interface ScoreContext {
  aesthetics: AestheticId[];
  emphases?: Emphasis[];
  /** Already in the room — pulls the suggestion toward coherence. */
  existing?: PlacedItem[];
  /** Liked products from the user's profile. */
  saved?: string[];
  maxPrice?: number;
}

export function scoreProduct(product: Product, ctx: ScoreContext): number {
  let score = 0;

  for (let i = 0; i < ctx.aesthetics.length; i++) {
    if (product.aesthetics.includes(ctx.aesthetics[i])) {
      // First-choice aesthetic counts for more than the third.
      score += 6 - i * 1.6;
    }
  }

  for (const e of ctx.emphases ?? []) {
    switch (e) {
      case "light":
        if (product.emissive) score += 3.4;
        if (product.category === "lighting") score += 2.2;
        break;
      case "plants":
        if (product.subcategory === "Plants") score += 4.5;
        break;
      case "wall":
        if (product.mount === "wall") score += 3;
        break;
      case "desk":
        if (product.category === "desk" || product.mount === "tabletop") score += 2.4;
        break;
      case "collectibles":
        if (product.category === "collectibles") score += 3.6;
        break;
      case "warmth":
        if (product.aesthetics.includes("cozy")) score += 2.6;
        if (product.emissive && /ff[9a-f]|ffb|ffc|ffd/i.test(product.emissive.color)) {
          score += 1.4;
        }
        break;
      case "colour":
        if (product.emissive) score += 1.6;
        if (product.palette.length > 2) score += 0.8;
        break;
      case "declutter":
        if (product.aesthetics.includes("minimalist")) score += 2.8;
        if (product.category === "collectibles") score -= 2.2;
        break;
    }
  }

  if (ctx.saved?.includes(product.id)) score += 2.5;

  // Coherence with what's already there, and a penalty for duplicates.
  const existingProducts = (ctx.existing ?? [])
    .map((i) => productById(i.productId))
    .filter((p): p is Product => Boolean(p));

  for (const ep of existingProducts) {
    if (ep.id === product.id) score -= 8;
    const shared = ep.aesthetics.filter((a) => product.aesthetics.includes(a)).length;
    score += shared * 0.35;
  }

  // Variety: don't return six posters.
  const sameCategory = existingProducts.filter((p) => p.category === product.category).length;
  score -= sameCategory * 0.5;

  if (ctx.maxPrice && product.price > ctx.maxPrice) score -= 6;

  return score;
}

export function recommend(ctx: ScoreContext, limit = 8): Product[] {
  return PRODUCTS.map((p) => ({ p, s: scoreProduct(p, ctx) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.p);
}

