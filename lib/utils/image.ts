"use client";

/** Longest edge we keep for the room texture. Beyond this is invisible detail. */
export const MAX_SOURCE_DIM = 1800;
const THUMB_DIM = 480;

export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode that image"));
    img.src = src;
  });
}

/**
 * Decode, orient and downscale an uploaded photo.
 *
 * `imageOrientation: "from-image"` is the important part — phone photos carry
 * EXIF rotation, and a sideways photo would send the whole perspective fit
 * sideways with it.
 */
export async function prepareImage(
  file: File | Blob,
  maxDim = MAX_SOURCE_DIM,
): Promise<PreparedImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    // Safari < 16 has no imageOrientation option; fall back to a plain decode.
    bitmap = await createImageBitmap(file);
  }

  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), width, height };
}

/** Small JPEG for project cards. */
export function makeThumbnail(
  source: HTMLCanvasElement | HTMLImageElement,
  dim = THUMB_DIM,
): string {
  const sw = "naturalWidth" in source ? source.naturalWidth : source.width;
  const sh = "naturalHeight" in source ? source.naturalHeight : source.height;
  const scale = Math.min(1, dim / Math.max(sw, sh));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}
