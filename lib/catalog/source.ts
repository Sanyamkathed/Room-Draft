/**
 * Catalog sources.
 *
 * `LocalCatalogSource` serves the curated seed list. A future
 * `AmazonPaapiSource` implements the same `CatalogSource` interface — the shop
 * UI, the studio's drag layer and the design assistant all talk to the
 * interface, so swapping the data origin touches exactly one line
 * (`defaultCatalogSource`) and nothing else.
 */

import { FURNITURE, FURNITURE_BY_ID } from "./furniture";
import { PRODUCTS, PRODUCTS_BY_ID } from "./seed";
import type { CatalogFilter, CatalogSource, Product } from "./types";

/**
 * Every placeable thing, decor and furniture alike.
 *
 * The 3D layer resolves ids through this, so furniture participates in
 * placement, collision and stacking exactly like a product. The shop, the
 * decor library and the design assistant deliberately read PRODUCTS instead —
 * nobody wants their own wardrobe recommended back to them.
 */
export const ALL_ITEMS: Product[] = [...PRODUCTS, ...FURNITURE];

/**
 * Outbound marketplace link.
 *
 * We deliberately link to a *search* rather than a product id: the catalog is
 * curated seed data, so inventing an ASIN would produce links that look real
 * and resolve to nothing. A search for the item's query always lands the user
 * somewhere useful, and swaps cleanly for a real permalink once a live source
 * is wired up.
 */
export function marketplaceUrl(product: Product): string {
  const tag = process.env.NEXT_PUBLIC_AMAZON_ASSOCIATE_TAG;
  const params = new URLSearchParams({ k: product.query });
  if (tag) params.set("tag", tag);
  return `https://www.amazon.in/s?${params.toString()}`;
}

function matches(p: Product, f: CatalogFilter): boolean {
  if (f.category && p.category !== f.category) return false;
  if (f.mount && p.mount !== f.mount) return false;
  if (f.aesthetic && !p.aesthetics.includes(f.aesthetic)) return false;
  if (f.maxPrice !== undefined && p.price > f.maxPrice) return false;
  if (f.search) {
    const q = f.search.trim().toLowerCase();
    if (!q) return true;
    const hay = [p.name, p.brand, p.subcategory, ...p.tags, ...p.aesthetics]
      .join(" ")
      .toLowerCase();
    // Every whitespace-separated term must appear, so "neon pink" narrows
    // rather than widening the way a naive OR search would.
    return q.split(/\s+/).every((term) => hay.includes(term));
  }
  return true;
}

export class LocalCatalogSource implements CatalogSource {
  readonly id = "local-curated";

  async list(filter: CatalogFilter = {}): Promise<Product[]> {
    return PRODUCTS.filter((p) => matches(p, filter));
  }

  async get(id: string): Promise<Product | undefined> {
    return PRODUCTS_BY_ID.get(id);
  }

  async related(id: string, limit = 6): Promise<Product[]> {
    const base = PRODUCTS_BY_ID.get(id);
    if (!base) return [];

    const scored = PRODUCTS.filter((p) => p.id !== id).map((p) => {
      const sharedAesthetics = p.aesthetics.filter((a) =>
        base.aesthetics.includes(a),
      ).length;
      const sharedTags = p.tags.filter((t) => base.tags.includes(t)).length;
      const sameCategory = p.category === base.category ? 1 : 0;
      // Price proximity on a log scale — a ₹500 and ₹700 item feel like peers,
      // ₹500 and ₹5000 do not, and the gap between ₹4000 and ₹4500 is noise.
      const priceAffinity =
        1 - Math.min(1, Math.abs(Math.log(p.price / base.price)) / Math.log(6));

      return {
        p,
        score:
          sharedAesthetics * 3 + sharedTags * 2 + sameCategory * 1.5 + priceAffinity * 2,
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.p);
  }
}

/** Swap this for a live source to change where every product in the app comes from. */
export const defaultCatalogSource: CatalogSource = new LocalCatalogSource();

/** Synchronous access for the 3D layer, which cannot await inside a frame. */
export function productById(id: string): Product | undefined {
  return PRODUCTS_BY_ID.get(id) ?? FURNITURE_BY_ID.get(id);
}

export function formatINR(value: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

/** "60 × 90 × 0.2 cm" — the string that makes auto-scaling legible to the user. */
export function formatDims(p: Product): string {
  const { w, h, d } = p.dims;
  const n = (v: number) => (Number.isInteger(v) ? v : v.toFixed(1));
  return `${n(w)} × ${n(h)} × ${n(d)} cm`;
}
