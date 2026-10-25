import * as React from "react";
import { del, get, keys, set } from "idb-keyval";
import type { CategoryId, CustomSpec, MountType, Product } from "./types";

/**
 * The user's own decor items.
 *
 * Anything a user imports — a pin, a listing, a photo of a thing they already
 * own — becomes an ordinary `Product` with a `custom` spec, so placement,
 * collision, stacking, carrying and undo all work on it with no special cases.
 *
 * Local-first like rooms: the library lives in this browser's IndexedDB and is
 * never uploaded. Every item placed in a room is ALSO embedded in that room's
 * saved project, so a room copied to another device (or opened after the
 * library was cleared) still has the items it was designed with.
 *
 * Imported photos belong to whoever took them. They are for the user's own
 * room; nothing here feeds the shared catalog.
 */

const PREFIX = "aura:custom:";
const registry = new Map<string, Product>();
const listeners = new Set<() => void>();
let snapshot: Product[] = [];
let loaded: Promise<void> | null = null;

function emit() {
  snapshot = [...registry.values()].sort(
    (a, b) => (b.custom?.updatedAt ?? 0) - (a.custom?.updatedAt ?? 0),
  );
  listeners.forEach((l) => l());
}

export function newCustomId(): string {
  return `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function isCustomId(id: string): boolean {
  return id.startsWith("custom_");
}

/** Synchronous lookup for the 3D layer — see productById(). */
export function customById(id: string): Product | undefined {
  return registry.get(id);
}

/**
 * Make products available to the 3D layer without touching the saved library.
 * Used for items embedded in a project: the room renders them even if this
 * browser's library no longer has them. A newer library copy wins.
 */
export function registerCustom(products: Product[] | undefined): void {
  if (!products?.length) return;
  let changed = false;
  for (const p of products) {
    if (!p.custom || !isCustomId(p.id)) continue;
    const existing = registry.get(p.id);
    if (existing && (existing.custom?.updatedAt ?? 0) >= p.custom.updatedAt) continue;
    registry.set(p.id, p);
    changed = true;
  }
  if (changed) emit();
}

/** Load the saved library once per page; later calls reuse the same promise. */
export function loadCustomLibrary(): Promise<void> {
  if (!loaded) {
    loaded = (async () => {
      try {
        const all = ((await keys()) as string[]).filter(
          (k) => typeof k === "string" && k.startsWith(PREFIX),
        );
        const items = await Promise.all(all.map((k) => get<Product>(k)));
        registerCustom(items.filter((p): p is Product => Boolean(p)));
      } catch {
        // Private windows and blocked storage: the library is simply empty.
      }
    })();
  }
  return loaded;
}

export async function saveCustomProduct(product: Product): Promise<void> {
  registry.set(product.id, product);
  emit();
  await set(PREFIX + product.id, product);
}

export async function deleteCustomProduct(id: string): Promise<void> {
  registry.delete(id);
  emit();
  await del(PREFIX + id);
}

/** The library, live. Rooms keep rendering items deleted from it. */
export function useCustomProducts(): Product[] {
  React.useEffect(() => {
    void loadCustomLibrary();
  }, []);
  return React.useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => EMPTY,
  );
}
const EMPTY: Product[] = [];

/** Category for a user item, so it lands in the right library tab too. */
export function categoryFor(mount: MountType, glows: boolean): CategoryId {
  if (glows) return "lighting";
  if (mount === "wall") return "wall";
  if (mount === "tabletop") return "desk";
  return "decor";
}

/** Build a complete Product from what the user filled in. */
export function buildCustomProduct(input: {
  id?: string;
  name: string;
  mount: MountType;
  dims: { w: number; h: number; d: number };
  colour: string;
  glow?: string | null;
  spec: Omit<CustomSpec, "createdAt" | "updatedAt"> & { createdAt?: number };
}): Product {
  const now = Date.now();
  const name = input.name.trim().slice(0, 80) || "My item";
  return {
    id: input.id ?? newCustomId(),
    name,
    brand: input.spec.sourceSite ?? "Your item",
    // Not for sale: user items are for seeing decor in the room, so they
    // carry no price and never link to a shop.
    price: 0,
    category: categoryFor(input.mount, Boolean(input.glow)),
    subcategory: "Your items",
    dims: input.dims,
    mount: input.mount,
    model: "custom",
    palette: [input.colour, input.colour],
    emissive: input.glow
      ? { color: input.glow, intensity: 1.6, lightIntensity: 2.5, distance: 2.5 }
      : undefined,
    aesthetics: [],
    tags: ["custom", "mine", ...name.toLowerCase().split(/\s+/).slice(0, 6)],
    rating: 0,
    reviews: 0,
    // Rugs and anything the user said can hold things; plain boxes too.
    stackable:
      input.spec.holds ?? (input.spec.style === "rug" || (!input.spec.image && input.spec.shape === "box")),
    query: name,
    custom: { ...input.spec, createdAt: input.spec.createdAt ?? now, updatedAt: now },
  };
}

/** Only ever link out to http(s) — never javascript:, data: or anything else. */
export function safeHttpUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}
