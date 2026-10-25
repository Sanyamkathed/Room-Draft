/**
 * Finding "the product" in a photo that isn't a product shot.
 *
 * Pinterest is mostly lifestyle photos — a vase on a dresser in front of a
 * textured wall — and colour-based background removal can't separate those:
 * there is no single backdrop colour to remove. This runs a small salient-
 * object model (U²-Net-p, Apache-2.0, ~4.6 MB) in the browser to find the
 * main object, and keeps only that.
 *
 * Free and private: the model runs on the device (WebAssembly), nothing is
 * uploaded, and it loads only the first time a busy photo needs it.
 *
 *  - Runtime: ONNX Runtime Web from jsDelivr, pinned to one version and
 *    checked with subresource integrity, so a changed file is refused.
 *  - Model: served from this app (/models/u2netp.onnx), md5
 *    8e83ca70e441ab06c318d82300c84806, the same file rembg publishes.
 */

const ORT_VERSION = "1.20.1";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
const ORT_SRI = "sha384-RPL/K8tc0JVaNWsunkEmCzLeieefvFX2UCRLKLmLVChCI6P+CTKhzqF7VIeCc3Zp";
const MODEL_URL = "/models/u2netp.onnx";
const SIZE = 320;

/* Minimal typing for the bits of onnxruntime-web used here. */
interface OrtTensor {
  data: Float32Array;
  dims: readonly number[];
}
interface OrtSession {
  inputNames: readonly string[];
  outputNames: readonly string[];
  run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>;
}
interface Ort {
  env: { wasm: { wasmPaths: string; numThreads: number } };
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(url: string, opts: Record<string, unknown>): Promise<OrtSession> };
}

let ortPromise: Promise<Ort> | null = null;
let sessionPromise: Promise<OrtSession> | null = null;

function loadOrt(): Promise<Ort> {
  if (!ortPromise) {
    ortPromise = new Promise<Ort>((resolve, reject) => {
      const existing = (window as unknown as { ort?: Ort }).ort;
      if (existing) return resolve(existing);
      const s = document.createElement("script");
      s.src = `${ORT_BASE}ort.min.js`;
      s.integrity = ORT_SRI;
      s.crossOrigin = "anonymous";
      s.async = true;
      s.onload = () => {
        const ort = (window as unknown as { ort?: Ort }).ort;
        if (!ort) return reject(new Error("The cutout engine didn't load."));
        ort.env.wasm.wasmPaths = ORT_BASE;
        // Threads need cross-origin isolation, which this site doesn't have.
        ort.env.wasm.numThreads = 1;
        resolve(ort);
      };
      s.onerror = () => reject(new Error("Couldn't load the cutout engine — check your connection."));
      document.head.appendChild(s);
    }).catch((e) => {
      ortPromise = null;
      throw e;
    });
  }
  return ortPromise;
}

function getSession(): Promise<OrtSession> {
  if (!sessionPromise) {
    sessionPromise = loadOrt()
      .then((ort) =>
        ort.InferenceSession.create(MODEL_URL, {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        }),
      )
      .catch((e) => {
        sessionPromise = null;
        throw e;
      });
  }
  return sessionPromise;
}

/** A 320×320 map, 0..1, of how much each pixel belongs to the main object. */
async function saliency(img: HTMLImageElement): Promise<Float32Array> {
  const [ort, session] = await Promise.all([loadOrt(), getSession()]);

  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const px = ctx.getImageData(0, 0, SIZE, SIZE).data;

  // Same preprocessing the model was trained with: scale by the image's own
  // maximum, then ImageNet mean/std, channels first.
  let max = 1;
  for (let i = 0; i < px.length; i += 4) max = Math.max(max, px[i], px[i + 1], px[i + 2]);
  const mean = [0.485, 0.456, 0.406];
  const std = [0.229, 0.224, 0.225];
  const plane = SIZE * SIZE;
  const input = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) {
    for (let ch = 0; ch < 3; ch++) {
      input[ch * plane + i] = (px[i * 4 + ch] / max - mean[ch]) / std[ch];
    }
  }

  const out = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, SIZE, SIZE]),
  });
  const pred = out[session.outputNames[0]].data;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < plane; i++) {
    lo = Math.min(lo, pred[i]);
    hi = Math.max(hi, pred[i]);
  }
  const span = Math.max(1e-6, hi - lo);
  const m = new Float32Array(plane);
  for (let i = 0; i < plane; i++) m[i] = (pred[i] - lo) / span;
  return m;
}

/**
 * The photo with everything but its main object made transparent.
 * Returns null if the model can't run here (no WebAssembly, offline).
 */
