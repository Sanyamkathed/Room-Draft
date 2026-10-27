import type { PlacedItem } from "@/lib/placement/types";
import { productById } from "@/lib/catalog/source";
import type { Vec3 } from "@/lib/room/types";
import { PROJECT_VERSION, type Project } from "@/lib/storage/types";
import { newProjectId } from "@/lib/storage/idb";

/**
 * A ready-made room for trying RoomDraft without a photo.
 *
 * A 4.2 × 3.8 m bedroom-study, 2.7 m high, built in full mode with no photos —
 * the walls render in flat colour — and furnished with real catalogue pieces,
 * so every interaction (drag, twist, stack, swap) has something to act on.
 *
 * Coordinates follow lib/room/types: metres, floor at y = 0, back wall at
 * z = -depth/2, right wall at x = +width/2. Floor and tabletop items sit on
 * their base; wall items sit on the wall plane at their centre height.
 */

const W = 4.2;
const D = 3.8;
const H = 2.7;

const BACK = -D / 2;
const LEFT = -W / 2;
const RIGHT = W / 2;

type Spec = {
  key: string;
  productId: string;
  position: Vec3;
  yaw?: number;
  surface?: PlacedItem["surface"];
  on?: string;
};

const SPECS: Spec[] = [
  { key: "rug", productId: "rug-area", position: [-0.15, 0, 0.45], yaw: Math.PI / 2, surface: "floor" },
  { key: "bed", productId: "fn-bed-double", position: [-1.0, 0, BACK + 0.98], surface: "floor" },
  { key: "nightstand", productId: "fn-nightstand", position: [0.0, 0, BACK + 0.22], surface: "floor" },
  { key: "bedside-lamp", productId: "table-lamp-ceramic", position: [0.0, 0.55, BACK + 0.22], on: "nightstand" },
  // Desk against the right wall, facing into the room; the chair faces the desk.
  { key: "desk", productId: "fn-desk", position: [RIGHT - 0.3, 0, 0.35], yaw: -Math.PI / 2, surface: "floor" },
  { key: "chair", productId: "chair-gaming", position: [RIGHT - 0.95, 0, 0.35], yaw: Math.PI / 2, surface: "floor" },
  { key: "desk-lamp", productId: "desk-lamp-arch", position: [RIGHT - 0.22, 0.75, -0.05], on: "desk" },
  { key: "succulents", productId: "plant-succulent-set", position: [RIGHT - 0.25, 0.75, 0.8], on: "desk" },
  { key: "floor-lamp", productId: "floor-lamp-tripod", position: [LEFT + 0.35, 0, 0.35], surface: "floor" },
  { key: "monstera", productId: "plant-monstera", position: [RIGHT - 0.35, 0, BACK + 0.35], surface: "floor" },
  { key: "window", productId: "fn-window", position: [1.0, 1.45, BACK], surface: "back" },
  { key: "poster", productId: "poster-line-art", position: [-1.0, 1.55, BACK], surface: "back" },
  { key: "neon", productId: "neon-bolt", position: [RIGHT, 1.6, 0.35], surface: "right" },
  { key: "shelf", productId: "shelf-oak-60", position: [LEFT, 1.45, 1.2], surface: "left" },
];

export const SAMPLE_ROOM_NAME = "Sample room";

export function buildSampleProject(): Project {
  const now = Date.now();
  const ids = new Map(SPECS.map((s) => [s.key, `it_sample_${s.key}_${now.toString(36)}`]));

  const items: PlacedItem[] = SPECS.filter((s) => productById(s.productId)).map((s) => ({
    id: ids.get(s.key)!,
    productId: s.productId,
    position: s.position,
    yaw: s.yaw ?? 0,
    spin: 0,
    scale: 1,
    surface: s.surface ?? null,
    supportId: s.on ? ids.get(s.on) ?? null : null,
    createdAt: now,
  }));

  return {
    id: newProjectId(),
    version: PROJECT_VERSION,
    name: SAMPLE_ROOM_NAME,
    createdAt: now,
    updatedAt: now,
    mode: "full",
    images: [],
    plan: { dimensions: { width: W, height: H, depth: D }, surfaces: {} },
    palette: {
      wall: "#d6cec6",
      floor: "#6e4f3c",
      ceiling: "#ece7e3",
      accent: "#d4ab74",
    },
    items,
    aesthetic: null,
  };
}
