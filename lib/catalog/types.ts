export type CategoryId =
  | "lighting"
  | "wall"
  | "desk"
  | "collectibles"
  | "decor"
  | "culture"
  /** Existing furniture in the user's room, not something to buy. */
  | "furniture";

export type AestheticId =
  | "dark-academia"
  | "minimalist"
  | "cyberpunk"
  | "anime"
  | "gaming"
  | "cozy"
  | "scandinavian"
  | "y2k"
  | "indie"
  | "retro"
  | "streetwear"
  | "neon"
  | "moody"
  | "clean-desk"
  | "creator";

/**
 * How an item attaches to the world. This drives snapping, default rotation
 * and what counts as a legal drop target — it is the single most important
 * field on a product.
 */
export type MountType =
  | "wall" // posters, neon, mirrors, shelves — sits flat against a vertical plane
  | "floor" // rugs, beanbags, side tables — rests on the floor
  | "tabletop" // figures, lamps, plants — rests on any horizontal surface
  | "ceiling" // hanging plants, disco balls — drops from above
  | "edge"; // LED strips, string lights — runs along a room edge

export type ModelKind =
  | "poster"
  | "framedArt"
  | "tapestry"
  | "photoGrid"
  | "neonSign"
  | "ledStrip"
  | "stringLights"
  | "wallClock"
  | "mirror"
  | "shelf"
  | "hexShelf"
  | "controllerMount"
  | "monitorRiser"
  | "miniBookshelf"
  | "deskLamp"
  | "moonLamp"
  | "lavaLamp"
  | "saltLamp"
  | "jellyLamp"
  | "sunsetLamp"
  | "barLamp"
  | "discoBall"
  | "plant"
  | "hangingPlant"
  | "vase"
  | "candle"
  | "diffuser"
  | "figure"
  | "funko"
  | "bust"
  | "books"
  | "organizer"
  | "speaker"
  | "headphoneStand"
  | "rug"
  | "sideTable"
  | "beanbag"
  | "sodaCans"
  | "mushroomLamp"
  | "cloudLight"
  | "checkerRug"
  /* ---- furniture: the things already in the room ---- */
  | "bed"
  | "desk"
  | "wardrobe"
  | "bookshelfTall"
  | "chair"
  | "nightstand"
  | "tvUnit"
  | "sofa"
  | "dresser"
  | "doorway"
  | "windowFrame";

/** Real-world dimensions, in centimetres. */
export interface Dimensions {
  w: number;
  h: number;
  d: number;
}

export interface EmissiveSpec {
  color: string;
  /** Material emissive strength. */
  intensity: number;
  /** Light cast into the room, in watts-ish three.js units. 0 = no real light. */
  lightIntensity: number;
  /** How far the cast light reaches, metres. */
  distance: number;
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  /** Price in INR. */
  price: number;
  mrp?: number;
  category: CategoryId;
  subcategory: string;
  dims: Dimensions;
  mount: MountType;
  model: ModelKind;
  /** Drives the procedural model's materials — first entry is the primary colour. */
  palette: string[];
  emissive?: EmissiveSpec;
  aesthetics: AestheticId[];
  tags: string[];
  rating: number;
  reviews: number;
  /**
   * The part that actually rests on a surface, in cm, when it is smaller than
   * the overall size. An architect lamp is 40cm deep because its arm reaches
   * over the desk, but only its 16cm base has to fit on the shelf. Placement
   * and collision use this; the model is still drawn at full size.
   */
  footprint?: { w: number; d: number };
  /** Can other objects be stacked on top of this one? */
  stackable?: boolean;
  /** Search query used to build the marketplace link. */
  query: string;
  /**
   * Furniture represents what is ALREADY in the room. It is placed, collides
   * and can be stacked on like any other object, but it is never listed in the
   * shop, never recommended, and has no price shown.
   */
  isFurniture?: boolean;
}

export interface CatalogFilter {
  category?: CategoryId;
  aesthetic?: AestheticId;
  search?: string;
  maxPrice?: number;
  mount?: MountType;
}

/**
 * The seam between the app and wherever products come from.
 *
 * The shipped implementation is a local curated catalog. A live Amazon PA-API
 * source implements the same three methods and drops in without the UI or the
 * 3D layer knowing anything changed.
 */
export interface CatalogSource {
  readonly id: string;
  list(filter?: CatalogFilter): Promise<Product[]>;
  get(id: string): Promise<Product | undefined>;
  related(id: string, limit?: number): Promise<Product[]>;
}

export const CATEGORIES: { id: CategoryId; label: string; blurb: string }[] = [
  { id: "lighting", label: "Lighting", blurb: "Neon, LED, lamps, ambience" },
  { id: "wall", label: "Wall", blurb: "Posters, art, mirrors, shelves" },
  { id: "desk", label: "Desk & Setup", blurb: "Organisers, audio, accessories" },
  { id: "collectibles", label: "Collectibles", blurb: "Figures, funkos, sculpture" },
  { id: "decor", label: "Decor", blurb: "Plants, candles, vases, rugs" },
  { id: "culture", label: "Culture", blurb: "Gaming, anime, music, cyberpunk" },
];