export async function cutOutProduct(img: HTMLImageElement, maxDim = 1400): Promise<HTMLCanvasElement | null> {
  let mask: Float32Array;
  try {
    mask = await saliency(img);
  } catch {
    return null;
  }

  const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  // Bilinear-sample the mask up to full size, then firm it: the model's
  // edges are soft by a few pixels, which reads as a halo; a gentle
  // smoothstep keeps the edge anti-aliased but drops the fog around it.
  const sample = (x: number, y: number) => {
    const fx = Math.min(SIZE - 1, Math.max(0, (x / w) * SIZE - 0.5));
    const fy = Math.min(SIZE - 1, Math.max(0, (y / h) * SIZE - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(SIZE - 1, x0 + 1);
    const y1 = Math.min(SIZE - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = mask[y0 * SIZE + x0] * (1 - tx) + mask[y0 * SIZE + x1] * tx;
    const b = mask[y1 * SIZE + x0] * (1 - tx) + mask[y1 * SIZE + x1] * tx;
    return a * (1 - ty) + b * ty;
  };
  const raw = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw[y * w + x] = sample(x, y);
  }
  // The model sees a 320px thumbnail, so its edge is a blurry guess at full
  // size. A guided filter re-draws that edge along the photo's own colour
  // boundaries — the sofa's outline, not a soft blob around it.
  const lum = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    lum[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  const refined = guidedFilter(lum, raw, w, h, Math.max(2, Math.round(Math.max(w, h) / 220)), 0.004);
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const t = Math.min(1, Math.max(0, (refined[i] - 0.3) / 0.4));
    alpha[i] = t * t * (3 - 2 * t);
  }

  for (let i = 0; i < w * h; i++) {
    d[i * 4 + 3] = Math.round(Math.min(d[i * 4 + 3], alpha[i] * 255));
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Keep only the photo's main object, in place.
 *
 * A cutout can contain several separate things — the cherries AND the candle
 * beside them. A product photo frames its subject, so: split the cutout into
 * solid pieces, group pieces that sit close together (one product is often
 * several pieces: two cherry balls, stems, leaves), and keep the group that
 * is largest and most central. Returns how many other groups were removed,
 * so the UI can offer to put them back (a set shot together is all product).
 */
export function keepMainObject(canvas: HTMLCanvasElement): number {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const N = w * h;

  // High-confidence pixels only: touching objects are joined by soft edges,
  // which this cuts.
  const solid = new Uint8Array(N);
  for (let i = 0; i < N; i++) solid[i] = d[i * 4 + 3] > 216 ? 1 : 0;

  const label = new Int32Array(N);
  const sizes: number[] = [0];
  const boxes: [number, number, number, number][] = [[0, 0, 0, 0]];
  const sumX: number[] = [0];
  const sumY: number[] = [0];
  const queue = new Int32Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (!solid[s0] || label[s0]) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s0;
    label[s0] = id;
    let bx0 = w;
    let by0 = h;
    let bx1 = 0;
    let by1 = 0;
    let sx = 0;
    let sy = 0;
    while (head < tail) {
      const i = queue[head++];
      const x = i % w;
      const y = (i / w) | 0;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
      sx += x;
      sy += y;
      if (x > 0 && solid[i - 1] && !label[i - 1]) { label[i - 1] = id; queue[tail++] = i - 1; }
      if (x < w - 1 && solid[i + 1] && !label[i + 1]) { label[i + 1] = id; queue[tail++] = i + 1; }
      if (y > 0 && solid[i - w] && !label[i - w]) { label[i - w] = id; queue[tail++] = i - w; }
      if (y < h - 1 && solid[i + w] && !label[i + w]) { label[i + w] = id; queue[tail++] = i + w; }
    }
    sizes.push(tail);
    boxes.push([bx0, by0, bx1, by1]);
    sumX.push(sx);
    sumY.push(sy);
  }
  const n = sizes.length;
  const biggest = Math.max(0, ...sizes);
  if (biggest === 0) return 0;

  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  // Pieces count as one object when their actual shapes come within ~1.5% of
  // the image of each other — measured on the pixels, not their bounding
  // boxes, which overlap for things that merely sit side by side.
  const minPiece = biggest * 0.02;
  const G = 160;
  const gs = G / Math.max(w, h);
  const gw = Math.max(1, Math.ceil(w * gs));
  const gh = Math.max(1, Math.ceil(h * gs));
  const cell = new Int32Array(gw * gh);
  for (let i = 0; i < N; i++) {
    const l = label[i];
    if (!l || sizes[l] < minPiece) continue;
    const cx = Math.min(gw - 1, Math.floor((i % w) * gs));
    const cy = Math.min(gh - 1, Math.floor(((i / w) | 0) * gs));
    cell[cy * gw + cx] = l;
  }
  const R = 2;
  for (let cy = 0; cy < gh; cy++) {
    for (let cx = 0; cx < gw; cx++) {
      const l = cell[cy * gw + cx];
      if (!l) continue;
      for (let dy = -R; dy <= R; dy++) {
        for (let dx = -R; dx <= R; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
          const m = cell[y * gw + x];
          if (m && m !== l) parent[find(m)] = find(l);
        }
      }
    }
  }
  const groups = new Map<number, { n: number; x: number; y: number }>();
  for (let i = 1; i < n; i++) {
    if (sizes[i] < minPiece) continue;
    const r = find(i);
    const g = groups.get(r) ?? { n: 0, x: 0, y: 0 };
    g.n += sizes[i];
    g.x += sumX[i];
    g.y += sumY[i];
    groups.set(r, g);
  }
  if (groups.size <= 1) return 0;

  let best = -1;
  let bestScore = -Infinity;
  for (const [r, g] of groups) {
    const cx = g.x / g.n / w - 0.5;
    const cy = g.y / g.n / h - 0.5;
    const centrality = 1 - Math.min(1, Math.hypot(cx, cy) / 0.71);
    const score = g.n * (0.35 + centrality);
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }

  // A piece lying inside the winner's outline is part of it, split off by
  // something in front (a trailing plant across a mirror frame).
  let bx0 = w;
  let by0 = h;
  let bx1 = 0;
  let by1 = 0;
  for (let i = 1; i < n; i++) {
    if (sizes[i] < minPiece || find(i) !== best) continue;
    bx0 = Math.min(bx0, boxes[i][0]);
    by0 = Math.min(by0, boxes[i][1]);
    bx1 = Math.max(bx1, boxes[i][2]);
    by1 = Math.max(by1, boxes[i][3]);
  }
  const absorbed = new Set<number>();
  for (const [r] of groups) {
    if (r === best) continue;
    let area = 0;
    let inside = 0;
    for (let i = 1; i < n; i++) {
      if (sizes[i] < minPiece || find(i) !== r) continue;
      const [x0, y0, x1, y1] = boxes[i];
      area += (x1 - x0 + 1) * (y1 - y0 + 1);
      const ix = Math.max(0, Math.min(x1, bx1) - Math.max(x0, bx0) + 1);
      const iy = Math.max(0, Math.min(y1, by1) - Math.max(y0, by0) + 1);
      inside += ix * iy;
    }
    if (area > 0 && inside / area > 0.85) absorbed.add(r);
  }
  for (const r of absorbed) parent[r] = best;

  // Everything not in the winning group goes, including its soft edges —
  // except edges that border the winner itself.
  const keep = (l: number) => l > 0 && sizes[l] >= minPiece && find(l) === best;
  const nearWinner = (i: number) => {
    const x = i % w;
    const y = (i / w) | 0;
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        if (keep(label[yy * w + xx])) return true;
      }
    }
    return false;
  };
  for (let i = 0; i < N; i++) {
    if (d[i * 4 + 3] === 0) continue;
    const l = label[i];
    if (l ? !keep(l) : !nearWinner(i)) d[i * 4 + 3] = 0;
  }
  ctx.putImageData(image, 0, 0);
  return groups.size - 1 - absorbed.size;
}

/** Mean over a (2r+1)² window, via a summed-area table. */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const W = w + 1;
  const sat = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sat[(y + 1) * W + x + 1] = sat[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0];
      out[y * w + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

/** He et al.'s guided filter: smooth `p` while following the edges of `I`. */
function guidedFilter(I: Float32Array, p: Float32Array, w: number, h: number, r: number, eps: number): Float32Array {
  const n = w * h;
  const Ip = new Float32Array(n);
  const II = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    Ip[i] = I[i] * p[i];
    II[i] = I[i] * I[i];
  }
  const mI = boxMean(I, w, h, r);
  const mp = boxMean(p, w, h, r);
  const mIp = boxMean(Ip, w, h, r);
  const mII = boxMean(II, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const cov = mIp[i] - mI[i] * mp[i];
    const v = mII[i] - mI[i] * mI[i];
    a[i] = cov / (v + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxMean(a, w, h, r);
  const mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
  return q;
}

/**
 * The glass of a mirror: the space the frame encloses.
 *
 * A mirror photo shows a reflection where the glass is, which no cutout can
 * tell apart from the room — so the glass comes out empty. Its frame,
 * though, surrounds it: close small gaps in the frame (a plant trailing
 * across it), then everything the outside can't reach is glass. Returns a
 * white-on-transparent mask the size of the cutout, or null if the frame
 * encloses nothing.
 */
export function findGlass(canvas: HTMLCanvasElement): HTMLCanvasElement | null {
  // Seal small gaps first; wider ones (a frame half-hidden by a plant) need
  // a bigger seal, which rounds the glass a little more.
  for (const r of [0.025, 0.045, 0.07]) {
    const glass = glassWithin(canvas, r);
    if (glass) return glass;
  }
  return null;
}

function glassWithin(canvas: HTMLCanvasElement, sealFraction: number): HTMLCanvasElement | null {
  const w = canvas.width;
  const h = canvas.height;
  const d = canvas.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  // Work on a small grid: this is about shape, not pixels.
  const G = 240;
  const gs = Math.min(1, G / Math.max(w, h));
  const gw = Math.max(1, Math.round(w * gs));
  const gh = Math.max(1, Math.round(h * gs));
  const solid = new Uint8Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 140) {
        solid[Math.min(gh - 1, Math.floor(y * gs)) * gw + Math.min(gw - 1, Math.floor(x * gs))] = 1;
      }
    }
  }
  // Morphological closing: grow, so gaps in the frame seal, then reach in
  // from the border through what is still open.
  const R = Math.max(2, Math.round(Math.max(gw, gh) * sealFraction));
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!solid[y * gw + x]) continue;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -R; dx <= R; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw || dx * dx + dy * dy > R * R) continue;
          grown[yy * gw + xx] = 1;
        }
      }
    }
  }
  const outside = new Uint8Array(gw * gh);
  const queue = new Int32Array(gw * gh);
  let head = 0;
  let tail = 0;
  const push = (i: number) => {
    if (!grown[i] && !outside[i]) {
      outside[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < gw; x++) {
    push(x);
    push((gh - 1) * gw + x);
  }
  for (let y = 0; y < gh; y++) {
    push(y * gw);
    push(y * gw + gw - 1);
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % gw;
    if (x > 0) push(i - 1);
    if (x < gw - 1) push(i + 1);
    if (i >= gw) push(i - gw);
    if (i < gw * (gh - 1)) push(i + gw);
  }
  // Glass = not reached from outside and not frame. The closing grew the
  // frame inward by R too, so grow the glass back out by R (but never over
  // the frame itself) to meet the frame's inner edge.
  const glass = new Uint8Array(gw * gh);
  let count = 0;
  for (let i = 0; i < gw * gh; i++) {
    if (!outside[i] && !grown[i]) {
      glass[i] = 1;
      count++;
    }
  }
  if (count < gw * gh * 0.02) return null;
  const filled = glass.slice();
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      if (!glass[y * gw + x]) continue;
      for (let dy = -R - 1; dy <= R + 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= gh) continue;
        for (let dx = -R - 1; dx <= R + 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= gw) continue;
          if (!outside[yy * gw + xx]) filled[yy * gw + xx] = 1;
        }
      }
    }
  }

  // Glass only where the frame is on both sides of it: where the photo lost
  // a stretch of the top or bottom bar, the glass stops instead of spilling
  // out past the frame.
  for (let y = 0; y < gh; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < gw; x++) {
      if (!solid[y * gw + x]) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    for (let x = 0; x < gw; x++) {
      if (x0 < 0 || x <= x0 || x >= x1) filled[y * gw + x] = 0;
    }
  }

  const small = document.createElement("canvas");
  small.width = gw;
  small.height = gh;
  const sctx = small.getContext("2d")!;
  const img = sctx.createImageData(gw, gh);
  for (let i = 0; i < gw * gh; i++) {
    const v = filled[i] ? 255 : 0;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = v;
  }
  sctx.putImageData(img, 0, 0);
  // Back to the cutout's size, smoothly, so the glass edge isn't blocky.
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(small, 0, 0, w, h);
  return out;
}

/**
 * Fill in a mirror frame's missing side from its other side, in place.
 *
 * Frames are almost always left-right symmetric (rectangles, arches, ovals,
 * waves), and the part a cutout loses is usually one stretch — white frame
 * against a white window, or hidden behind a plant. Where one side of the
 * frame is solid and its reflection across the frame's centre line is empty,
 * copy it across. Pixels the photo did show are never replaced.
 */
export function completeSymmetric(canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  let x0 = w;
  let x1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 140) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
      }
    }
  }
  if (x1 <= x0) return;
  const axis = x0 + x1;
  const src = new Uint8ClampedArray(d);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (src[i + 3] > 140) continue;
      const mx = axis - x;
      if (mx < 0 || mx >= w) continue;
      const j = (y * w + mx) * 4;
      if (src[j + 3] <= 140) continue;
      d[i] = src[j];
      d[i + 1] = src[j + 1];
      d[i + 2] = src[j + 2];
      d[i + 3] = src[j + 3];
    }
  }
  ctx.putImageData(image, 0, 0);
}
