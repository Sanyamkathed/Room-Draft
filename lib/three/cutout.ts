"use client";

/**
 * Turning a product photo into a cutout.
 *
 * Procedural models can be *plausible*, but they can never be the actual thing
 * you are about to buy. For flat decor — posters, prints, neon signs, wall
 * lights — the honest way to show exactly how it will look is the seller's own
 * photo with its background removed, mounted at its real size. A flat cutout
 * is not an approximation there: the object really is flat.
 *
 * The removal targets the case this is for — a product shot on a plain white
 * or light studio background. It floods inward from the frame edge, so a white
 * shape *inside* the product survives while the backdrop around it goes; a
 * plain colour-distance threshold would punch holes through white lettering.
 */

const MAX_DIM = 1400;
/** How far a pixel may stray from the sampled background and still count as it. */
const DEFAULT_TOLERANCE = 34;

export interface CutoutResult {
  canvas: HTMLCanvasElement;
  /** Fraction of the image that was removed — used to warn on a likely miss. */
  removed: number;
  /** True when the border looked busy, i.e. probably not a studio shot. */
  uncertain: boolean;
}

function medianBorderColour(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): [number, number, number, number] {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];

  const sample = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
  };

  const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
  for (let x = 0; x < w; x += step) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 0; y < h; y += step) {
    sample(0, y);
    sample(w - 1, y);
  }

  const mid = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    return arr[Math.floor(arr.length / 2)];
  };
  const r = mid(rs);
  const g = mid(gs);
  const b = mid(bs);

  // Spread of the border tells us whether this really is a plain backdrop.
  let spread = 0;
  for (let i = 0; i < rs.length; i++) {
    spread += Math.abs(rs[i] - r) + Math.abs(gs[i] - g) + Math.abs(bs[i] - b);
  }
  return [r, g, b, spread / Math.max(1, rs.length)];
}

export function removeBackground(
  source: HTMLImageElement,
  tolerance = DEFAULT_TOLERANCE,
): CutoutResult | null {
  const sw = source.naturalWidth;
  const sh = source.naturalHeight;
  if (!sw || !sh) return null;

  const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  const [br, bg, bb, spread] = medianBorderColour(data, w, h);

  // Flood inward from the frame. Anything the flood cannot reach is part of the
  // product, even if it happens to be the same colour as the backdrop.
  const bgMask = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const matches = (idx: number) => {
    const i = idx * 4;
    return (
      Math.abs(data[i] - br) <= tolerance &&
      Math.abs(data[i + 1] - bg) <= tolerance &&
      Math.abs(data[i + 2] - bb) <= tolerance
    );
  };

  const push = (idx: number) => {
    if (bgMask[idx] || !matches(idx)) return;
    bgMask[idx] = 1;
    queue[tail++] = idx;
  };

  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }

  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x > 0) push(idx - 1);
    if (x < w - 1) push(idx + 1);
    if (y > 0) push(idx - w);
    if (y < h - 1) push(idx + w);
  }

  // Soften the boundary. A hard binary cut leaves a jagged fringe of leftover
  // background pixels that reads as a bad crop from across the room.
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = bgMask[i] ? 0 : 1;

  const blurred = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += alpha[yy * w + xx];
          n++;
        }
      }
      blurred[y * w + x] = sum / n;
    }
  }

  let removed = 0;
  for (let i = 0; i < w * h; i++) {
    const a = blurred[i];
    data[i * 4 + 3] = Math.round(Math.min(1, a * 1.15) * 255);
    if (a < 0.5) removed++;
  }

  ctx.putImageData(image, 0, 0);

  return {
    canvas,
    removed: removed / (w * h),
    // A busy border means this was probably a lifestyle shot, not a cutout —
    // worth telling the user rather than silently producing a mess.
    uncertain: spread > 90,
  };
}

export function cutoutToDataUrl(result: CutoutResult): string {
  return result.canvas.toDataURL("image/png");
}
