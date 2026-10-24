"use client";

import * as React from "react";
import { RoundedBox } from "@react-three/drei";
import {
  BoxGeometry,
  BufferAttribute,
  type BufferGeometry,
  CanvasTexture,
  Color,
  Euler,
  Matrix4,
  Quaternion,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
  type Texture,
} from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { seededRandom } from "./shapes";

/**
 * Surface finishes shared by the furniture and the hard-goods models.
 *
 * What makes a box read as a *piece of furniture* rather than as a box is
 * almost entirely two things: edges that catch the light (nothing real is
 * machined to a perfect 90°) and a surface that is not flat colour. Every
 * model here gets both from the same few helpers, so the catalog looks like
 * one coherent set rather than thirty separately-styled ones.
 */

const cache = new Map<string, Texture>();

/** True for the browns and tans that read as timber. */
export function looksLikeWood(hex: string): boolean {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.h > 0.03 && hsl.h < 0.14 && hsl.s > 0.22 && hsl.l > 0.12 && hsl.l < 0.78;
}

/**
 * Near-white wood grain, multiplied by the material colour.
 *
 * Long wavering streaks plus the occasional darker ring — enough variation
 * for the eye to read "oak" or "walnut" from the tint alone, without a photo.
 */
export function grainTexture(): Texture {
  const hit = cache.get("grain");
  if (hit) return hit;

  const W = 512;
  const H = 128;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const rnd = seededRandom("grain");

  ctx.fillStyle = "#f4f0ea";
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 70; i++) {
    const y0 = rnd() * H;
    const amp = 1 + rnd() * 4;
    const freq = 0.004 + rnd() * 0.01;
    const phase = rnd() * Math.PI * 2;
    const dark = rnd() < 0.18;
    ctx.strokeStyle = dark
      ? `rgba(120,96,70,${0.22 + rnd() * 0.18})`
      : `rgba(150,130,110,${0.08 + rnd() * 0.12})`;
    ctx.lineWidth = dark ? 1.2 + rnd() * 1.6 : 0.6 + rnd();
    ctx.beginPath();
    for (let x = 0; x <= W; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(1.6, 1.6);
  tex.anisotropy = 4;
  cache.set("grain", tex);
  return tex;
}

/** Fine woven noise for upholstery, so fabric doesn't read as plastic. */
export function weaveNoiseTexture(): Texture {
  const hit = cache.get("weave-noise");
  if (hit) return hit;

  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(S, S);
  const rnd = seededRandom("weave");
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 8 : -8;
      const v = 232 + weave + (rnd() - 0.5) * 22;
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.wrapS = RepeatWrapping;
  tex.wrapT = RepeatWrapping;
  tex.repeat.set(6, 6);
  cache.set("weave-noise", tex);
  return tex;
}

export type Finish = "auto" | "wood" | "paint" | "metal" | "fabric" | "plastic";

/** A material for a named finish, tinted with `colour`. */
export function FinishMaterial({
  colour,
  finish = "auto",
  roughness,
}: {
  colour: string;
  finish?: Finish;
  roughness?: number;
}) {
  const kind = finish === "auto" ? (looksLikeWood(colour) ? "wood" : "paint") : finish;
  switch (kind) {
    case "wood":
      return <meshStandardMaterial color={colour} map={grainTexture()} roughness={roughness ?? 0.62} metalness={0} />;
    case "metal":
      return <meshStandardMaterial color={colour} roughness={roughness ?? 0.32} metalness={0.8} />;
    case "fabric":
      return <meshStandardMaterial color={colour} map={weaveNoiseTexture()} roughness={roughness ?? 0.96} metalness={0} />;
    case "plastic":
      return <meshStandardMaterial color={colour} roughness={roughness ?? 0.35} metalness={0} />;
    default:
      return <meshStandardMaterial color={colour} roughness={roughness ?? 0.55} metalness={0.02} />;
  }
}

/**
 * A box with softened edges — the single most effective upgrade over a
 * primitive cube. The radius is clamped so thin panels stay valid.
 */
export function Slab({
  args,
  position,
  rotation,
  colour,
  finish = "auto",
  radius = 0.006,
  roughness,
  castShadow = true,
}: {
  args: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  colour: string;
  finish?: Finish;
  radius?: number;
  roughness?: number;
  castShadow?: boolean;
}) {
  const r = Math.max(0.0005, Math.min(radius, Math.min(...args) * 0.45));
  // Tight edges get one bevel step; at a few millimetres more is invisible and
  // every step multiplies the triangle count. Soft cushions get three.
  const steps = r < 0.012 ? 1 : 3;
  return (
    <RoundedBox
      args={args}
      radius={r}
      smoothness={steps}
      bevelSegments={steps}
      position={position}
      rotation={rotation}
      castShadow={castShadow}
      receiveShadow
    >
      <FinishMaterial colour={colour} finish={finish} roughness={roughness} />
    </RoundedBox>
  );
}

/** Straight metal or wooden leg, optionally tapered. */
export function Leg({
  position,
  height,
  top,
  bottom,
  colour,
  finish = "auto",
  tilt = [0, 0, 0],
}: {
  position: [number, number, number];
  height: number;
  top: number;
  bottom: number;
  colour: string;
  finish?: Finish;
  tilt?: [number, number, number];
}) {
  return (
    <mesh position={position} rotation={tilt} castShadow receiveShadow>
      <cylinderGeometry args={[top, bottom, height, 12]} />
      <FinishMaterial colour={colour} finish={finish} />
    </mesh>
  );
}

/** Brushed-metal bar pull. */
export function BarPull({
  position,
  length,
  vertical = false,
}: {
  position: [number, number, number];
  length: number;
  vertical?: boolean;
}) {
  return (
    <group position={position}>
      <mesh rotation={vertical ? [0, 0, 0] : [0, 0, Math.PI / 2]} position={[0, 0, 0.014]} castShadow>
        <cylinderGeometry args={[0.0055, 0.0055, length, 10]} />
        <meshStandardMaterial color="#b9bcc2" roughness={0.28} metalness={0.9} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh
          key={s}
          position={vertical ? [0, (s * length) / 2.4, 0.007] : [(s * length) / 2.4, 0, 0.007]}
          rotation={[Math.PI / 2, 0, 0]}
        >
          <cylinderGeometry args={[0.004, 0.004, 0.014, 8]} />
          <meshStandardMaterial color="#b9bcc2" roughness={0.28} metalness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/** A drawer front with a shadow gap around it, so drawers read as drawers. */
export function DrawerFront({
  width,
  height,
  y,
  z,
  colour,
  finish = "auto",
}: {
  width: number;
  height: number;
  y: number;
  z: number;
  colour: string;
  finish?: Finish;
}) {
  return (
    <group>
      <Slab args={[width, height, 0.018]} position={[0, y, z + 0.009]} colour={colour} finish={finish} radius={0.004} />
      <BarPull position={[0, y, z + 0.018]} length={Math.min(0.16, width * 0.4)} />
    </group>
  );
}

/** Memoised helper so a model can build its own seeded layout once. */
export function useSeeded(seed: string) {
  return React.useMemo(() => seededRandom(seed), [seed]);
}

export interface BoxPart {
  size: [number, number, number];
  position: [number, number, number];
  rotation?: [number, number, number];
  colour?: string;
}

/**
 * Many small boxes baked into ONE geometry, coloured per box.
 *
 * A shelf of books or a slatted door is dozens of parts that never move
 * independently; drawing each as its own mesh costs a draw call apiece (and
 * again per shadow-casting light). Merged, the whole row is a single call.
 */
export function mergeBoxes(parts: BoxPart[]): BufferGeometry {
  const m = new Matrix4();
  const q = new Quaternion();
  const c = new Color();
  const geos = parts.map((p) => {
    const g = new BoxGeometry(...p.size);
    q.setFromEuler(new Euler(...(p.rotation ?? [0, 0, 0])));
    m.compose(new Vector3(...p.position), q, new Vector3(1, 1, 1));
    g.applyMatrix4(m);
    c.set(p.colour ?? "#ffffff");
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute("color", new BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false) ?? new BoxGeometry(0, 0, 0);
  geos.forEach((g) => g.dispose());
  return merged;
}

/** A merged-box geometry as one mesh, disposed when it changes or unmounts. */
export function MergedBoxes({
  parts,
  children,
  castShadow = true,
}: {
  parts: BoxPart[];
  children: React.ReactNode;
  castShadow?: boolean;
}) {
  // Keyed on content, not identity: callers build `parts` inline, and a
  // re-merge on every render would undo the point of merging.
  const key = JSON.stringify(parts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const geometry = React.useMemo(() => mergeBoxes(parts), [key]);
  React.useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <mesh geometry={geometry} castShadow={castShadow} receiveShadow>
      {children}
    </mesh>
  );
}
