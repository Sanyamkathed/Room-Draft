import { loadOrt, type OrtSession } from "./segment";
import { loadImage } from "@/lib/utils/image";

/**
 * How far each part of an object is from the camera, from a single photo.
 *
 * A cutout only gives an outline, and puffing an outline up makes everything
 * a cushion. Depth Anything V2 (Small, Apache-2.0) reads the photo itself —
 * the seat of a sofa sits back, its arms come forward, a figure's face bulges
 * and its legs tuck under — and that relief is what the 3D shape is built
 * from (see lib/three/inflate.ts).
 *
 * Runs on the device on the same WebAssembly runtime as the cutout model, so
 * it works the same on a phone and a PC, costs nothing and uploads nothing.
 * The weights (int8, ~27 MB) come from Hugging Face, pinned to one commit and
 * checked against their SHA-256 before use; a changed file is refused.
 *
 * Licence: only the SMALL model is Apache-2.0. Depth Anything V2 Base and
 * Large are CC-BY-NC-4.0 (non-commercial) — don't swap them in.
 */

const COMMIT = "4472b7362082ad9968fee890ca0f1e5aca36b93d";
const MODEL_URL = `https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${COMMIT}/onnx/model_quantized.onnx`;
const MODEL_SHA256 = "fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d";
const CACHE = "aura-models-v1";
/** Longest side fed to the model; must be a multiple of its 14px patch. */
const LONG = 448;
/** Longest side of the depth map that is kept with the item. */
const KEEP = 256;

let sessionPromise: Promise<OrtSession> | null = null;

async function modelBytes(): Promise<Uint8Array> {
  let buf: ArrayBuffer | null = null;
  // Cache Storage keeps it across visits (secure origins only).
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => null) : null;
  const hit = cache ? await cache.match(MODEL_URL).catch(() => undefined) : undefined;
  if (hit) buf = await hit.arrayBuffer();
  if (!buf) {
    const res = await fetch(MODEL_URL, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error("Couldn't download the 3D model.");
    buf = await res.arrayBuffer();
    if ((await sha256(buf)) !== MODEL_SHA256) throw new Error("The 3D model download didn't match.");
    await cache?.put(MODEL_URL, new Response(buf.slice(0))).catch(() => undefined);
  }
  return new Uint8Array(buf);
}

function getSession(): Promise<OrtSession> {
  if (!sessionPromise) {
    sessionPromise = Promise.all([loadOrt(), modelBytes()])
      .then(([ort, bytes]) =>
        ort.InferenceSession.create(bytes, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }),
      )
      .catch((e) => {
        sessionPromise = null;
        throw e;
      });
  }
  return sessionPromise;
}

/**
 * Depth for a background-removed cutout, as a grayscale PNG the same shape
 * as the cutout: white = nearest, black = furthest, transparent = not the
 * object. Null when the model can't run here.
 */
export async function estimateDepth(cutoutUrl: string): Promise<string | null> {
  try {
    const [ort, session, img] = await Promise.all([loadOrt(), getSession(), loadImage(cutoutUrl)]);
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    const s = LONG / Math.max(iw, ih);
    const w = Math.max(14, Math.round((iw * s) / 14) * 14);
    const h = Math.max(14, Math.round((ih * s) / 14) * 14);

    // The object on a plain mid-grey backdrop: no room for the model to
    // mistake for part of it.
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const px = ctx.getImageData(0, 0, w, h).data;
    const mask = document.createElement("canvas");
    mask.width = w;
    mask.height = h;
    const mctx = mask.getContext("2d", { willReadFrequently: true })!;
    mctx.drawImage(img, 0, 0, w, h);
    const alpha = mctx.getImageData(0, 0, w, h).data;

    const mean = [0.485, 0.456, 0.406];
    const std = [0.229, 0.224, 0.225];
    const plane = w * h;
    const input = new Float32Array(3 * plane);
    for (let i = 0; i < plane; i++) {
      for (let ch = 0; ch < 3; ch++) input[ch * plane + i] = (px[i * 4 + ch] / 255 - mean[ch]) / std[ch];
    }
    const out = await session.run({ [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, h, w]) });
    const pred = out[session.outputNames[0]];
    const [ph, pw] = pred.dims.slice(-2) as number[];
    const d = pred.data;

    // Normalise over the object only, ignoring the extreme 2% each end so
    // one stray pixel can't flatten the rest.
    const vals: number[] = [];
    const at = (x: number, y: number) => d[Math.min(ph - 1, Math.floor((y / h) * ph)) * pw + Math.min(pw - 1, Math.floor((x / w) * pw))];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) if (alpha[(y * w + x) * 4 + 3] > 128) vals.push(at(x, y));
    }
    if (vals.length < 50) return null;
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.02)];
    const hi = vals[Math.floor(vals.length * 0.98)];
    const span = Math.max(1e-6, hi - lo);

    const k = Math.min(1, KEEP / Math.max(w, h));
    const ow = Math.max(1, Math.round(w * k));
    const oh = Math.max(1, Math.round(h * k));
    const outC = document.createElement("canvas");
    outC.width = ow;
    outC.height = oh;
    const octx = outC.getContext("2d")!;
    const o = octx.createImageData(ow, oh);
    for (let y = 0; y < oh; y++) {
      for (let x = 0; x < ow; x++) {
        const sx = Math.min(w - 1, Math.floor(x / k));
        const sy = Math.min(h - 1, Math.floor(y / k));
        const v = Math.round(Math.min(1, Math.max(0, (at(sx, sy) - lo) / span)) * 255);
        const i = (y * ow + x) * 4;
        o.data[i] = o.data[i + 1] = o.data[i + 2] = v;
        o.data[i + 3] = alpha[(sy * w + sx) * 4 + 3];
      }
    }
    octx.putImageData(o, 0, 0);
    return outC.toDataURL("image/png");
  } catch (e) {
    // The flat-relief shape still works; say why in the console.
    console.warn("Depth estimate unavailable:", e);
    return null;
  }
}

/** SHA-256 hex. Web Crypto where it exists; plain JS on insecure origins (LAN testing). */
async function sha256(buf: ArrayBuffer): Promise<string> {
  const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  if (globalThis.crypto?.subtle) return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)));
  return hex(sha256js(new Uint8Array(buf)));
}

function sha256js(data: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
    0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
    0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
    0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ]);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const len = data.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const msg = new Uint8Array(total);
  msg.set(data);
  msg[len] = 0x80;
  const bits = len * 8;
  const view = new DataView(msg.buffer);
  view.setUint32(total - 8, Math.floor(bits / 0x100000000));
  view.setUint32(total - 4, bits >>> 0);
  const W = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a;
    H[1] += b;
    H[2] += c;
    H[3] += d;
    H[4] += e;
    H[5] += f;
    H[6] += g;
    H[7] += h;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}
