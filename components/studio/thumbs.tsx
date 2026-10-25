"use client";

import * as React from "react";
import { createRoot, extend, useThree, type ReconcilerRoot } from "@react-three/fiber";
import * as THREE from "three";
import { ACESFilmicToneMapping, Box3, Sphere, Vector3, type Group, type PerspectiveCamera } from "three";
import type { Product } from "@/lib/catalog/types";
import type { Vec3 } from "@/lib/room/types";
import { Studio } from "./HoverPreview";
import { ProductModel } from "./models/ProductModel";

/**
 * Real 3D thumbnails for the catalog.
 *
 * Every card used to show a hand-drawn glyph — a generic "lamp" or "blob" —
 * which on a phone is close to unreadable: you can't tell a moon lamp from a
 * disco ball at 56px. Each product is now rendered once, from its actual 3D
 * model, by ONE small off-screen renderer working through a queue, and the
 * image is cached in memory and in IndexedDB, so it costs nothing after the
 * first visit. The renderer is torn down whenever the queue empties, so it
 * never holds a WebGL context the studio might need.
 *
 */

const SIZE = 320;

type Done = (url: string | null) => void;
const queued = new Map<string, { product: Product; done: Done }>();
let running = false;

/**
 * Render a product's thumbnail in the background. Loaded on demand by
 * thumbCache.ts, which owns caching; this module only renders.
 */
export function enqueueRender(key: string, product: Product, done: Done) {
  if (queued.has(key)) return;
  queued.set(key, { product, done });
  void pump();
}

/** Drain the queue through a single renderer, yielding between items. */
async function pump() {
  if (running) return;
  running = true;
  let root: ReconcilerRoot<HTMLCanvasElement> | null = null;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;
    // <Canvas> registers three's classes with the reconciler; a bare root
    // has to do it itself or the first <mesh> throws.
    extend(THREE as unknown as Parameters<typeof extend>[0]);
    root = createRoot(canvas);
    await root.configure({
      gl: { antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "low-power" },
      size: { width: SIZE, height: SIZE, top: 0, left: 0 },
      dpr: 1,
      frameloop: "never",
      camera: { fov: 30, near: 0.01, far: 60, position: [0, 0, 2] },
      onCreated: ({ gl }) => {
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.12;
      },
    });

    while (queued.size) {
      const [key, job] = queued.entries().next().value as [string, { product: Product; done: Done }];
      const url = await new Promise<string | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 4000);
        root!.render(
          <>
            <Studio />
            <ThumbScene
              key={key}
              product={job.product}
              onDone={(u) => {
                clearTimeout(timer);
                resolve(u);
              }}
            />
          </>,
        );
      });
      queued.delete(key);
      job.done(url);
      // Give the page a frame between renders so scrolling stays smooth.
      await new Promise((r) => setTimeout(r, 16));
    }
  } catch {
    // No WebGL (or it was lost): cards keep their drawn glyphs.
    queued.forEach((job) => job.done(null));
    queued.clear();
  } finally {
    root?.unmount();
    running = false;
    if (queued.size) void pump();
  }
}

/**
 * One product, framed from its real bounding box at a flattering
 * three-quarter angle, rendered once and handed back as an image.
 */
function ThumbScene({ product, onDone }: { product: Product; onDone: (url: string | null) => void }) {
  const group = React.useRef<Group>(null);
  const { gl, scene, camera } = useThree();
  const wall = product.mount === "wall";
  const edge = product.mount === "edge";
  const runLength = Math.min(product.dims.w / 100, 0.6);
  const path: [Vec3, Vec3] | undefined = edge ? [[-runLength / 2, 0, 0], [runLength / 2, 0, 0]] : undefined;

  // Parent effects run after every child has mounted, so the model is in the
  // scene and measurable here.
  React.useEffect(() => {
    const g = group.current;
    if (!g) return onDone(null);
    g.rotation.y = wall || edge ? -0.32 : -0.62;
    g.updateMatrixWorld(true);
    // Frame the object, not its glow: additive halos (neon wall spill, lens
    // glow) are several times the size of the thing that makes them.
    const box = new Box3();
    const part = new Box3();
    g.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (mats.every((m) => m.blending === THREE.AdditiveBlending)) return;
      mesh.geometry.computeBoundingBox();
      part.copy(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld);
      box.union(part);
    });
    if (box.isEmpty()) return onDone(null);
    const centre = box.getCenter(new Vector3());
    g.position.sub(centre);
    g.updateMatrixWorld(true);
    const radius = box.getBoundingSphere(new Sphere()).radius;

    const cam = camera as PerspectiveCamera;
    const fov = (cam.fov * Math.PI) / 180;
    const dist = (radius / Math.sin(fov / 2)) * 1.02;
    const elevation = wall || edge ? 0.12 : 0.32;
    cam.position.set(0, Math.sin(elevation) * dist, Math.cos(elevation) * dist);
    cam.near = dist / 50;
    cam.far = dist * 4;
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();

    gl.setClearColor(0x000000, 0);
    gl.render(scene, camera);
    let url = gl.domElement.toDataURL("image/webp", 0.88);
    if (!url.startsWith("data:image/webp")) url = gl.domElement.toDataURL("image/png");
    onDone(url);
    // Render exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <group ref={group}>
      <ProductModel product={product} path={path} light={false} />
    </group>
  );
}
