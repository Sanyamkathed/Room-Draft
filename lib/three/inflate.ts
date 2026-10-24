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
  const k = `${key}|${opts.width.toFixed(3)}|${opts.height.toFixed(3)}|${opts.depth.toFixed(3)}|${opts.flatBack}`;
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
  const N = opts.resolution ?? 128;
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

  // Chamfer distance to the outside (3-4 metric, two passes).
  const INF = 1e9;
  const dist = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) dist[i] = inside[i] ? INF : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : dist[y * W + x]);
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
  const span = Math.max(1, maxD - 3);
  for (let i = 0; i < W * H; i++) {
    if (!inside[i]) continue;
    const t = Math.min(1, Math.max(0, (dist[i] - 3) / span));
    const round = Math.sqrt(t * (2 - t));
    const relief = (lum[i] - lumMean) * 0.12 * t;
    height[i] = Math.max(RIM, RIM + (1 - RIM) * round + relief);
  }

  // Vertices at cell centres for every inside cell; a quad becomes two
  // triangles when all four of its corners are inside.
  const index = new Int32Array(W * H).fill(-1);
  const pos: number[] = [];
  const uv: number[] = [];
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
      uv.push(u, 1 - v);
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
    const z = pos[k * 3 + 2];
    pos.push(pos[k * 3], pos[k * 3 + 1], opts.flatBack ? 0 : -z);
    uv.push(uv[k * 2], uv[k * 2 + 1]);
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

  const s = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
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
  for (let i = 0; i < W * H; i++) d[i * 4 + 3] = 255;
  ctx.putImageData(img, 0, 0);
  bled.set(key, canvas);
  return canvas;
}
