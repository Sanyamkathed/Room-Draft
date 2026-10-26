import { BufferAttribute, BufferGeometry } from "three";

/**
 * A solid 3D shape from a cutout photo's silhouette — "inflation".
 *
 * One photo never sees the back or sides of an object, so true reconstruction
 * needs a learned model (paid API or a GPU). What a single cutout DOES give
 * exactly is the outline. Puffing that outline into a rounded solid — thick in
 * the middle, closing to a sharp edge at the silhouette — is the classic
 * single-view trick (Igarashi's Teddy; Photoshop's "inflate"): a neon tube
 * becomes a round tube, a plant's leaves get body, a figure gets a belly. The
 * photo is wrapped over the front; the back carries its mirror image.
 *
 * Built in the browser in a few milliseconds, at the item's real size: the
 * width and height are the cutout's, the thickest point is the item's depth.
 */

export interface InflateOptions {
  /** Real size in metres. */
  width: number;
  height: number;
  depth: number;
  /** Wall pieces sit flat against the wall: no back bulge. */
  flatBack: boolean;
  /**
   * Standing things rest on a flat base. Without this the bottom of the
   * silhouette closes to a sharp edge like every other side, so a sofa
   * balances on a knife-edge and reads as a cushion, not furniture.
   */
  grounded?: boolean;
  /** Cross-section: 2 is round (a figure, a plant); higher is boxier (furniture). */
  squareness?: number;
  /**
   * Fill the gap under a bottom edge that curves up away from the floor.
   * A sofa photographed from above has an arched bottom outline — that is
   * perspective, not a sofa standing on one point. Gaps that start with a
   * sudden step (between a chair's legs) stay open.
   */
  fillBase?: boolean;
  /**
   * A depth map of the photo (white = near), from lib/catalog/depth.ts. With
   * it the front takes the object's real relief — a sofa's seat sits back
   * from its arms — instead of a uniform cushion.
   */
  depthMap?: HTMLImageElement | null;
  /** Sampling resolution along the longer side. */
  resolution?: number;
}

/** Load once and reuse: geometry per image + size + mode. */
const cache = new Map<string, BufferGeometry>();

export function inflatedGeometry(
  key: string,
  image: HTMLImageElement,
  opts: InflateOptions,
): BufferGeometry {
  const k = `${key}|${opts.width.toFixed(3)}|${opts.height.toFixed(3)}|${opts.depth.toFixed(3)}|${opts.flatBack}|${opts.grounded ?? false}|${opts.squareness ?? 2}|${opts.fillBase ?? false}|${opts.depthMap ? 1 : 0}`;
  const hit = cache.get(k);
  if (hit) return hit;
  const geo = buildInflated(image, opts);
  if (cache.size > 40) {
    const first = cache.keys().next().value;
    if (first) {
      cache.get(first)?.dispose();
      cache.delete(first);
    }
  }
  cache.set(k, geo);
  return geo;
}

