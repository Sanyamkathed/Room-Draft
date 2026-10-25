import { removeBackground } from "@/lib/three/cutout";
import { loadImage } from "@/lib/utils/image";
import { completeSymmetric, cutOutProduct, findGlass, keepMainObject } from "./segment";

/**
 * Turning any picture into the clean PNG a user-made item is drawn from.
 *
 * Every image — uploaded, or imported from a link — goes through a canvas
 * before it is kept. That is the security boundary for imported images:
 * whatever the bytes were, only their pixels survive, re-encoded as PNG, with
 * no metadata, no scripts and no vector content.
 */

// Enough detail to stay sharp on a phone held close; still small enough
// to embed in a saved room.
const MAX_KEEP = 1280;

export interface PreparedCutout {
  dataUrl: string;
  /** Width ÷ height of the visible part, after trimming empty margins. */
  aspect: number;
  /** The background looked busy — probably a room photo, not a product shot. */
  uncertain: boolean;
  /** Almost nothing was removed. */
  littleRemoved: boolean;
  /** Other separate objects found besides the main one (removed if mainOnly). */
  others: number;
  /** For a mirror: where its glass is, as a mask the same size as the cutout. */
  glass?: string;
  /** How the background went: colour keying, the on-device model, or not at all. */
  method: "plain" | "ai" | "none";
}

/**
 * Crop away fully transparent margins, so the item's size is the object's size.
 * `also` (a mirror's glass mask) is opaque where `src` is not, so it counts
 * towards the visible area and is cropped identically.
 */
function trimmed(src: HTMLCanvasElement, also?: HTMLCanvasElement | null): HTMLCanvasElement[] {
  const ctx = src.getContext("2d")!;
  const { width: w, height: h } = src;
  const data = ctx.getImageData(0, 0, w, h).data;
  const extra = also?.getContext("2d")!.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24 || (extra && extra[(y * w + x) * 4 + 3] > 24)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  const all = also ? [src, also] : [src];
  if (x1 < x0 || y1 < y0) return all;
  return all.map((c) => {
    const out = document.createElement("canvas");
    out.width = x1 - x0 + 1;
    out.height = y1 - y0 + 1;
    out.getContext("2d")!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out;
  });
}

function downscaled(src: HTMLCanvasElement, max = MAX_KEEP): HTMLCanvasElement {
  const s = Math.min(1, max / Math.max(src.width, src.height));
  if (s === 1) return src;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(src.width * s));
  out.height = Math.max(1, Math.round(src.height * s));
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/** Per pixel, the more opaque of two cutouts of the same photo. */
function unionCutouts(keyed: HTMLCanvasElement, model: HTMLCanvasElement): HTMLCanvasElement {
  const w = model.width;
  const h = model.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(keyed, 0, 0, w, h);
  const a = ctx.getImageData(0, 0, w, h);
  const b = model.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const d = a.data;
  for (let i = 0; i < d.length; i += 4) {
    if (b[i + 3] > d[i + 3]) {
      d[i] = b[i];
      d[i + 1] = b[i + 1];
      d[i + 2] = b[i + 2];
      d[i + 3] = b[i + 3];
    }
  }
  ctx.putImageData(a, 0, 0);
  return out;
}

/** Decode, optionally remove the background, trim, shrink, re-encode as PNG. */
export async function prepareCutout(
  src: string,
  removeBg: boolean,
  mainOnly = true,
  /** It's a mirror: find the glass its frame encloses. */
  mirror = false,
): Promise<PreparedCutout> {
  const img = await loadImage(src);
  let canvas: HTMLCanvasElement;
  let uncertain = false;
  let littleRemoved = false;
  let method: PreparedCutout["method"] = "none";

  const result = removeBg ? removeBackground(img) : null;
  if (result) {
    canvas = result.canvas;
    uncertain = result.uncertain;
    littleRemoved = result.removed < 0.04;
    method = "plain";
    const found = await cutOutProduct(img);
    if (found && (uncertain || littleRemoved)) {
      // A lifestyle photo has no single backdrop colour to remove, so colour
      // keying leaves the room behind. Find the product itself instead.
      canvas = found;
      method = "ai";
      uncertain = false;
      littleRemoved = false;
    } else if (found) {
      // On a plain backdrop colour keying gives the crisper edge — but it
      // also eats any part of the product that matches the backdrop (white
      // faces and silver hair on a white table). Whatever either one calls
      // product stays.
      canvas = unionCutouts(canvas, found);
    }
  } else {
    canvas = document.createElement("canvas");
    const s = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * s));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * s));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  // Several separate things in the cutout (the cherries and the candle next
  // to them): keep the photo's subject unless the user wants them all.
  // Only for lifestyle photos: a product shot on a plain backdrop that shows
  // several things is usually a set (two figures, three candles) — all of it
  // is the product.
  let others = 0;
  if (removeBg && method === "ai") {
    const probe = document.createElement("canvas");
    probe.width = canvas.width;
    probe.height = canvas.height;
    probe.getContext("2d")!.drawImage(canvas, 0, 0);
    others = keepMainObject(probe);
    if (mainOnly && others > 0) canvas = probe;
  }

  // A mirror's glass shows a reflection, not the mirror, so the cutout loses
  // it; and a white frame against a bright room loses stretches of itself.
  // Mend the frame from its other side, then the glass is what it encloses.
  let glass: HTMLCanvasElement | null = null;
  if (mirror && removeBg) {
    completeSymmetric(canvas);
    glass = findGlass(canvas);
  }
  const [cut, glassCut] = trimmed(canvas, glass);
  const final = downscaled(cut);
  // The glass needs only its shape, so a smaller mask does.
  const glassFinal = glassCut ? downscaled(glassCut, 512) : null;
  return {
    others,
    glass: glassFinal?.toDataURL("image/png"),
    dataUrl: final.toDataURL("image/png"),
    aspect: final.width / Math.max(1, final.height),
    uncertain,
    littleRemoved,
    method,
  };
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(file.type)) {
      reject(new Error("Choose a JPEG, PNG, WEBP or GIF image."));
      return;
    }
    if (file.size > 15_000_000) {
      reject(new Error("That image is over 15 MB."));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}
