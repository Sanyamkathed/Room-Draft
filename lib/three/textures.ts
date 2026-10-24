"use client";

import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from "three";
import type { Product } from "@/lib/catalog/types";

/**
 * Procedural artwork for flat products.
 *
 * A poster rendered as a solid colour reads as a rectangle, not as a poster —
 * the brief is explicit that items must not look like flat stickers. Rather
 * than ship (and licence) dozens of images, each print composes a small canvas
 * from its own palette and tags, deterministically seeded by product id so the
 * same poster looks the same every session.
 */

const cache = new Map<string, Texture>();

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG so art is stable across reloads and SSR/client. */
function mulberry(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(canvas: HTMLCanvasElement, key: string): Texture {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Poster / print artwork                                              */
/* ------------------------------------------------------------------ */

type ArtStyle = "gradient" | "lineart" | "grid" | "blocks" | "orbit" | "halftone";

function styleFor(product: Product): ArtStyle {
  const t = product.tags.join(" ");
  if (t.includes("line art") || t.includes("minimal")) return "lineart";
  if (t.includes("cyberpunk") || t.includes("city")) return "grid";
  if (t.includes("album") || t.includes("music")) return "blocks";
  if (t.includes("monochrome") || t.includes("manga")) return "halftone";
  if (t.includes("anime") || t.includes("landscape")) return "gradient";
  return "orbit";
}

export function artworkTexture(product: Product): Texture {
  const key = `art:${product.id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const aspect = product.dims.w / product.dims.h;
  const W = 512;
  const H = Math.max(128, Math.round(W / aspect));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  const rnd = mulberry(hashString(product.id));
  const [c0, c1 = c0, c2 = c1] = product.palette;
  const style = styleFor(product);

  // Paper base
  ctx.fillStyle = c2 ?? "#141416";
  ctx.fillRect(0, 0, W, H);

  switch (style) {
    case "gradient": {
      const g = ctx.createLinearGradient(0, H, W, 0);
      g.addColorStop(0, c0);
      g.addColorStop(0.55, c1);
      g.addColorStop(1, c2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      // A low sun and a horizon: enough to read as a landscape at poster scale.
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(W * (0.3 + rnd() * 0.4), H * 0.42, W * 0.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#000000";
      ctx.fillRect(0, H * 0.72, W, H * 0.28);
      ctx.globalAlpha = 1;
      break;
    }

    case "lineart": {
      ctx.fillStyle = c0;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = c1;
      ctx.lineWidth = Math.max(2, W * 0.006);
      ctx.lineCap = "round";
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        const x0 = W * (0.22 + rnd() * 0.15);
        ctx.moveTo(x0, H * 0.78);
        ctx.bezierCurveTo(
          W * (0.1 + rnd() * 0.3),
          H * (0.3 + rnd() * 0.3),
          W * (0.6 + rnd() * 0.3),
          H * (0.2 + rnd() * 0.35),
          W * (0.62 + rnd() * 0.2),
          H * 0.24,
        );
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.32, W * 0.13, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "grid": {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, c2);
      g.addColorStop(0.62, "#16081f");
      g.addColorStop(1, "#05050c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // Sun disc with scanline cutouts
      const sunY = H * 0.42;
      const sunR = W * 0.2;
      const sg = ctx.createLinearGradient(0, sunY - sunR, 0, sunY + sunR);
      sg.addColorStop(0, c0);
      sg.addColorStop(1, c1);
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(W / 2, sunY, sunR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#05050c";
      for (let i = 0; i < 6; i++) {
        ctx.fillRect(0, sunY + sunR * (i / 7) + i * 2, W, Math.max(2, H * 0.008));
      }

      // Perspective floor grid
      ctx.strokeStyle = c1;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = Math.max(1, W * 0.003);
      const horizon = H * 0.66;
      for (let i = -8; i <= 8; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * W * 0.06, horizon);
        ctx.lineTo(W / 2 + i * W * 0.6, H);
        ctx.stroke();
      }
      for (let i = 1; i < 9; i++) {
        const y = horizon + Math.pow(i / 9, 2.2) * (H - horizon);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }

    case "blocks": {
      ctx.fillStyle = c0;
      ctx.fillRect(0, 0, W, H);
      const cols = 3;
      const rows = 3;
      const colours = [c0, c1, c2, "#0d0d10", "#f2ede4"];
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if (rnd() < 0.35) continue;
          ctx.fillStyle = colours[Math.floor(rnd() * colours.length)];
          const pad = W * 0.02;
          ctx.fillRect(
            (x * W) / cols + pad,
            (y * H) / rows + pad,
            W / cols - pad * 2,
            H / rows - pad * 2,
          );
        }
      }
      ctx.fillStyle = "#f2ede4";
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.5, Math.min(W, H) * 0.11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0d0d10";
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.5, Math.min(W, H) * 0.025, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case "halftone": {
      ctx.fillStyle = c0;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = c1;
      const step = W * 0.035;
      for (let y = step; y < H; y += step) {
        for (let x = step; x < W; x += step) {
          // Dot size falls off from a light source — reads as shaded ink.
          const d = Math.hypot(x - W * 0.35, y - H * 0.3) / Math.hypot(W, H);
          const r = Math.max(0, step * 0.46 * (d * 1.9));
          if (r < 0.4) continue;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = c1;
      ctx.fillRect(W * 0.08, H * 0.08, W * 0.84, Math.max(2, H * 0.006));
      ctx.fillRect(W * 0.08, H * 0.9, W * 0.4, Math.max(2, H * 0.006));
      break;
    }

    case "orbit":
    default: {
      const g = ctx.createRadialGradient(
        W * 0.5,
        H * 0.45,
        0,
        W * 0.5,
        H * 0.45,
        Math.max(W, H) * 0.7,
      );
      g.addColorStop(0, c1);
      g.addColorStop(1, c2 ?? c0);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = c0;
      ctx.lineWidth = Math.max(1.5, W * 0.004);
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.ellipse(
          W * 0.5,
          H * 0.45,
          W * (0.12 + i * 0.08),
          H * (0.06 + i * 0.05),
          rnd() * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.stroke();
      }
      ctx.fillStyle = c0;
      ctx.beginPath();
      ctx.arc(W * 0.5, H * 0.45, W * 0.045, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }

  // Subtle paper grain over everything — kills the "vector export" flatness.
  const grain = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (rnd() - 0.5) * 12;
    grain.data[i] += n;
    grain.data[i + 1] += n;
    grain.data[i + 2] += n;
  }
  ctx.putImageData(grain, 0, 0);

  return finish(canvas, key);
}

/* ------------------------------------------------------------------ */
/* Fabric / rug weave                                                  */
/* ------------------------------------------------------------------ */

export function weaveTexture(colour: string, accent: string, key: string): Texture {
  const cached = cache.get(`weave:${key}`);
  if (cached) return cached;

  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const rnd = mulberry(hashString(key));

  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 1;
  for (let i = 0; i < S; i += 3) {
    ctx.beginPath();
    ctx.moveTo(i + rnd() * 1.5, 0);
    ctx.lineTo(i + rnd() * 1.5, S);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + rnd() * 1.5);
    ctx.lineTo(S, i + rnd() * 1.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(6, 6);
  tex.needsUpdate = true;
  cache.set(`weave:${key}`, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* Photo grid (collages, polaroid walls)                               */
/* ------------------------------------------------------------------ */

export function photoGridTexture(product: Product): Texture {
  const key = `grid:${product.id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const aspect = product.dims.w / product.dims.h;
  const W = 512;
  const H = Math.round(W / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rnd = mulberry(hashString(product.id));

  ctx.clearRect(0, 0, W, H);

  const cols = 5;
  const rows = Math.max(2, Math.round((cols / aspect) * 1.05));
  const cw = W / cols;
  const ch = H / rows;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (rnd() < 0.12) continue;
      const pad = cw * 0.09;
      const px = x * cw + pad;
      const py = y * ch + pad;
      const pw = cw - pad * 2;
      const ph = ch - pad * 2;

      ctx.save();
      // Slight per-print rotation is what makes a collage read as taped-up
      // photos rather than a printed grid.
      ctx.translate(px + pw / 2, py + ph / 2);
      ctx.rotate((rnd() - 0.5) * 0.13);

      ctx.fillStyle = "#f4f1ea";
      ctx.fillRect(-pw / 2, -ph / 2, pw, ph);

      const g = ctx.createLinearGradient(-pw / 2, -ph / 2, pw / 2, ph / 2);
      const c = product.palette[Math.floor(rnd() * product.palette.length)];
      g.addColorStop(0, c);
      g.addColorStop(1, "#2a2724");
      ctx.fillStyle = g;
      const inset = pw * 0.08;
      ctx.fillRect(
        -pw / 2 + inset,
        -ph / 2 + inset,
        pw - inset * 2,
        ph - inset * 2 - ph * 0.12,
      );
      ctx.restore();
    }
  }

  return finish(canvas, key);
}

export function disposeTextureCache(): void {
  for (const tex of cache.values()) tex.dispose();
  cache.clear();
}

/* ------------------------------------------------------------------ */
/* Light and shadow                                                    */
/* ------------------------------------------------------------------ */

/**
 * A soft radial falloff, white in the centre fading to transparent.
 *
 * Used additively on a plane just off the wall behind a neon sign. Real neon
 * throws a halo onto whatever it is mounted on, and that spill — not the tube
 * itself — is what makes a sign read as *installed on a wall* rather than
 * floating in front of one. A backplate cannot do this job: it occludes the
 * wall instead of lighting it.
 */
export function glowTexture(falloff = 2.2): Texture {
  const key = `glow:${falloff}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const S = 256;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  const image = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - S / 2) / (S / 2);
      const dy = (y - S / 2) / (S / 2);
      const d = Math.min(1, Math.hypot(dx, dy));
      // A plain linear ramp reads as a hard-edged disc; the power curve keeps
      // the centre hot and lets the edge disappear completely.
      const a = Math.pow(1 - d, falloff);
      const i = (y * S + x) * 4;
      image.data[i] = 255;
      image.data[i + 1] = 255;
      image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * Lunar surface for the moon lamp: pale maria, ringed craters, fine grain.
 *
 * A moon lamp is a 3D-printed relief, and the relief is the whole product —
 * a smooth glowing ball reads as a generic globe light. Used as both colour
 * and bump map, so the craters catch the room's light as well as glowing.
 */
export function moonTexture(): Texture {
  const key = "moon";
  const hit = cache.get(key);
  if (hit) return hit;

  const W = 512;
  const H = 256;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rnd = mulberry(0x6d6f6f6e);

  ctx.fillStyle = "#d9d2c2";
  ctx.fillRect(0, 0, W, H);

  // Maria: broad, soft, darker patches.
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W;
    const y = H * (0.2 + rnd() * 0.6);
    const r = 30 + rnd() * 60;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(120,112,100,0.55)");
    g.addColorStop(1, "rgba(120,112,100,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // Craters: dark floor, bright rim on one side.
  for (let i = 0; i < 140; i++) {
    const x = rnd() * W;
    const y = rnd() * H;
    const r = 1.5 + Math.pow(rnd(), 3) * 16;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(95,88,78,${0.25 + rnd() * 0.3})`;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - r * 0.15, y - r * 0.15, r, Math.PI * 0.9, Math.PI * 1.9);
    ctx.strokeStyle = `rgba(250,246,236,${0.35 + rnd() * 0.3})`;
    ctx.lineWidth = Math.max(0.8, r * 0.22);
    ctx.stroke();
  }

  // Grain, so close-ups don't look airbrushed.
  const img = ctx.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * The soft dark patch an object casts where it meets its surface.
 *
 * Directional shadows are deliberately faint over a photo-textured room (the
 * photo already contains its own lighting), which leaves placed objects
 * looking like they hover. This is the cheap, reliable cue that they are
 * actually resting on something — an ellipse tight under the footprint, darkest
 * at the contact point.
 */
export function contactShadowTexture(): Texture {
  const key = "contact-shadow";
  const hit = cache.get(key);
  if (hit) return hit;

  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(0,0,0,0.55)");
  g.addColorStop(0.45, "rgba(0,0,0,0.28)");
  g.addColorStop(0.75, "rgba(0,0,0,0.08)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/**
 * The pattern a projector lamp throws.
 *
 * Fed to a SpotLight as its `map`, so the shape lands on whatever geometry is
 * actually in front of it — the wall, the ceiling, the wardrobe. That is the
 * whole point of a sunset lamp, and a lamp that glows without projecting
 * anything is the one piece of decor where a fake reads instantly as fake.
 */
export function projectionTexture(kind: "sunset" | "galaxy" | "wash"): Texture {
  const key = `projection:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const S = 512;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const rnd = mulberry(hashString(kind));

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, S, S);

  if (kind === "sunset") {
    // Concentric bands, brightest in the middle — the halo a sunset lamp makes.
    for (let i = 14; i >= 0; i--) {
      const r = (i / 14) * S * 0.48;
      const t = 1 - i / 14;
      const g = ctx.createRadialGradient(S / 2, S / 2, r * 0.7, S / 2, S / 2, r);
      g.addColorStop(0, `rgba(255,255,255,${0.06 + t * 0.5})`);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, r, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === "galaxy") {
    // Nebula wash plus pinpoint stars.
    for (let i = 0; i < 4; i++) {
      const g = ctx.createRadialGradient(
        S * (0.3 + rnd() * 0.4),
        S * (0.3 + rnd() * 0.4),
        0,
        S / 2,
        S / 2,
        S * (0.25 + rnd() * 0.3),
      );
      g.addColorStop(0, "rgba(255,255,255,0.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, S, S);
    }
    ctx.fillStyle = "#fff";
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = rnd() < 0.9 ? 1 : 2;
      ctx.globalAlpha = 0.35 + rnd() * 0.65;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else {
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Checkerboard — the Gen-Z pattern of record, on rugs and mats. */
export function checkerTexture(a: string, b: string, squares = 8): Texture {
  const key = `checker:${a}:${b}:${squares}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const S = 256;
  const cell = S / squares;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;

  for (let y = 0; y < squares; y++) {
    for (let x = 0; x < squares; x++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? a : b;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Wrapper artwork for a drinks can — the bands read at shelf distance. */
export function canLabelTexture(base: string, accent: string, id: string): Texture {
  const key = `can:${id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const W = 256;
  const H = 128;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rnd = mulberry(hashString(id));

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);

  // A swept band plus a wordmark blob: unbranded, but unmistakably a can.
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.moveTo(0, H * 0.42);
  ctx.bezierCurveTo(W * 0.3, H * 0.22, W * 0.7, H * 0.62, W, H * 0.36);
  ctx.lineTo(W, H * 0.62);
  ctx.bezierCurveTo(W * 0.7, H * 0.86, W * 0.3, H * 0.46, 0, H * 0.66);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "rgba(255,255,255,0.92)";
  for (let i = 0; i < 5; i++) {
    const w = 10 + rnd() * 22;
    ctx.fillRect(W * 0.16 + i * 26, H * 0.46, w, 7);
  }

  // Aluminium sheen
  const sheen = ctx.createLinearGradient(0, 0, W, 0);
  sheen.addColorStop(0, "rgba(255,255,255,0.22)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0)");
  sheen.addColorStop(0.6, "rgba(0,0,0,0.18)");
  sheen.addColorStop(1, "rgba(255,255,255,0.14)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, W, H);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