function buildInflated(image: HTMLImageElement, opts: InflateOptions): BufferGeometry {
  const N = opts.resolution ?? 160;
  const aspect = image.naturalWidth / Math.max(1, image.naturalHeight);
  const gw = Math.max(8, Math.round(aspect >= 1 ? N : N * aspect));
  const gh = Math.max(8, Math.round(aspect >= 1 ? N / aspect : N));

  // Sample alpha and brightness on a small grid, with a one-cell empty border
  // so the silhouette always closes inside the grid.
  const W = gw + 2;
  const H = gh + 2;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(image, 1, 1, gw, gh);
  const px = ctx.getImageData(0, 0, W, H).data;

  const inside = new Uint8Array(W * H);
  const lum = new Float32Array(W * H);
  let lumSum = 0;
  let count = 0;
  for (let i = 0; i < W * H; i++) {
    if (px[i * 4 + 3] > 110) {
      inside[i] = 1;
      lum[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
      lumSum += lum[i];
      count++;
    }
  }
  const lumMean = count ? lumSum / count : 0.5;

  // Depth, sampled on the same grid as the silhouette.
  const dep = opts.depthMap ? new Float32Array(W * H) : null;
  if (dep && opts.depthMap) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(opts.depthMap, 1, 1, gw, gh);
    const dp = ctx.getImageData(0, 0, W, H).data;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < W * H; i++) {
      if (inside[i] && dp[i * 4 + 3] > 0) {
        dep[i] = dp[i * 4] / 255;
        sum += dep[i];
        n++;
      } else dep[i] = -1;
    }
    const mean = n ? sum / n : 0.5;
    for (let i = 0; i < W * H; i++) if (dep[i] < 0) dep[i] = mean;
  }

  // Grounded: the columns that reach the bottom of the silhouette stand on
  // the floor, so the floor below them doesn't count as "outside".
  let lowest = -1;
  for (let i = 0; i < W * H; i++) if (inside[i]) lowest = Math.max(lowest, (i / W) | 0);

  // Base fill: each filled cell borrows the photo row it continues from.
  const srcRow = new Int32Array(W * H).fill(-1);
  if (opts.grounded && opts.fillBase && lowest > 0) {
    const bottom = new Int32Array(W).fill(-1);
    for (let x = 0; x < W; x++) {
      for (let y = lowest; y >= 0; y--) {
        if (inside[y * W + x]) {
          bottom[x] = y;
          break;
        }
      }
    }
    const band = Math.max(2, Math.round(gh * 0.06));
    const maxGap = gh * 0.35;
    const accepted = new Uint8Array(W);
    const queue: number[] = [];
    for (let x = 0; x < W; x++) {
      if (bottom[x] >= 0 && bottom[x] >= lowest - band) {
        accepted[x] = 1;
        queue.push(x);
      }
    }
    // Walk outward from where it touches the floor while the outline
    // rises gently; a jump of more than a couple of cells is a real gap.
    while (queue.length) {
      const x = queue.pop()!;
      for (const nx of [x - 1, x + 1]) {
        if (nx < 0 || nx >= W || accepted[nx] || bottom[nx] < 0) continue;
        if (Math.abs(bottom[nx] - bottom[x]) > 2 || lowest - bottom[nx] > maxGap) continue;
        accepted[nx] = 1;
        queue.push(nx);
      }
    }
    for (let x = 0; x < W; x++) {
      if (!accepted[x]) continue;
      const from = bottom[x];
      for (let y = from + 1; y <= lowest; y++) {
        const i = y * W + x;
        inside[i] = 1;
        srcRow[i] = from;
        lum[i] = lum[from * W + x];
        if (dep) dep[i] = dep[from * W + x];
      }
    }
  }

  const base = new Uint8Array(W);
  if (opts.grounded && lowest > 0) {
    const band = Math.max(2, Math.round(gh * 0.06));
    for (let x = 0; x < W; x++) {
      for (let y = lowest; y > lowest - band; y--) {
        if (inside[y * W + x]) {
          base[x] = 1;
          break;
        }
      }
    }
  }
  const ground = (x: number, y: number) => y > lowest - 1 && x >= 0 && x < W && base[x] === 1;

  // Chamfer distance to the outside (3-4 metric, two passes).
  const INF = 1e9;
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = inside[i] ? INF : 0;
  const at = (x: number, y: number) =>
    ground(x, y) && (y >= H || !inside[y * W + x])
      ? INF
      : x < 0 || y < 0 || x >= W || y >= H
        ? 0
        : dist[y * W + x];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!inside[i]) continue;
      dist[i] = Math.min(dist[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  let maxD = 0;
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!inside[i]) continue;
      dist[i] = Math.min(dist[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
      if (dist[i] > maxD) maxD = dist[i];
    }
  }

  // Height profile: a circular cross-section (sqrt(t(2-t))) reads as a solid
  // rounded body; boundary cells are pinned to zero so front and back meet in
  // a clean edge. A little brightness relief adds surface detail — darker
  // folds sink, highlights rise — without inventing geometry.
  // The rim keeps a little thickness (RIM) and a side wall joins front to
  // back — a knife-thin edge lights as a zig-zag when seen side-on.
  const RIM = 0.22;
  const height = new Float32Array(W * H);
  // The unseen back is a smooth rounded shell; only the front has relief.
  const backHeight = new Float32Array(W * H);
  const span = Math.max(1, maxD - 3);
  for (let i = 0; i < W * H; i++) {
    if (!inside[i]) continue;
    const t = Math.min(1, Math.max(0, (dist[i] - 3) / span));
    // Superellipse quarter: p=2 is a circle, larger p squares the shoulders.
    const p = opts.squareness ?? 2;
    const round = Math.pow(1 - Math.pow(1 - t, p), 1 / p);
    backHeight[i] = RIM + (1 - RIM) * round;
    if (dep) {
      // Mostly the measured relief, eased in from the rim so front and
      // back still close cleanly at the outline.
      const shape = 0.35 * round + 0.65 * dep[i] * Math.min(1, t * 3);
      height[i] = RIM + (1 - RIM) * shape;
    } else {
      const relief = (lum[i] - lumMean) * 0.12 * t;
      height[i] = Math.max(RIM, RIM + (1 - RIM) * round + relief);
      backHeight[i] = height[i];
    }
  }

  // Vertices at cell centres for every inside cell; a quad becomes two
  // triangles when all four of its corners are inside.
  const index = new Int32Array(W * H).fill(-1);
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const backZ: number[] = [];
  const zFront = opts.flatBack ? opts.depth : opts.depth / 2;
  let n = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!inside[i]) continue;
      index[i] = n++;
      const u = (x - 1 + 0.5) / gw;
      const v = (y - 1 + 0.5) / gh;
      pos.push((u - 0.5) * opts.width, (0.5 - v) * opts.height, height[i] * zFront);
      backZ.push(backHeight[i] * zFront);
      // A filled base cell repeats the photo's bottom edge, shaded darker —
      // the underside of a sofa is in its own shadow.
      const filled = srcRow[i] >= 0;
      uv.push(u, 1 - v);
      const shade = filled ? 0.62 : 1;
      col.push(shade, shade, shade);
    }
  }
  const front = n;

  // The silhouette comes off a pixel grid, so its outline is stair-stepped.
  // Relax the outer band of vertices toward their neighbours a few times;
  // UVs stay put, so the photo still lines up.
  for (let iter = 0; iter < 3; iter++) {
    const next = pos.slice();
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        const v = index[i];
        if (v < 0 || height[i] > 0.55) continue;
        let sx = 0;
        let sy = 0;
        let c = 0;
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          const u = index[j];
          if (u < 0) continue;
          sx += pos[u * 3];
          sy += pos[u * 3 + 1];
          c++;
        }
        if (c >= 2 && c < 4) {
          next[v * 3] = pos[v * 3] * 0.5 + (sx / c) * 0.5;
          next[v * 3 + 1] = pos[v * 3 + 1] * 0.5 + (sy / c) * 0.5;
        }
      }
    }
    for (let k = 0; k < next.length; k++) pos[k] = next[k];
  }
  // Back surface: mirrored bulge, or flat against the wall.
  for (let k = 0; k < front; k++) {
    pos.push(pos[k * 3], pos[k * 3 + 1], opts.flatBack ? 0 : -backZ[k]);
    uv.push(uv[k * 2], uv[k * 2 + 1]);
    col.push(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]);
  }

  const tris: number[] = [];
  const frontTris: number[] = [];
  for (let y = 0; y < H - 1; y++) {
    for (let x = 0; x < W - 1; x++) {
      const a = index[y * W + x];
      const b = index[y * W + x + 1];
      const c = index[(y + 1) * W + x];
      const d = index[(y + 1) * W + x + 1];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      // Front faces +z (counter-clockwise seen from the front)…
      frontTris.push(a, c, b, b, c, d);
      // …and the back faces -z, so it winds the other way.
      tris.push(a + front, b + front, c + front, b + front, d + front, c + front);
    }
  }

  // Side wall: every front edge used by only one triangle is on the outline;
  // join it to the matching back edge with a quad facing outward.
  const edgeUse = new Map<number, number>();
  const key = (p: number, q: number) => (p < q ? p * 1_000_003 + q : q * 1_000_003 + p);
  for (let t = 0; t < frontTris.length; t += 3) {
    const [i0, i1, i2] = [frontTris[t], frontTris[t + 1], frontTris[t + 2]];
    for (const k of [key(i0, i1), key(i1, i2), key(i2, i0)]) edgeUse.set(k, (edgeUse.get(k) ?? 0) + 1);
  }
  for (let t = 0; t < frontTris.length; t += 3) {
    const tri = [frontTris[t], frontTris[t + 1], frontTris[t + 2]];
    for (let e = 0; e < 3; e++) {
      const u = tri[e];
      const v = tri[(e + 1) % 3];
      if (edgeUse.get(key(u, v)) !== 1) continue;
      tris.push(u, u + front, v, v, u + front, v + front);
    }
  }
  for (const i of frontTris) tris.push(i);

  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute("uv", new BufferAttribute(new Float32Array(uv), 2));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(col), 3));
  geo.setIndex(tris);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The cutout with its edge colours grown outward and every pixel opaque.
 *
 * The steep rim of an inflated shape samples the outermost pixels of the
 * photo, which in a cutout are half-transparent fringe — drawn as a dark
 * zig-zag seam. Bleeding the object's own colours a few pixels past its
 * outline gives the rim something solid to sample; the mesh, not the alpha
 * channel, now defines the silhouette.
 */