export const AESTHETICS: {
  id: AestheticId;
  label: string;
  blurb: string;
  /** Mood-board gradient stops — used across Discover and theme chips. */
  swatch: [string, string, string];
  /** Keywords the design assistant matches free text against. */
  keywords: string[];
}[] = [
  {
    id: "dark-academia",
    label: "Dark Academia",
    blurb: "Oxblood, brass, stacked books, low warm light",
    swatch: ["#2a211b", "#6b4f33", "#c9a227"],
    keywords: ["academia", "vintage", "books", "scholar", "library", "brass", "moody"],
  },
  {
    id: "minimalist",
    label: "Minimalist",
    blurb: "Negative space, one texture, nothing loud",
    swatch: ["#e9e7e2", "#b6b2aa", "#3d3b38"],
    keywords: ["minimal", "clean", "simple", "bare", "calm", "muji", "neutral"],
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    blurb: "Magenta on cyan, hard shadows, wet-neon glow",
    swatch: ["#0b0b18", "#ff2d95", "#00e5ff"],
    keywords: ["cyberpunk", "neon", "futuristic", "blade", "tokyo", "rgb", "synthwave"],
  },
  {
    id: "anime",
    label: "Anime",
    blurb: "Figures, panels, poster walls, soft pinks",
    swatch: ["#151321", "#ff7ab6", "#7ad0ff"],
    keywords: ["anime", "manga", "otaku", "weeb", "figure", "waifu", "japan"],
  },
  {
    id: "gaming",
    label: "Gaming",
    blurb: "RGB, matte black, cable discipline",
    swatch: ["#0d0d10", "#7c4dff", "#00ff9d"],
    keywords: ["gaming", "gamer", "rgb", "setup", "battlestation", "streamer", "pc"],
  },
  {
    id: "cozy",
    label: "Cozy",
    blurb: "Warm 2200K, soft textiles, candles",
    swatch: ["#2a1f1a", "#c98b5e", "#f2d9b6"],
    keywords: ["cozy", "cosy", "warm", "comfort", "soft", "hygge", "snug", "calm"],
  },
  {
    id: "scandinavian",
    label: "Scandinavian",
    blurb: "Pale wood, white walls, one plant",
    swatch: ["#f4f1ec", "#d8c3a5", "#8a8577"],
    keywords: ["scandi", "nordic", "wood", "light", "airy", "ikea", "birch"],
  },
  {
    id: "y2k",
    label: "Y2K",
    blurb: "Chrome, bubblegum, glitter, early-web gloss",
    swatch: ["#1a1024", "#ff6ec7", "#9be8ff"],
    keywords: ["y2k", "2000s", "chrome", "bubblegum", "glitter", "holographic", "bratz"],
  },
  {
    id: "indie",
    label: "Indie",
    blurb: "Polaroids, string lights, layered posters",
    swatch: ["#1e1b16", "#d9a066", "#a8c686"],
    keywords: ["indie", "collage", "polaroid", "eclectic", "diy", "grunge", "film"],
  },
  {
    id: "retro",
    label: "Retro",
    blurb: "Burnt orange, CRT curves, 70s grain",
    swatch: ["#241a12", "#e07a3f", "#f0c674"],
    keywords: ["retro", "vintage", "70s", "80s", "crt", "analog", "vinyl"],
  },
  {
    id: "streetwear",
    label: "Streetwear",
    blurb: "Concrete, monochrome, one hit of colour",
    swatch: ["#141414", "#4a4a4a", "#ff4b20"],
    keywords: ["street", "streetwear", "hype", "sneaker", "urban", "concrete", "skate"],
  },
  {
    id: "neon",
    label: "Neon",
    blurb: "Signs as the only light source",
    swatch: ["#0a0a12", "#ff3d81", "#37f0d0"],
    keywords: ["neon", "glow", "sign", "led", "bright", "electric"],
  },
  {
    id: "moody",
    label: "Moody",
    blurb: "Deep shadow, one pool of light, dark walls",
    swatch: ["#101012", "#2c2c33", "#8a7f6d"],
    keywords: ["moody", "dark", "dim", "shadow", "grunge", "atmospheric", "noir"],
  },
  {
    id: "clean-desk",
    label: "Clean Desk",
    blurb: "Everything docked, nothing loose",
    swatch: ["#17171a", "#9aa0a6", "#e8e8ea"],
    keywords: ["desk", "productivity", "study", "organised", "workspace", "tidy", "focus"],
  },
  {
    id: "creator",
    label: "Creator Setup",
    blurb: "Key light, backdrop, on-camera ready",
    swatch: ["#121316", "#5b8cff", "#ffcf6b"],
    keywords: ["creator", "stream", "youtube", "camera", "content", "podcast", "studio"],
  },
];

export function aestheticById(id: AestheticId) {
  return AESTHETICS.find((a) => a.id === id)!;
}
