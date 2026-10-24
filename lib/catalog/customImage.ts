import { removeBackground } from "@/lib/three/cutout";
import { loadImage } from "@/lib/utils/image";

/**
 * Turning any picture into the clean PNG a user-made item is drawn from.
 *
 * Every image — uploaded, or imported from a link — goes through a canvas
 * before it is kept. That is the security boundary for imported images:
 * whatever the bytes were, only their pixels survive, re-encoded as PNG, with
 * no metadata, no scripts and no vector content.
 */

const MAX_KEEP = 900;

export interface PreparedCutout {
  dataUrl: string;
  /** Width ÷ height of the visible part, after trimming empty margins. */
  aspect: number;
  /** The background looked busy — probably a room photo, not a product shot. */
  uncertain: boolean;
  /** Almost nothing was removed. */
  littleRemoved: boolean;
}

/** Crop away fully transparent margins, so the item's size is the object's size. */
function trimmed(src: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = src.getContext("2d")!;
  const { width: w, height: h } = src;
  const data = ctx.getImageData(0, 0, w, h).data;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < x0 || y1 < y0) return src;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
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

/** Decode, optionally remove the background, trim, shrink, re-encode as PNG. */
export async function prepareCutout(src: string, removeBg: boolean): Promise<PreparedCutout> {
  const img = await loadImage(src);
  let canvas: HTMLCanvasElement;
  let uncertain = false;
  let littleRemoved = false;

  const result = removeBg ? removeBackground(img) : null;
  if (result) {
    canvas = result.canvas;
    uncertain = result.uncertain;
    littleRemoved = result.removed < 0.04;
  } else {
    canvas = document.createElement("canvas");
    const s = Math.min(1, 1400 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * s));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * s));
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  }

  const final = downscaled(trimmed(canvas));
  return {
    dataUrl: final.toDataURL("image/png"),
    aspect: final.width / Math.max(1, final.height),
    uncertain,
    littleRemoved,
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