const bled = new Map<string, HTMLCanvasElement>();

export function bledCanvas(key: string, image: HTMLImageElement): HTMLCanvasElement {
  const hit = bled.get(key);
  if (hit) return hit;

  const s = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  const W = Math.max(1, Math.round(image.naturalWidth * s));
  const H = Math.max(1, Math.round(image.naturalHeight * s));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, W, H);
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;

  // Solid = mostly opaque. Each pass, an empty pixel takes the average colour
  // of its solid neighbours and becomes solid itself.
  let solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) solid[i] = d[i * 4 + 3] > 160 ? 1 : 0;
  for (let pass = 0; pass < 10; pass++) {
    const next = solid.slice();
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (solid[i]) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
            const j = yy * W + xx;
            if (!solid[j]) continue;
            r += d[j * 4];
            g += d[j * 4 + 1];
            b += d[j * 4 + 2];
            n++;
          }
        }
        if (n) {
          d[i * 4] = r / n;
          d[i * 4 + 1] = g / n;
          d[i * 4 + 2] = b / n;
          next[i] = 1;
        }
      }
    }
    solid = next;
  }
  // Everything further out gets a smooth blur of the nearest colours
  // (push-pull: average down a pyramid, then fill holes coming back up), so
  // a filled base under a sofa reads as its shaded underside, not stripes.
  for (let i = 0; i < W * H; i++) d[i * 4 + 3] = solid[i] ? 255 : 0;
  ctx.putImageData(img, 0, 0);
  const levels: HTMLCanvasElement[] = [canvas];
  while (levels[levels.length - 1].width > 4 || levels[levels.length - 1].height > 4) {
    const prev = levels[levels.length - 1];
    const c = document.createElement("canvas");
    c.width = Math.max(1, prev.width >> 1);
    c.height = Math.max(1, prev.height >> 1);
    const cx = c.getContext("2d")!;
    cx.imageSmoothingQuality = "high";
    cx.drawImage(prev, 0, 0, c.width, c.height);
    // Re-normalise: a half-covered pixel keeps its colour, at full weight.
    const id = cx.getImageData(0, 0, c.width, c.height);
    for (let i = 3; i < id.data.length; i += 4) if (id.data[i] > 0) id.data[i] = 255;
    cx.putImageData(id, 0, 0);
    levels.push(c);
  }
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  for (let l = levels.length - 1; l >= 0; l--) octx.drawImage(levels[l], 0, 0, W, H);
  bled.set(key, out);
  return out;
}
