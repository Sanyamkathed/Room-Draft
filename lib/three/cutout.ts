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
  tolerance?: number,
): CutoutResult | null {
  const sw = source.naturalWidth;
  const sh = source.naturalHeight;
  if (!sw || !sh) return null;

  const scale = Math.min(1, MAX_DIM / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale));
  const h = Math.max(1, Math.round(sh * scale));
  const N = w * h;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(source, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;

  // A source that already has transparency (a PNG cutout, which Pinterest
  // originals often are) keeps it: only the opaque pixels are judged below.
  let alreadyTransparent = 0;
  for (let i = 0; i < N; i++) if (data[i * 4 + 3] < 250) alreadyTransparent++;

  const [br, bg, bb, spread] = medianBorderColour(data, w, h);
  const bgLum = 0.299 * br + 0.587 * bg + 0.114 * bb;
  const bgSat = Math.max(br, bg, bb) - Math.min(br, bg, bb);
  const neutralLightBg = bgLum > 170 && bgSat < 40;

  // Tolerance follows how noisy the backdrop is: a clean studio white gets a
  // tight cut, a slightly mottled one a looser cut.
  const tol = tolerance ?? Math.max(DEFAULT_TOLERANCE * 0.7, Math.min(60, 20 + spread * 0.55));

  const distBg = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const dr = data[i * 4] - br;
    const dg = data[i * 4 + 1] - bg;
    const db = data[i * 4 + 2] - bb;
    distBg[i] = Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9);
  }
  const step = (a: number, b: number) => {
    const dr = data[a * 4] - data[b * 4];
    const dg = data[a * 4 + 1] - data[b * 4 + 1];
    const db = data[a * 4 + 2] - data[b * 4 + 2];
    return Math.sqrt((2 * dr * dr + 4 * dg * dg + 3 * db * db) / 9);
  };
  const lowSat = (i: number) => {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    return Math.max(r, g, b) - Math.min(r, g, b) < 28;
  };

  // 1) Flood inward from the frame. A pixel joins the background if it
  // matches the backdrop colour, OR if it continues a smooth gradient from a
  // background neighbour — the soft grey shadow under a product, or a studio
  // sweep that darkens toward one corner. Anything the flood can't reach is
  // the product, even where it shares the backdrop's colour.
  const bgMask = new Uint8Array(N);
  const queue = new Int32Array(N);
  let head = 0;
  let tail = 0;
  const seed = (i: number) => {
    if (bgMask[i] || (data[i * 4 + 3] >= 250 && distBg[i] > tol)) return;
    bgMask[i] = 1;
    queue[tail++] = i;
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  const visit = (from: number, j: number) => {
    if (bgMask[j]) return;
    if (data[j * 4 + 3] < 250) {
      bgMask[j] = 1;
      queue[tail++] = j;
      return;
    }
    const near = distBg[j] <= tol;
    const gradient = step(from, j) < 5.5 && distBg[j] < tol * 2.6 && (!neutralLightBg || lowSat(j));
    if (near || gradient) {
      bgMask[j] = 1;
      queue[tail++] = j;
    }
  };
  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) visit(i, i - 1);
    if (x < w - 1) visit(i, i + 1);
    if (y > 0) visit(i, i - w);
    if (y < h - 1) visit(i, i + w);
  }

  // 2) Enclosed background: the gap inside a mug handle or between a
  // figure's legs is backdrop too, but the flood can't reach it. Remove
  // enclosed patches that are almost exactly the backdrop colour — strictly,
  // so a product's own white surfaces (which are shaded, never flat studio
  // white) survive.
  const strict = Math.min(tol * 0.5, 13);
  const label = new Int32Array(N);
  const minHole = Math.max(10, N * 0.00006);
  let nextLabel = 1;
  for (let s = 0; s < N; s++) {
    if (bgMask[s] || label[s] || distBg[s] > strict || data[s * 4 + 3] < 250) continue;
    const id = nextLabel++;
    head = 0;
    tail = 0;
    queue[tail++] = s;
    label[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || label[j] || bgMask[j] || distBg[j] > strict) continue;
        label[j] = id;
        queue[tail++] = j;
      }
    }
    if (tail >= minHole) for (let k = 0; k < tail; k++) bgMask[queue[k]] = 1;
  }

  // 3) Despeckle: specks of "product" floating in the backdrop (JPEG noise,
  // a stray crumb) are dropped; real parts of the product are far larger.
  const seen = new Uint8Array(N);
  const minPart = Math.max(24, N * 0.0006);
  for (let s = 0; s < N; s++) {
    if (bgMask[s] || seen[s]) continue;
    head = 0;
    tail = 0;
    queue[tail++] = s;
    seen[s] = 1;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i / w) | 0;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || seen[j] || bgMask[j]) continue;
        seen[j] = 1;
        queue[tail++] = j;
      }
    }
    if (tail < minPart) for (let k = 0; k < tail; k++) bgMask[queue[k]] = 1;
  }

  // 4) Soft edge and halo removal. Edge pixels are part product, part
  // backdrop; leaving them opaque draws a white rim around the cutout. Their
  // alpha comes from how far they are from the backdrop colour, and the
  // backdrop's share is subtracted back out of their colour.
  let removed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (bgMask[i]) {
        data[o + 3] = 0;
        removed++;
        continue;
      }
      let edge = false;
      for (let dy = -2; dy <= 2 && !edge; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (bgMask[yy * w + xx]) {
            edge = true;
            break;
          }
        }
      }
      if (!edge) continue;
      const a = Math.min(1, Math.max(0.08, (distBg[i] - tol * 0.35) / (tol * 1.6)));
      if (a < 1) {
        data[o] = Math.max(0, Math.min(255, (data[o] - (1 - a) * br) / a));
        data[o + 1] = Math.max(0, Math.min(255, (data[o + 1] - (1 - a) * bg) / a));
        data[o + 2] = Math.max(0, Math.min(255, (data[o + 2] - (1 - a) * bb) / a));
      }
      data[o + 3] = Math.round(Math.min(data[o + 3], a * 255));
    }
  }

  ctx.putImageData(image, 0, 0);

  return {
    canvas,
    removed: (removed + (alreadyTransparent > N * 0.05 ? alreadyTransparent : 0)) / N,
    // A busy border means this was probably a lifestyle shot, not a cutout —
    // worth telling the user rather than silently producing a mess.
    uncertain: spread > 90,
  };
}

export function cutoutToDataUrl(result: CutoutResult): string {
  return result.canvas.toDataURL("image/png");
}
